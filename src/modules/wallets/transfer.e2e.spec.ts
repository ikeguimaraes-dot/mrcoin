import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../auth/password.util';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { TRANSFER_DAILY_LIMIT_COINS } from './transfer.constants';

const DEFAULT_TEST_PIN = '8264';

interface RecipientBody {
  membershipId: string;
  name: string;
}

interface RecipientListResponseBody {
  items: RecipientBody[];
}

interface TransferBody {
  id: string;
  amount: number;
  recipientMembershipId: string;
  recipientName: string;
  createdAt: string;
}

interface ErrorBody {
  code: string;
  details?: Record<string, unknown>;
}

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

function idempotencyKey(): string {
  return `test-${randomUUID()}`;
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Transfer Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

/** pin: null = usuário sem PIN configurado. */
async function createMember(
  organizationId: string,
  overrides: { name?: string; cachedBalance?: number; pin?: string | null; status?: 'ACTIVE' | 'INACTIVE' } = {},
): Promise<{ userId: string; membershipId: string; walletId: string; token: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const pin = overrides.pin === undefined ? DEFAULT_TEST_PIN : overrides.pin;
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: overrides.name ?? `Transfer Test User ${suffix}`,
      transactionPinHash: pin ? await hashPassword(pin) : null,
    },
  });
  createdUserIds.push(user.id);

  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId, type: 'CUSTOMER', status: overrides.status ?? 'ACTIVE' },
  });
  const wallet = await prisma.wallet.create({
    data: { membershipId: membership.id, cachedBalance: overrides.cachedBalance ?? 0 },
  });
  const token = await jwtService.signAsync({ sub: user.id, type: 'user' });

  return { userId: user.id, membershipId: membership.id, walletId: wallet.id, token };
}

function transferBody(recipientMembershipId: string, amount: number, organizationId: string, pin: string = DEFAULT_TEST_PIN) {
  return { organizationId, recipientMembershipId, amount, transactionPin: pin };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const membershipIds = memberships.map((m) => m.id);
  const walletIds = (
    await prisma.wallet.findMany({ where: { membershipId: { in: membershipIds } } })
  ).map((w) => w.id);
  await prisma.transfer.deleteMany({
    where: { OR: [{ fromMembershipId: { in: membershipIds } }, { toMembershipId: { in: membershipIds } }] },
  });
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('GET /wallet/transfer/recipients', () => {
  it('busca parcial por nome, só ACTIVE da mesma org, nunca o próprio remetente', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const suffix = randomUUID();
    const sender = await createMember(orgA.id, { name: `Remetente ${suffix}` });
    const matchSilva = await createMember(orgA.id, { name: `João Silva ${suffix}` });
    const matchPedro = await createMember(orgA.id, { name: `João Pedro ${suffix}` });
    await createMember(orgA.id, { name: `João Inativo ${suffix}`, status: 'INACTIVE' });
    await createMember(orgB.id, { name: `João Outra Org ${suffix}` });

    const res = await request(server)
      .get('/wallet/transfer/recipients')
      // "João" sozinho (não "João Silva ${suffix}") — contains é substring contígua, e o
      // isolamento aqui vem do organizationId (orgA é exclusivo deste teste), não da query.
      .query({ organizationId: orgA.id, query: 'João' })
      .set('Authorization', `Bearer ${sender.token}`)
      .expect(200);

    const items = (res.body as RecipientListResponseBody).items;
    expect(items.map((i) => i.membershipId).sort()).toEqual([matchPedro.membershipId, matchSilva.membershipId].sort());
  });

  it('nunca retorna o próprio remetente, mesmo quando o nome dele bate na busca', async () => {
    const org = await createOrg();
    const suffix = randomUUID();
    const sender = await createMember(org.id, { name: `Busca Própria ${suffix}` });

    const res = await request(server)
      .get('/wallet/transfer/recipients')
      .query({ organizationId: org.id, query: `Busca Própria ${suffix}` })
      .set('Authorization', `Bearer ${sender.token}`)
      .expect(200);

    expect((res.body as RecipientListResponseBody).items).toHaveLength(0);
  });

  it('sem token retorna 401', async () => {
    await request(server).get('/wallet/transfer/recipients').query({ organizationId: 'x', query: 'y' }).expect(401);
  });
});

describe('POST /wallet/transfer — fluxo feliz', () => {
  it('debita o remetente e credita o destinatário atomicamente, entries TRANSFER com o mesmo referenceId', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500 });
    const recipient = await createMember(org.id, { cachedBalance: 100 });

    const res = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 150, org.id))
      .expect(201);

    const body = res.body as TransferBody;
    expect(body.amount).toBe(150);
    expect(body.recipientMembershipId).toBe(recipient.membershipId);

    const senderWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: sender.walletId } });
    const recipientWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: recipient.walletId } });
    expect(senderWallet.cachedBalance).toBe(350);
    expect(recipientWallet.cachedBalance).toBe(250);

    const debitEntry = await prisma.ledgerEntry.findFirst({
      where: { walletId: sender.walletId, referenceType: 'TRANSFER', type: 'DEBIT' },
    });
    const creditEntry = await prisma.ledgerEntry.findFirst({
      where: { walletId: recipient.walletId, referenceType: 'TRANSFER', type: 'CREDIT' },
    });
    expect(debitEntry).toBeDefined();
    expect(creditEntry).toBeDefined();
    expect(debitEntry?.amount).toBe(150);
    expect(creditEntry?.amount).toBe(150);
    expect(debitEntry?.referenceId).toBe(creditEntry?.referenceId);

    const transfer = await prisma.transfer.findUniqueOrThrow({ where: { id: body.id } });
    expect(transfer.fromMembershipId).toBe(sender.membershipId);
    expect(transfer.toMembershipId).toBe(recipient.membershipId);
    expect(transfer.debitLedgerEntryId).toBe(debitEntry?.id);
    expect(transfer.creditLedgerEntryId).toBe(creditEntry?.id);
  });

  it('Idempotency-Key repetida com os mesmos parâmetros devolve a mesma transferência, sem duplicar', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500 });
    const recipient = await createMember(org.id, { cachedBalance: 0 });
    const key = idempotencyKey();

    const first = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key)
      .send(transferBody(recipient.membershipId, 50, org.id))
      .expect(201);

    const retry = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key)
      .send(transferBody(recipient.membershipId, 50, org.id, '0000'))
      .expect(201);

    expect((retry.body as TransferBody).id).toBe((first.body as TransferBody).id);

    const senderWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: sender.walletId } });
    expect(senderWallet.cachedBalance).toBe(450);
    const count = await prisma.transfer.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it('Idempotency-Key repetida com amount diferente retorna 409 IDEMPOTENCY_CONFLICT', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500 });
    const recipient = await createMember(org.id, { cachedBalance: 0 });
    const key = idempotencyKey();

    await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key)
      .send(transferBody(recipient.membershipId, 50, org.id))
      .expect(201);

    const conflict = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', key)
      .send(transferBody(recipient.membershipId, 99, org.id))
      .expect(409);
    expect((conflict.body as ErrorBody).code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('sem Idempotency-Key retorna 400 VALIDATION_ERROR', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500 });
    const recipient = await createMember(org.id, { cachedBalance: 0 });

    const res = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .send(transferBody(recipient.membershipId, 50, org.id))
      .expect(400);
    expect((res.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });
});

describe('POST /wallet/transfer — validações', () => {
  it('destinatário de outra organização retorna 404, não vaza existência', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const sender = await createMember(orgA.id, { cachedBalance: 500 });
    const outsider = await createMember(orgB.id, { cachedBalance: 0 });

    const res = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(outsider.membershipId, 50, orgA.id))
      .expect(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('destinatário inexistente retorna 404', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500 });

    await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(randomUUID(), 50, org.id))
      .expect(404);
  });

  it('destinatário INACTIVE retorna 404', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500 });
    const inactiveRecipient = await createMember(org.id, { status: 'INACTIVE' });

    await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(inactiveRecipient.membershipId, 50, org.id))
      .expect(404);
  });

  it('transferir pra si mesmo retorna 400 SELF_TRANSFER_NOT_ALLOWED', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500 });

    const res = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(sender.membershipId, 50, org.id))
      .expect(400);
    expect((res.body as ErrorBody).code).toBe('SELF_TRANSFER_NOT_ALLOWED');
  });

  it('saldo insuficiente rejeita ANTES de validar o PIN — 422, não 401', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 10 });
    const recipient = await createMember(org.id, { cachedBalance: 0 });

    const res = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 500, org.id, '0000'))
      .expect(422);
    expect((res.body as ErrorBody).code).toBe('INSUFFICIENT_BALANCE');
  });

  it('PIN errado não move saldo', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500 });
    const recipient = await createMember(org.id, { cachedBalance: 0 });

    const res = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 50, org.id, '0000'))
      .expect(401);
    expect((res.body as ErrorBody).code).toBe('INVALID_PIN');

    const senderWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: sender.walletId } });
    expect(senderWallet.cachedBalance).toBe(500);
  });

  it('sem PIN configurado retorna 400 TRANSACTION_PIN_NOT_SET', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500, pin: null });
    const recipient = await createMember(org.id, { cachedBalance: 0 });

    const res = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 50, org.id))
      .expect(400);
    expect((res.body as ErrorBody).code).toBe('TRANSACTION_PIN_NOT_SET');
  });

  it('resposta nunca inclui membershipId cru do remetente nem fromMembershipId/toMembershipId', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 500 });
    const recipient = await createMember(org.id, { cachedBalance: 0 });

    const res = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 50, org.id))
      .expect(201);

    expect(Object.keys(res.body as object).sort()).toEqual(
      ['amount', 'createdAt', 'id', 'recipientMembershipId', 'recipientName'].sort(),
    );
  });

  it('sem token retorna 401', async () => {
    await request(server)
      .post('/wallet/transfer')
      .set('Idempotency-Key', idempotencyKey())
      .send({ organizationId: 'x', recipientMembershipId: 'y', amount: 10, transactionPin: DEFAULT_TEST_PIN })
      .expect(401);
  });
});

describe('POST /wallet/transfer — limite diário', () => {
  it('acumula corretamente, bloqueia o que estouraria 1000, permite exatamente até o limite, e reseta fora da janela de 24h', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 10_000 });
    const recipient = await createMember(org.id, { cachedBalance: 0 });

    const firstRes = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 400, org.id))
      .expect(201);
    const firstTransferId = (firstRes.body as TransferBody).id;

    await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 400, org.id))
      .expect(201);
    // Acumulado: 800.

    const blockedRes = await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 300, org.id))
      .expect(422);
    const blockedBody = blockedRes.body as ErrorBody;
    expect(blockedBody.code).toBe('TRANSFER_DAILY_LIMIT_EXCEEDED');
    expect(blockedBody.details).toMatchObject({ limit: TRANSFER_DAILY_LIMIT_COINS, alreadySent: 800, requested: 300 });

    // Exatamente até o limite (800 + 200 = 1000) é permitido.
    await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 200, org.id))
      .expect(201);

    // Qualquer coisa a mais agora bloqueia — acumulado já é exatamente 1000.
    await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 1, org.id))
      .expect(422);

    // Recua a 1ª transferência (400) pra fora da janela de 24h — some do acumulado.
    await prisma.transfer.update({
      where: { id: firstTransferId },
      data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
    });
    // Acumulado dentro da janela agora: 400 (2ª) + 200 (3ª) = 600. Cabe até 400 a mais.
    await request(server)
      .post('/wallet/transfer')
      .set('Authorization', `Bearer ${sender.token}`)
      .set('Idempotency-Key', idempotencyKey())
      .send(transferBody(recipient.membershipId, 400, org.id))
      .expect(201);
  });
});

describe('POST /wallet/transfer — concorrência', () => {
  it('duas transferências concorrentes que juntas excedem o saldo não passam as duas', async () => {
    const org = await createOrg();
    const sender = await createMember(org.id, { cachedBalance: 100 });
    const recipientA = await createMember(org.id, { cachedBalance: 0 });
    const recipientB = await createMember(org.id, { cachedBalance: 0 });

    const results = await Promise.all([
      request(server)
        .post('/wallet/transfer')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send(transferBody(recipientA.membershipId, 60, org.id)),
      request(server)
        .post('/wallet/transfer')
        .set('Authorization', `Bearer ${sender.token}`)
        .set('Idempotency-Key', idempotencyKey())
        .send(transferBody(recipientB.membershipId, 60, org.id)),
    ]);

    const succeeded = results.filter((res) => res.status === 201);
    const failed = results.filter((res) => res.status === 422);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0]?.body as ErrorBody).code).toBe('INSUFFICIENT_BALANCE');

    const senderWallet = await prisma.wallet.findUniqueOrThrow({ where: { id: sender.walletId } });
    expect(senderWallet.cachedBalance).toBe(40);
  });
});
