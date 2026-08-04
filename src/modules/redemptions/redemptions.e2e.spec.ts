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

interface RedemptionBody {
  id: string;
  partnerId: string;
  offerId: string | null;
  amount: number;
  code: string;
  qrPayload: string;
  status: string;
  expiresAt: string;
  confirmedAt: string | null;
}

interface ErrorBody {
  code: string;
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
  return organization;
}

async function createUserWithWallet(
  organizationId: string,
  cachedBalance: number,
): Promise<{ userId: string; membershipId: string; walletId: string; token: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Redemption Test User ${suffix}`,
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
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('Fluxo completo', () => {
  it('criar -> PENDING -> confirmar -> CONFIRMED, debita exatamente o costInCoins congelado na criação', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 150 });
    const user = await createUserWithWallet(org.id, 1000);

    const createRes = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);

    const created = createRes.body as RedemptionBody;
    expect(created.status).toBe('PENDING');
    expect(created.amount).toBe(150);
    expect(created.code).toMatch(/^\d{6}$/);
    expect(created.confirmedAt).toBeNull();

    const pendingRes = await request(server)
      .get(`/redemptions/${created.id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect((pendingRes.body as RedemptionBody).status).toBe('PENDING');

    const confirmRes = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ code: created.code })
      .expect(201);
    const confirmed = confirmRes.body as RedemptionBody;
    expect(confirmed.status).toBe('CONFIRMED');
    expect(confirmed.confirmedAt).toBeTruthy();

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(850);

    const entries = await prisma.ledgerEntry.findMany({
      where: { referenceId: created.id, referenceType: 'REDEMPTION' },
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe('DEBIT');
    expect(entries[0]?.amount).toBe(150);

    const confirmedGetRes = await request(server)
      .get(`/redemptions/${created.id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect((confirmedGetRes.body as RedemptionBody).status).toBe('CONFIRMED');
  });

  it('confirma via qrPayload em vez de code', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 30 });
    const user = await createUserWithWallet(org.id, 200);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);

    await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ qrPayload: (created.body as RedemptionBody).qrPayload })
      .expect(201);
  });
});

describe('Garantias inegociáveis', () => {
  it('GARANTIA 1 — dois confirmes concorrentes do mesmo resgate não debitam duas vezes', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 100 });
    const user = await createUserWithWallet(org.id, 1000);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);
    const { id, code } = created.body as RedemptionBody;

    const results = await Promise.all([
      request(server).post('/redemptions/confirm').set('Authorization', `Bearer ${partner.token}`).send({ code }),
      request(server).post('/redemptions/confirm').set('Authorization', `Bearer ${partner.token}`).send({ code }),
    ]);

    results.forEach((res) => expect(res.status).toBe(201));

    const entryCount = await prisma.ledgerEntry.count({ where: { referenceId: id, referenceType: 'REDEMPTION' } });
    expect(entryCount).toBe(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(900);
  });

  it('GARANTIA 2 — dois resgates que juntos excedem o saldo não passam os dois numa confirmação simultânea', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offerA = await createOffer(partner.id, { costInCoins: 60 });
    const offerB = await createOffer(partner.id, { costInCoins: 60 });
    const user = await createUserWithWallet(org.id, 100);

    const createdA = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offerA.id, organizationId: org.id })
      .expect(201);
    const createdB = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offerB.id, organizationId: org.id })
      .expect(201);

    const codeA = (createdA.body as RedemptionBody).code;
    const codeB = (createdB.body as RedemptionBody).code;

    const results = await Promise.all([
      request(server).post('/redemptions/confirm').set('Authorization', `Bearer ${partner.token}`).send({ code: codeA }),
      request(server).post('/redemptions/confirm').set('Authorization', `Bearer ${partner.token}`).send({ code: codeB }),
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

  it('GARANTIA 3 — parceiro B não confirma resgate de oferta do parceiro A (404, nunca revela existência)', async () => {
    const org = await createOrg();
    const partnerA = await createPartner();
    const partnerB = await createPartner();
    const offer = await createOffer(partnerA.id, { costInCoins: 50 });
    const user = await createUserWithWallet(org.id, 500);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);
    const { code } = created.body as RedemptionBody;

    const response = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partnerB.token}`)
      .send({ code })
      .expect(404);
    expect((response.body as ErrorBody).code).toBe('NOT_FOUND');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(500);
  });

  it('self-healing: crash simulado entre o débito e a atualização do status — a próxima tentativa reconcilia sem debitar de novo', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 80 });
    const user = await createUserWithWallet(org.id, 500);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);
    const { id, code } = created.body as RedemptionBody;

    // Simula o processo "morrendo" exatamente entre o débito (que já rodou de verdade,
    // ledgerService.post() não é mockado) e o updateMany que marcaria CONFIRMED — mesma
    // técnica de jest.spyOn na instância real já usada nos rollbacks de distributions/signup
    // (moduleRef.get(...) em vez de mockar o módulo inteiro).
    const prismaInstance = moduleRef.get(PrismaService);
    const updateManySpy = jest
      .spyOn(prismaInstance.redemption, 'updateMany')
      .mockImplementationOnce(() => {
        throw new Error('Falha simulada entre o débito e a atualização do status');
      });

    try {
      await request(server)
        .post('/redemptions/confirm')
        .set('Authorization', `Bearer ${partner.token}`)
        .send({ code })
        .expect(500);
    } finally {
      updateManySpy.mockRestore();
    }

    // O débito JÁ aconteceu (ledgerService.post rodou de verdade antes do "crash") — o
    // status, porém, ainda não reflete isso, porque foi exatamente o updateMany seguinte
    // que "quebrou".
    const walletAfterCrash = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(walletAfterCrash.cachedBalance).toBe(420);
    const entryCountAfterCrash = await prisma.ledgerEntry.count({
      where: { referenceId: id, referenceType: 'REDEMPTION' },
    });
    expect(entryCountAfterCrash).toBe(1);

    const redemptionAfterCrash = await prisma.redemption.findUniqueOrThrow({ where: { id } });
    expect(redemptionAfterCrash.status).toBe('PENDING');
    expect(redemptionAfterCrash.ledgerEntryId).toBeNull();

    // Retry — self-healing: acha o LedgerEntry já existente pela idempotencyKey e só
    // reconcilia o status, sem chamar ledgerService.post() de novo.
    const retryRes = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ code })
      .expect(201);
    expect((retryRes.body as RedemptionBody).status).toBe('CONFIRMED');

    const walletAfterRetry = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(walletAfterRetry.cachedBalance).toBe(420);
    const entryCountAfterRetry = await prisma.ledgerEntry.count({
      where: { referenceId: id, referenceType: 'REDEMPTION' },
    });
    expect(entryCountAfterRetry).toBe(1);

    const redemptionAfterRetry = await prisma.redemption.findUniqueOrThrow({ where: { id } });
    expect(redemptionAfterRetry.status).toBe('CONFIRMED');
    expect(redemptionAfterRetry.ledgerEntryId).not.toBeNull();
  });
});

describe('Expiração', () => {
  it('confirmar depois do TTL falha e não debita, mesmo sem ninguém ter consultado o resgate antes (sem depender da expiração lazy do GET)', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 50 });
    const user = await createUserWithWallet(org.id, 500);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);
    const { id, code } = created.body as RedemptionBody;

    // Só mexe em expiresAt — status continua PENDING no banco (ninguém chamou GET ainda,
    // que é o único lugar que faria a expiração lazy). O confirm() tem que barrar sozinho.
    await prisma.redemption.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const beforeConfirm = await prisma.redemption.findUniqueOrThrow({ where: { id } });
    expect(beforeConfirm.status).toBe('PENDING');

    const confirmRes = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ code })
      .expect(422);
    expect((confirmRes.body as ErrorBody).code).toBe('REDEMPTION_EXPIRED');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(500);

    const entryCount = await prisma.ledgerEntry.count({ where: { referenceId: id, referenceType: 'REDEMPTION' } });
    expect(entryCount).toBe(0);

    const getRes = await request(server)
      .get(`/redemptions/${id}`)
      .set('Authorization', `Bearer ${user.token}`)
      .expect(200);
    expect((getRes.body as RedemptionBody).status).toBe('EXPIRED');
  });
});

describe('perUserLimit', () => {
  it('bloqueia a criação de um segundo PENDING quando o limite (PENDING+CONFIRMED) já foi atingido', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 50, perUserLimit: 1 });
    const user = await createUserWithWallet(org.id, 500);

    await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);

    const secondRes = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(422);
    expect((secondRes.body as ErrorBody).code).toBe('REDEMPTION_LIMIT_REACHED');
  });

  it('também é conferido na confirmação — cobre a corrida de duas PENDING criadas quase juntas', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id, { costInCoins: 50, perUserLimit: 1 });
    const user = await createUserWithWallet(org.id, 500);

    // Duas PENDING manufaturadas direto no banco (bypassando o create, que já bloquearia a
    // 2ª) — simula a corrida rara que o best-effort aceita: as duas passaram pela checagem
    // de criação quase juntas, antes de qualquer uma confirmar.
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.redemption.create({
      data: {
        membershipId: user.membershipId,
        walletId: user.walletId,
        partnerId: partner.id,
        offerId: offer.id,
        amount: 50,
        code: '111111',
        qrPayload: randomUUID(),
        idempotencyKey: randomUUID(),
        expiresAt,
      },
    });
    await prisma.redemption.create({
      data: {
        membershipId: user.membershipId,
        walletId: user.walletId,
        partnerId: partner.id,
        offerId: offer.id,
        amount: 50,
        code: '222222',
        qrPayload: randomUUID(),
        idempotencyKey: randomUUID(),
        expiresAt,
      },
    });

    await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ code: '111111' })
      .expect(201);

    const secondConfirm = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ code: '222222' })
      .expect(422);
    expect((secondConfirm.body as ErrorBody).code).toBe('REDEMPTION_LIMIT_REACHED');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: user.walletId } });
    expect(wallet.cachedBalance).toBe(450);
  });
});

describe('Idempotency-Key', () => {
  it('mesma chave + mesmo offerId devolve o mesmo resgate, sem duplicar linha', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id);
    const user = await createUserWithWallet(org.id, 500);
    const key = idempotencyKey();

    const first = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', key)
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);
    const retry = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', key)
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);

    expect((retry.body as RedemptionBody).id).toBe((first.body as RedemptionBody).id);
    expect((retry.body as RedemptionBody).code).toBe((first.body as RedemptionBody).code);

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
      .send({ offerId: offerA.id, organizationId: org.id })
      .expect(201);

    const conflict = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', key)
      .send({ offerId: offerB.id, organizationId: org.id })
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
      .send({ offerId: offer.id, organizationId: org.id })
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
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(404);
    expect((response.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('resposta nunca inclui membershipId/walletId/ledgerEntryId', async () => {
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id);
    const user = await createUserWithWallet(org.id, 500);

    const created = await request(server)
      .post('/redemptions')
      .set('Authorization', `Bearer ${user.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send({ offerId: offer.id, organizationId: org.id })
      .expect(201);

    expect(Object.keys(created.body as object).sort()).toEqual(
      ['amount', 'code', 'confirmedAt', 'expiresAt', 'id', 'offerId', 'partnerId', 'qrPayload', 'status'].sort(),
    );
    expect(created.body).not.toHaveProperty('membershipId');
    expect(created.body).not.toHaveProperty('walletId');
    expect(created.body).not.toHaveProperty('ledgerEntryId');
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
      .send({ offerId: offer.id, organizationId: org.id })
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
      .send({ offerId: 'x', organizationId: 'y' })
      .expect(401);
  });

  it('POST /redemptions/confirm sem token de parceiro retorna 401', async () => {
    await request(server).post('/redemptions/confirm').send({ code: '123456' }).expect(401);
  });

  it('confirm com code e qrPayload juntos retorna 400 VALIDATION_ERROR', async () => {
    const partner = await createPartner();

    const response = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({ code: '123456', qrPayload: 'x' })
      .expect(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('confirm sem code nem qrPayload retorna 400 VALIDATION_ERROR', async () => {
    const partner = await createPartner();

    const response = await request(server)
      .post('/redemptions/confirm')
      .set('Authorization', `Bearer ${partner.token}`)
      .send({})
      .expect(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });
});
