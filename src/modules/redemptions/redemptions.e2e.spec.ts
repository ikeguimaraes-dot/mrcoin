import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { OfferStatus, PartnerStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../auth/password.util';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { PARTNER_REDEMPTION_CONFIRM_ALLOWED_FIELDS } from './dto/partner-redemption-confirm-response.schema';

const PICKUP_CODE_REGEX = /^\d{6}$/;
const DEFAULT_TEST_PIN = '8264';

interface RedemptionBody {
  id: string;
  partnerId: string;
  offerId: string | null;
  amount: number;
  pickupCode: string;
  qrPayload: string;
  status: string;
  confirmedAt: string | null;
  deliveredAt: string | null;
}

interface ErrorBody {
  code: string;
  details?: { attemptsRemaining?: number };
}

interface PartnerConfirmBody {
  id: string;
  amount: number;
  status: string;
  confirmedAt: string | null;
  deliveredAt: string | null;
  offerTitle: string | null;
  customerFirstName: string;
}

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

const createdOrgIds: string[] = [];
const createdPartnerIds: string[] = [];
const createdOfferIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;
let moduleRef: TestingModule;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Redemption Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

/** pin: null = usuário sem PIN configurado (pra testar TRANSACTION_PIN_NOT_SET). */
async function createUserWithWallet(
  organizationId: string,
  cachedBalance: number,
  pin: string | null = DEFAULT_TEST_PIN,
): Promise<{ userId: string; membershipId: string; walletId: string; token: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Redemption Test User ${suffix}`,
      transactionPinHash: pin ? await hashPassword(pin) : null,
    },
  });
  createdUserIds.push(user.id);

  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId, type: 'CUSTOMER' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id, cachedBalance } });
  const token = await jwtService.signAsync({ sub: user.id, type: 'user' });

  return { userId: user.id, membershipId: membership.id, walletId: wallet.id, token };
}

async function createPartner(status: PartnerStatus = 'ACTIVE'): Promise<{ id: string; token: string }> {
  const suffix = randomUUID();
  const partner = await prisma.partner.create({
    data: {
      name: `Redemption Test Partner ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
      category: 'Teste',
      takeRateBps: 500,
      pixKey: `pix-${suffix}@test.coins-api.dev`,
      status,
    },
  });
  createdPartnerIds.push(partner.id);
  const token = await jwtService.signAsync({ sub: partner.id, type: 'partner' });
  return { id: partner.id, token };
}

async function createOffer(
  partnerId: string,
  overrides: Partial<{ costInCoins: number; perUserLimit: number | null; status: OfferStatus }> = {},
): Promise<{ id: string; costInCoins: number }> {
  const suffix = randomUUID();
  const offer = await prisma.offer.create({
    data: {
      partnerId,
      title: `Redemption Test Offer ${suffix}`,
      description: `Redemption Test Offer ${suffix}`,
      category: 'Teste',
      costInCoins: overrides.costInCoins ?? 100,
      perUserLimit: overrides.perUserLimit ?? null,
      status: overrides.status ?? 'ACTIVE',
    },
  });
  createdOfferIds.push(offer.id);
  return { id: offer.id, costInCoins: offer.costInCoins };
}

function idempotencyKey(): string {
  return `test-${randomUUID()}`;
}

function buyBody(offerId: string, organizationId: string, pin: string = DEFAULT_TEST_PIN) {
  return { offerId, organizationId, transactionPin: pin };
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const walletIds = (
    await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } })
  ).map((w) => w.id);
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.redemption.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: createdPartnerIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('Fluxo completo — compra com PIN debita na hora', () => {
  it('criar com PIN certo -> já nasce CONFIRMED, debita exatamente o costInCoins congelado, tem pickupCode+qrPayload', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 150 });
    const user = await createUserWithWallet(org.id, 1000);

    const createRes = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(201);

    const created = createRes.body as RedemptionBody;
    expect(created.status).toBe('CONFIRMED');
    expect(created.amount).toBe(150);
    expect(created.pickupCode).toMatch(PICKUP_CODE_REGEX);
    expect(created.confirmedAt).toBeTruthy();
    expect(created.deliveredAt).toBeNull();

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(850);

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceId: created.id, referenceType: 'REDEMPTION' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe('DEBIT');
    expect(entries[0]?.amount).toBe(150);

    const getRes = await request(server)
      .get(`/redemptions/${created.id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect((getRes.body as RedemptionBody).status).toBe('CONFIRMED');

    // Parceiro marca entregue — via pickupCode.
    const deliverRes = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ pickupCode: created.pickupCode })
      .expect(201);
    const delivered = deliverRes.body as RedemptionBody;
    expect(delivered.status).toBe('DELIVERED');
    expect(delivered.deliveredAt).toBeTruthy();

    // Nenhum novo débito aconteceu na entrega — saldo/entries continuam iguais.
    const walletAfterDelivery = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(walletAfterDelivery.cachedBalance).toBe(850);
    const entriesAfterDelivery = await prisma.ledgerEntry.count({
      where: { referenceId: created.id, referenceType: 'REDEMPTION' },
    });
    expect(entriesAfterDelivery).toBe(1);

    // Idempotente: marcar entregue de novo não quebra, devolve o mesmo estado.
    const secondDeliverRes = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ pickupCode: created.pickupCode })
      .expect(201);
    expect((secondDeliverRes.body as RedemptionBody).status).toBe('DELIVERED');
    expect((secondDeliverRes.body as RedemptionBody).deliveredAt).toBe(delivered.deliveredAt);
  });

  it('marca entregue via qrPayload em vez de pickupCode', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 30 });
    const user = await createUserWithWallet(org.id, 200);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(201);

    await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ qrPayload: (created.body as RedemptionBody).qrPayload })
      .expect(201);
  });
});

describe('PIN de transação', () => {
  it('PIN errado não debita — 401 INVALID_PIN com attemptsRemaining', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 50 });
    const user = await createUserWithWallet(org.id, 500);

    const response = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id, '0000'))
      .expect(401);
    expect((response.body as ErrorBody).code).toBe('INVALID_PIN');
    expect((response.body as ErrorBody).details?.attemptsRemaining).toBe(4);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(500);
    const entryCount = await prisma.ledgerEntry.count({ where: { walletId: user.walletId } });
    expect(entryCount).toBe(0);
  });

  it('5 erros seguidos bloqueiam por 15min — 429 PIN_LOCKED mesmo com PIN certo na 6ª tentativa', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 10 });
    const user = await createUserWithWallet(org.id, 500);

    for (let i = 0; i < 4; i += 1) {
      const res = await request(server)
        .post('/redemptions')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send(buyBody(offer.id, org.id, '0000'))
        .expect(401);
      expect((res.body as ErrorBody).code).toBe('INVALID_PIN');
    }

    const fifthRes = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id, '0000'))
      .expect(429);
    expect((fifthRes.body as ErrorBody).code).toBe('PIN_LOCKED');

    // 6ª tentativa, PIN CERTO — ainda bloqueado, o lock é fixo por 15min, não desliza.
    const sixthRes = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(429);
    expect((sixthRes.body as ErrorBody).code).toBe('PIN_LOCKED');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(500);
  });

  it('saldo insuficiente rejeita ANTES de validar o PIN', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 200 });
    const user = await createUserWithWallet(org.id, 50);

    // PIN errado + saldo insuficiente — se a ordem estiver certa, o erro é de saldo, não de
    // PIN (e o contador de tentativas de PIN nem chega a ser tocado).
    const response = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id, '0000'))
      .expect(422);
    expect((response.body as ErrorBody).code).toBe('INSUFFICIENT_BALANCE');
  });

  it('sem PIN configurado retorna 400 TRANSACTION_PIN_NOT_SET', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 10 });
    const user = await createUserWithWallet(org.id, 500, null);

    const response = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(400);
    expect((response.body as ErrorBody).code).toBe('TRANSACTION_PIN_NOT_SET');
  });
});

describe('Garantias inegociáveis', () => {
  it('GARANTIA 1 — duas criações concorrentes com a mesma Idempotency-Key não debitam duas vezes', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 100 });
    const user = await createUserWithWallet(org.id, 1000);
    const key = idempotencyKey();

    const results = await Promise.all([
      request(server)
        .post('/redemptions')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', key)
        .send(buyBody(offer.id, org.id)),
      request(server)
        .post('/redemptions')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', key)
        .send(buyBody(offer.id, org.id)),
    ]);

    results.forEach((res) => expect(res.status).toBe(201));
    expect((results[0]?.body as RedemptionBody).id).toBe((results[1]?.body as RedemptionBody).id);

    const entryCount = await prisma.ledgerEntry.count({ where: { walletId: user.walletId, referenceType: 'REDEMPTION' } });
    expect(entryCount).toBe(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(900);
  });

  it('GARANTIA 2 — duas compras que juntas excedem o saldo não passam as duas numa criação simultânea', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offerA = await createOffer(partner.id, { costInCoins: 60 });
    const offerB = await createOffer(partner.id, { costInCoins: 60 });
    const user = await createUserWithWallet(org.id, 100);

    const results = await Promise.all([
      request(server)
        .post('/redemptions')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send(buyBody(offerA.id, org.id)),
      request(server)
        .post('/redemptions')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send(buyBody(offerB.id, org.id)),
    ]);

    const succeeded = results.filter((res) => res.status === 201);
    const failed = results.filter((res) => res.status === 422);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0]?.body as ErrorBody).code).toBe('INSUFFICIENT_BALANCE');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(40);

    const entryCount = await prisma.ledgerEntry.count({
      where: { walletId: user.walletId, referenceType: 'REDEMPTION' },
    });
    expect(entryCount).toBe(1);
  });

  it('GARANTIA 3 — parceiro B não marca entregue resgate de oferta do parceiro A (404, nunca revela existência)', async () => {
    const org = await createOrg();
    const partnerA = await createPartner();
    const partnerB = await createPartner();
    const offer = await createOffer(partnerA.id, { costInCoins: 50 });
    const user = await createUserWithWallet(org.id, 500);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(201);
    const { pickupCode } = created.body as RedemptionBody;

    const response = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partnerB.token}`)
      .send({ pickupCode })
      .expect(404);
    expect((response.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('self-healing: crash simulado entre o débito e a criação da linha — retry (mesma Idempotency-Key) reconcilia sem debitar de novo', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 80 });
    const user = await createUserWithWallet(org.id, 500);
    const key = idempotencyKey();

    // Simula o processo "morrendo" exatamente entre o débito (que já rodou de verdade,
    // ledgerService.post() não é mockado) e o insert da linha — mesma técnica de jest.spyOn
    // na instância real já usada nos rollbacks de distributions/signup.
    const prismaInstance = moduleRef.get(PrismaService);
    const createSpy = jest.spyOn(prismaInstance.redemption, 'create').mockImplementationOnce(() => {
      throw new Error('Falha simulada entre o débito e a criação da linha');
    });

    try {
      await request(server)
        .post('/redemptions')
        .set('Authorization', `Bearer ${user.token}`)
        .set('Idempotency-Key', key)
        .send(buyBody(offer.id, org.id))
        .expect(500);
    } finally {
      createSpy.mockRestore();
    }

    // O débito JÁ aconteceu — o saldo já caiu — mas nenhuma linha de Redemption existe ainda,
    // porque foi exatamente o create() seguinte que "quebrou".
    const walletAfterCrash = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(walletAfterCrash.cachedBalance).toBe(420);
    const entryCountAfterCrash = await prisma.ledgerEntry.count({ where: { walletId: user.walletId, referenceType: 'REDEMPTION' } });
    expect(entryCountAfterCrash).toBe(1);
    const redemptionCountAfterCrash = await prisma.redemption.count({ where: { idempotencyKey: key } });
    expect(redemptionCountAfterCrash).toBe(0);

    // Retry — LedgerService.post() é idempotente pela própria chave: devolve a MESMA entry
    // sem debitar de novo, e agora o create() (sem o spy) consegue inserir a linha.
    const retryRes = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', key)
      .send(buyBody(offer.id, org.id))
      .expect(201);
    expect((retryRes.body as RedemptionBody).status).toBe('CONFIRMED');

    const walletAfterRetry = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(walletAfterRetry.cachedBalance).toBe(420);
    const entryCountAfterRetry = await prisma.ledgerEntry.count({ where: { walletId: user.walletId, referenceType: 'REDEMPTION' } });
    expect(entryCountAfterRetry).toBe(1);
  });
});

describe('perUserLimit', () => {
  it('bloqueia uma segunda compra quando o limite (CONFIRMED+DELIVERED) já foi atingido', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 50, perUserLimit: 1 });
    const user = await createUserWithWallet(org.id, 500);

    await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(201);

    const secondRes = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(422);
    expect((secondRes.body as ErrorBody).code).toBe('REDEMPTION_LIMIT_REACHED');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(450);
  });
});

describe('Idempotency-Key', () => {
  it('mesma chave + mesmo offerId devolve o mesmo resgate, sem duplicar linha — nem re-valida o PIN', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id);
    const user = await createUserWithWallet(org.id, 500);
    const key = idempotencyKey();

    const first = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', key)
      .send(buyBody(offer.id, org.id))
      .expect(201);

    // PIN errado na repetição — se fosse re-validado, isso devolveria 401. Como é replay de
    // uma operação já concluída, nem chega a olhar o PIN.
    const retry = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', key)
      .send(buyBody(offer.id, org.id, '0000'))
      .expect(201);

    expect((retry.body as RedemptionBody).id).toBe((first.body as RedemptionBody).id);
    expect((retry.body as RedemptionBody).pickupCode).toBe((first.body as RedemptionBody).pickupCode);

    const count = await prisma.redemption.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it('mesma chave + offerId diferente retorna 409 IDEMPOTENCY_CONFLICT', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offerA = await createOffer(partner.id);
    const offerB = await createOffer(partner.id);
    const user = await createUserWithWallet(org.id, 500);
    const key = idempotencyKey();

    await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', key)
      .send(buyBody(offerA.id, org.id))
      .expect(201);

    const conflict = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', key)
      .send(buyBody(offerB.id, org.id))
      .expect(409);
    expect((conflict.body as ErrorBody).code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('sem o header Idempotency-Key retorna 400', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id);
    const user = await createUserWithWallet(org.id, 500);

    const response = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .send(buyBody(offer.id, org.id))
      .expect(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });
});

describe('Validações e autenticação', () => {
  it('oferta de parceiro inativo não pode ser resgatada', async () => {
    const org = await createOrg();
    const partner = await createPartner('INACTIVE');
    const offer = await createOffer(partner.id);
    const user = await createUserWithWallet(org.id, 500);

    const response = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(404);
    expect((response.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('resposta nunca inclui membershipId/walletId/ledgerEntryId/deliveredByType/deliveredById', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id);
    const user = await createUserWithWallet(org.id, 500);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(201);

    expect(Object.keys(created.body as object).sort()).toEqual(
      ['amount', 'confirmedAt', 'deliveredAt', 'id', 'offerId', 'partnerId', 'pickupCode', 'qrPayload', 'status'].sort(),
    );
    expect(created.body).not.toHaveProperty('membershipId');
    expect(created.body).not.toHaveProperty('walletId');
    expect(created.body).not.toHaveProperty('ledgerEntryId');
    expect(created.body).not.toHaveProperty('deliveredByType');
    expect(created.body).not.toHaveProperty('deliveredById');
  });

  it('POST /redemptions/confirm — resposta pro parceiro nunca expõe cpf/e-mail/telefone/sobrenome do cliente', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 100 });
    const user = await createUserWithWallet(org.id, 500);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(201);

    const confirmRes = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ pickupCode: (created.body as RedemptionBody).pickupCode })
      .expect(201);
    const confirmed = confirmRes.body as PartnerConfirmBody;

    // O nome de fixture é "Redemption Test User <uuid>" — só "Redemption" pode aparecer.
    expect(confirmed.customerFirstName).toBe('Redemption');
    expect(confirmed.offerTitle).toContain('Redemption Test Offer');
    expect(confirmed.amount).toBe(100);
    expect(confirmed.status).toBe('DELIVERED');

    // Trava por lista: qualquer campo novo no schema de resposta precisa passar por essa
    // lista (partner-redemption-confirm-response.schema.ts) antes de sair em produção.
    expect(Object.keys(confirmRes.body as object).sort()).toEqual(PARTNER_REDEMPTION_CONFIRM_ALLOWED_FIELDS);

    for (const forbiddenField of [
      'cpf',
      'cpfHash',
      'cpfEncrypted',
      'email',
      'phone',
      'customerLastName',
      'customerName',
      'customerEmail',
      'customerPhone',
      'membershipId',
      'walletId',
      'pickupCode',
      'qrPayload',
    ]) {
      expect(confirmRes.body).not.toHaveProperty(forbiddenField);
    }
  });

  it('GET /redemptions/:id de outro usuário retorna 404', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id);
    const userA = await createUserWithWallet(org.id, 500);
    const userB = await createUserWithWallet(org.id, 500);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${userA.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(buyBody(offer.id, org.id))
      .expect(201);

    await request(server)
      .get(`/redemptions/${(created.body as RedemptionBody).id}`)
      .set('Authorization', `Bearer ${userB.token}`)
      .expect(404);
  });

  it('POST /redemptions sem token de usuário retorna 401', async () => {
    await request(server)
      .post('/redemptions')
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: 'x', organizationId: 'y', transactionPin: DEFAULT_TEST_PIN })
      .expect(401);
  });

  it('POST /redemptions/confirm sem token de parceiro retorna 401', async () => {
    await request(server).post('/redemptions/confirm').send({ pickupCode: 'ABCDEF' }).expect(401);
  });

  it('confirm com pickupCode e qrPayload juntos retorna 400 VALIDATION_ERROR', async () => {
    const partner = await createPartner();

    const response = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ pickupCode: 'ABCDEF', qrPayload: 'x' })
      .expect(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('confirm sem pickupCode nem qrPayload retorna 400 VALIDATION_ERROR', async () => {
    const partner = await createPartner();

    const response = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({})
      .expect(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });
});
