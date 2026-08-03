import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminRole, CoinBatch, Distribution, DistributionItem, LedgerEntry } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { hashCpf } from '../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../auth/password.util';
import { TokenService } from '../auth/token.service';
import { LedgerService } from '../ledger/ledger.service';

interface CreateDistributionResponseBody {
  distribution: Distribution;
  item: DistributionItem & { ledgerEntries: LedgerEntry[] };
}

interface ListDistributionsResponseBody {
  items: Distribution[];
  nextCursor: string | null;
}

interface ErrorResponseBody {
  code: string;
}

const FIXTURE_PASSWORD = 'Test@Password123';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const tokenService = new TokenService(jwtService, prisma);

const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;
let moduleRef: TestingModule;

interface AdminFixture {
  adminId: string;
  organizationId: string;
  role: AdminRole;
}

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createAdmin(role: AdminRole): Promise<AdminFixture> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Distributions Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `Distributions Test Admin ${role} ${suffix}`,
      email: `distributions-test-${role.toLowerCase()}-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role,
    },
  });
  createdAdminIds.push(admin.id);

  return { adminId: admin.id, organizationId: organization.id, role };
}

function tokenFor(admin: AdminFixture): Promise<string> {
  return tokenService.issueAccessToken({ id: admin.adminId, organizationId: admin.organizationId, role: admin.role });
}

async function createPaidBatch(organizationId: string, remainingCoins: number, expiresInDays: number): Promise<CoinBatch> {
  return prisma.coinBatch.create({
    data: {
      organizationId,
      totalCoins: remainingCoins,
      remainingCoins,
      priceInCents: remainingCoins * 10,
      status: 'PAID',
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
    },
  });
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  const users = await prisma.user.findMany({ where: { id: { in: createdUserIds } } });
  const memberships = await prisma.membership.findMany({ where: { userId: { in: users.map((u) => u.id) } } });
  const wallets = await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  const walletIds = wallets.map((w) => w.id);

  await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.distributionItem.deleteMany({ where: { distribution: { organizationId: { in: createdOrgIds } } } });
  await prisma.distribution.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.coinBatch.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('POST /admin/distributions', () => {
  it('consome o lote que expira primeiro, e migra pro próximo quando o primeiro esgota', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    const oldestBatch = await createPaidBatch(owner.organizationId, 100, 30);
    const newestBatch = await createPaidBatch(owner.organizationId, 1000, 90);

    const cpf1 = randomCpf();
    const first = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf: cpf1, name: 'Fulano', amount: 100, membershipType: 'EMPLOYEE' })
      .expect(201);

    const firstBody = first.body as CreateDistributionResponseBody;
    expect(firstBody.item.ledgerEntries).toHaveLength(1);
    expect(firstBody.item.ledgerEntries[0]?.batchId).toBe(oldestBatch.id);

    const drainedOldest = await prisma.coinBatch.findUniqueOrThrow({ where: { id: oldestBatch.id } });
    expect(drainedOldest.remainingCoins).toBe(0);

    const user1 = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf1) } });
    createdUserIds.push(user1.id);

    // Lote mais antigo esgotado — a próxima distribuição tem que migrar pro segundo lote.
    const cpf2 = randomCpf();
    const second = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf: cpf2, name: 'Beltrano', amount: 100, membershipType: 'EMPLOYEE' })
      .expect(201);

    const secondBody = second.body as CreateDistributionResponseBody;
    expect(secondBody.item.ledgerEntries).toHaveLength(1);
    expect(secondBody.item.ledgerEntries[0]?.batchId).toBe(newestBatch.id);

    const user2 = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf2) } });
    createdUserIds.push(user2.id);
  });

  it('fraciona entre lotes quando o mais antigo não cobre o valor total, um LedgerEntry por lote', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    const batchA = await createPaidBatch(owner.organizationId, 600, 30);
    const batchB = await createPaidBatch(owner.organizationId, 1000, 90);
    const cpf = randomCpf();

    const response = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf, name: 'Fracionado', amount: 1000, membershipType: 'EMPLOYEE' })
      .expect(201);

    const body = response.body as CreateDistributionResponseBody;
    expect(body.item.ledgerEntries).toHaveLength(2);

    const entryA = body.item.ledgerEntries.find((e) => e.batchId === batchA.id);
    const entryB = body.item.ledgerEntries.find((e) => e.batchId === batchB.id);
    expect(entryA?.amount).toBe(600);
    expect(entryB?.amount).toBe(400);
    expect(entryA?.distributionItemId).toBe(body.item.id);
    expect(entryB?.distributionItemId).toBe(body.item.id);

    const finalBatchA = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batchA.id } });
    const finalBatchB = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batchB.id } });
    expect(finalBatchA.remainingCoins).toBe(0);
    expect(finalBatchB.remainingCoins).toBe(600);

    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    createdUserIds.push(user.id);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: user.id, organizationId: owner.organizationId } },
    });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { membershipId: membership.id } });
    expect(wallet.cachedBalance).toBe(1000);
  });

  it('falha no meio do fracionamento (3º lote) reverte tudo — os 2 primeiros lotes voltam ao remainingCoins original', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    // Precisa de 3 lotes pra fechar 1000: 100 (A) + 100 (B) + 800 (C, parcial).
    const batchA = await createPaidBatch(owner.organizationId, 100, 10);
    const batchB = await createPaidBatch(owner.organizationId, 100, 20);
    const batchC = await createPaidBatch(owner.organizationId, 1000, 30);
    const cpf = randomCpf();

    const ledgerService = moduleRef.get(LedgerService);
    const originalPost = ledgerService.post.bind(ledgerService);
    let callCount = 0;
    const postSpy = jest.spyOn(ledgerService, 'post').mockImplementation((...args) => {
      callCount += 1;
      if (callCount === 3) {
        return Promise.reject(new Error('Falha simulada no 3º lote do fracionamento'));
      }
      return originalPost(...args);
    });

    try {
      await request(server)
        .post('/admin/distributions')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', `test-${randomUUID()}`)
        .send({ cpf, name: 'Falha No Meio', amount: 1000, membershipType: 'EMPLOYEE' })
        .expect(500);
    } finally {
      postSpy.mockRestore();
    }

    expect(callCount).toBe(3);

    // Os 3 lotes têm que estar exatamente como antes — inclusive A e B, que já tinham sido
    // decrementados (e o LedgerEntry deles criado de verdade) antes da falha no 3º.
    const finalBatchA = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batchA.id } });
    const finalBatchB = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batchB.id } });
    const finalBatchC = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batchC.id } });
    expect(finalBatchA.remainingCoins).toBe(100);
    expect(finalBatchB.remainingCoins).toBe(100);
    expect(finalBatchC.remainingCoins).toBe(1000);

    // Nada do que a transação criou (User/Membership/Wallet/Distribution/DistributionItem/
    // LedgerEntry) pode ter sobrevivido ao rollback.
    const user = await prisma.user.findUnique({ where: { cpfHash: hashCpf(cpf) } });
    expect(user).toBeNull();

    const memberships = await prisma.membership.findMany({ where: { organizationId: owner.organizationId } });
    expect(memberships).toHaveLength(0);

    const entriesFromA = await prisma.ledgerEntry.count({ where: { batchId: batchA.id } });
    const entriesFromB = await prisma.ledgerEntry.count({ where: { batchId: batchB.id } });
    expect(entriesFromA).toBe(0);
    expect(entriesFromB).toBe(0);
  });

  it('sem lote com saldo suficiente retorna 422 INSUFFICIENT_COIN_STOCK e não deixa efeito colateral', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    await createPaidBatch(owner.organizationId, 10, 30);

    const cpf = randomCpf();
    const response = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf, name: 'Sem Saldo', amount: 500, membershipType: 'EMPLOYEE' })
      .expect(422);

    expect((response.body as ErrorResponseBody).code).toBe('INSUFFICIENT_COIN_STOCK');

    const user = await prisma.user.findUnique({ where: { cpfHash: hashCpf(cpf) } });
    expect(user).toBeNull();

    const memberships = await prisma.membership.findMany({ where: { organizationId: owner.organizationId } });
    expect(memberships).toHaveLength(0);
  });

  it('insuficiente mesmo somando todos os lotes retorna totalAvailable correto', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    await createPaidBatch(owner.organizationId, 10, 30);
    await createPaidBatch(owner.organizationId, 20, 60);

    const response = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf: randomCpf(), name: 'Sem Saldo Somado', amount: 100, membershipType: 'EMPLOYEE' })
      .expect(422);

    const body = response.body as { code: string; details: { totalAvailable: number } };
    expect(body.code).toBe('INSUFFICIENT_COIN_STOCK');
    expect(body.details.totalAvailable).toBe(30);

    const memberships = await prisma.membership.findMany({ where: { organizationId: owner.organizationId } });
    expect(memberships).toHaveLength(0);
  });

  it('mesma Idempotency-Key no retry não duplica saldo nem nenhum dos entries fracionados', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const batchA = await createPaidBatch(owner.organizationId, 600, 30);
    const batchB = await createPaidBatch(owner.organizationId, 1000, 90);
    const idempotencyKey = `test-${randomUUID()}`;
    const cpf = randomCpf();

    const first = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ cpf, name: 'Retry', amount: 1000, membershipType: 'CUSTOMER' })
      .expect(201);

    const retry = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ cpf, name: 'Retry', amount: 1000, membershipType: 'CUSTOMER' })
      .expect(201);

    const firstBody = first.body as CreateDistributionResponseBody;
    const retryBody = retry.body as CreateDistributionResponseBody;
    expect(retryBody.distribution.id).toBe(firstBody.distribution.id);
    expect(retryBody.item.id).toBe(firstBody.item.id);
    expect(firstBody.item.ledgerEntries).toHaveLength(2);

    const distributions = await prisma.distribution.count({ where: { idempotencyKey } });
    expect(distributions).toBe(1);

    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    createdUserIds.push(user.id);
    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_organizationId: { userId: user.id, organizationId: owner.organizationId } },
    });
    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { membershipId: membership.id } });
    expect(wallet.cachedBalance).toBe(1000);

    const finalBatchA = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batchA.id } });
    const finalBatchB = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batchB.id } });
    expect(finalBatchA.remainingCoins).toBe(0);
    expect(finalBatchB.remainingCoins).toBe(600);

    const ledgerEntries = await prisma.ledgerEntry.count({ where: { walletId: wallet.id } });
    expect(ledgerEntries).toBe(2);
  });

  it('novo User criado por distribuição nasce PENDING_CLAIM', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    await createPaidBatch(owner.organizationId, 1000, 30);
    const cpf = randomCpf();

    await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf, name: 'Novo Usuário', amount: 50, membershipType: 'EMPLOYEE' })
      .expect(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    createdUserIds.push(user.id);
    expect(user.status).toBe('PENDING_CLAIM');
  });

  it('sem o header Idempotency-Key retorna 400', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    await createPaidBatch(owner.organizationId, 1000, 30);

    const response = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ cpf: randomCpf(), name: 'X', amount: 10, membershipType: 'CUSTOMER' })
      .expect(400);

    expect((response.body as ErrorResponseBody).code).toBe('VALIDATION_ERROR');
  });

  it('OPERATOR não pode criar distribuição (rota exige OWNER/MANAGER)', async () => {
    const operator = await createAdmin('OPERATOR');
    const operatorToken = await tokenFor(operator);
    await createPaidBatch(operator.organizationId, 1000, 30);

    await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${operatorToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf: randomCpf(), name: 'X', amount: 10, membershipType: 'CUSTOMER' })
      .expect(403);
  });

  it('MANAGER pode criar distribuição', async () => {
    const manager = await createAdmin('MANAGER');
    const managerToken = await tokenFor(manager);
    await createPaidBatch(manager.organizationId, 1000, 30);
    const cpf = randomCpf();

    await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf, name: 'X', amount: 10, membershipType: 'CUSTOMER' })
      .expect(201);

    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    createdUserIds.push(user.id);
  });

  it('campo reason: aparece na resposta, fica null se omitido, e string vazia após trim é 400', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    await createPaidBatch(owner.organizationId, 1000, 30);

    const cpfWithReason = randomCpf();
    const withReason = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf: cpfWithReason, name: 'Com motivo', amount: 10, membershipType: 'CUSTOMER', reason: 'Bônus aniversário' })
      .expect(201);
    const withReasonBody = withReason.body as CreateDistributionResponseBody;
    expect(withReasonBody.distribution.reason).toBe('Bônus aniversário');
    expect(withReasonBody.item.ledgerEntries[0]?.description).toBe('Distribuição de coins — Bônus aniversário');
    const userWithReason = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpfWithReason) } });
    createdUserIds.push(userWithReason.id);

    const cpfWithoutReason = randomCpf();
    const withoutReason = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf: cpfWithoutReason, name: 'Sem motivo', amount: 10, membershipType: 'CUSTOMER' })
      .expect(201);
    const withoutReasonBody = withoutReason.body as CreateDistributionResponseBody;
    expect(withoutReasonBody.distribution.reason).toBeNull();
    expect(withoutReasonBody.item.ledgerEntries[0]?.description).toBe('Distribuição de coins');
    const userWithoutReason = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpfWithoutReason) } });
    createdUserIds.push(userWithoutReason.id);

    const emptyReason = await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf: randomCpf(), name: 'Motivo vazio', amount: 10, membershipType: 'CUSTOMER', reason: '   ' })
      .expect(400);
    expect((emptyReason.body as ErrorResponseBody).code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /admin/distributions', () => {
  it('pagina por cursor, mais recente primeiro', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    await createPaidBatch(owner.organizationId, 1000, 30);

    for (let i = 0; i < 3; i += 1) {
      const cpf = randomCpf();
      await request(server)
        .post('/admin/distributions')
        .set('Authorization', `Bearer ${ownerToken}`)
        .set('Idempotency-Key', `test-${randomUUID()}`)
        .send({ cpf, name: `Fulano ${i}`, amount: 10, membershipType: 'CUSTOMER' })
        .expect(201);
      const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
      createdUserIds.push(user.id);
    }

    const firstPage = await request(server)
      .get('/admin/distributions')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const firstBody = firstPage.body as ListDistributionsResponseBody;
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).toBeTruthy();

    const secondPage = await request(server)
      .get('/admin/distributions')
      .query({ limit: 2, cursor: firstBody.nextCursor as string })
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const secondBody = secondPage.body as ListDistributionsResponseBody;
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();
  });

  it('isola por organização', async () => {
    const orgA = await createAdmin('OWNER');
    const orgB = await createAdmin('OWNER');
    const tokenA = await tokenFor(orgA);
    await createPaidBatch(orgB.organizationId, 1000, 30);
    const cpfInB = randomCpf();

    await request(server)
      .post('/admin/distributions')
      .set('Authorization', `Bearer ${await tokenFor(orgB)}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ cpf: cpfInB, name: 'Em B', amount: 10, membershipType: 'CUSTOMER' })
      .expect(201);
    const userInB = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpfInB) } });
    createdUserIds.push(userInB.id);

    const response = await request(server)
      .get('/admin/distributions')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect((response.body as ListDistributionsResponseBody).items).toEqual([]);
  });
});
