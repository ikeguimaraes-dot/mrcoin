import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AdminRole, CoinBatch, Distribution, DistributionItem } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { TokenService } from '../auth/token.service';

interface GetDistributionResponseBody {
  distribution: Distribution;
  items: { items: DistributionItem[]; nextCursor: string | null };
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
    data: { name: `CSV Distributions Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `CSV Distributions Test Admin ${role} ${suffix}`,
      email: `csv-distributions-test-${role.toLowerCase()}-${suffix}@test.coins-api.dev`,
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

function csvOf(rows: string[]): string {
  return ['cpf,name,amount,externalRef', ...rows].join('\n');
}

async function trackUsersFromItems(items: DistributionItem[]): Promise<void> {
  const memberships = await prisma.membership.findMany({
    where: { id: { in: items.map((item) => item.membershipId).filter((id): id is string => Boolean(id)) } },
  });
  for (const membership of memberships) {
    createdUserIds.push(membership.userId);
  }
}

async function pollUntilDone(server: Server, token: string, distributionId: string, timeoutMs: number): Promise<Distribution> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const response = await request(server)
      .get(`/admin/distributions/${distributionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as GetDistributionResponseBody;
    if (body.distribution.status !== 'PENDING' && body.distribution.status !== 'PROCESSING') {
      return body.distribution;
    }

    if (Date.now() > deadline) {
      throw new Error(`Timeout esperando distribuição ${distributionId} terminar (status: ${body.distribution.status})`);
    }

    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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

describe('POST /admin/distributions/csv — upload e validação prévia', () => {
  it('valida cada linha e devolve preview sem creditar nada', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    const cpfDup = randomCpf();
    const csv = csvOf([
      `${randomCpf()},Valido Um,100,EMP-1`,
      `${randomCpf()},Valido Dois,200,`,
      `123abc,CPF Invalido,100,`,
      `${cpfDup},Duplicado A,100,`,
      `${cpfDup},Duplicado B,100,`,
      `${randomCpf()},Valor Invalido,0,`,
    ]);

    const response = await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .field('membershipType', 'EMPLOYEE')
      .attach('file', Buffer.from(csv), 'lote.csv')
      .expect(201);

    const body = response.body as GetDistributionResponseBody;
    expect(body.distribution.status).toBe('PENDING');
    expect(body.distribution.totalItems).toBe(6);
    expect(body.distribution.failedItems).toBe(4);
    expect(body.distribution.successItems).toBe(0);
    expect(body.distribution.csvFileUrl).toBeTruthy();

    const reasons = body.items.items.map((item) => item.errorReason).filter(Boolean);
    expect(reasons).toContain('CPF inválido');
    expect(reasons).toContain('CPF duplicado no arquivo');
    expect(reasons).toContain('Valor inválido');

    const pendingCount = body.items.items.filter((item) => item.status === 'PENDING').length;
    expect(pendingCount).toBe(2);

    // Nada foi creditado ainda — sem batch, upload não pode falhar por saldo.
    const ledgerCount = await prisma.ledgerEntry.count({
      where: { distributionItem: { distributionId: body.distribution.id } },
    });
    expect(ledgerCount).toBe(0);
  });

  it('arquivo acima do limite retorna 400 sem tocar storage', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const oversized = Buffer.alloc(6 * 1024 * 1024, 'a');

    const response = await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .field('membershipType', 'EMPLOYEE')
      .attach('file', oversized, 'grande.csv')
      .expect(400);

    expect((response.body as ErrorResponseBody).code).toBe('VALIDATION_ERROR');
  });

  it('sem arquivo anexado retorna 400', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    const response = await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .field('membershipType', 'EMPLOYEE')
      .expect(400);

    expect((response.body as ErrorResponseBody).code).toBe('VALIDATION_ERROR');
  });

  it('replay com a mesma Idempotency-Key não duplica linhas', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const idempotencyKey = `test-${randomUUID()}`;
    const csv = csvOf([`${randomCpf()},Replay Um,50,`, `${randomCpf()},Replay Dois,50,`]);

    const first = await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .field('membershipType', 'CUSTOMER')
      .attach('file', Buffer.from(csv), 'replay.csv')
      .expect(201);

    const second = await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .field('membershipType', 'CUSTOMER')
      .attach('file', Buffer.from(csv), 'replay.csv')
      .expect(201);

    const firstBody = first.body as GetDistributionResponseBody;
    const secondBody = second.body as GetDistributionResponseBody;
    expect(secondBody.distribution.id).toBe(firstBody.distribution.id);

    const itemCount = await prisma.distributionItem.count({ where: { distributionId: firstBody.distribution.id } });
    expect(itemCount).toBe(2);
  });

  it('OPERATOR não pode fazer upload (rota exige OWNER/MANAGER)', async () => {
    const operator = await createAdmin('OPERATOR');
    const operatorToken = await tokenFor(operator);
    const csv = csvOf([`${randomCpf()},X,10,`]);

    await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${operatorToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .field('membershipType', 'CUSTOMER')
      .attach('file', Buffer.from(csv), 'x.csv')
      .expect(403);
  });
});

describe('POST /admin/distributions/:id/confirm', () => {
  it('confirmar duas vezes a mesma distribuição retorna DISTRIBUTION_NOT_PENDING na segunda', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    await createPaidBatch(owner.organizationId, 1000, 30);
    const csv = csvOf([`${randomCpf()},Confirma Uma Vez,10,`]);

    const upload = await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .field('membershipType', 'EMPLOYEE')
      .attach('file', Buffer.from(csv), 'confirm.csv')
      .expect(201);

    const distributionId = (upload.body as GetDistributionResponseBody).distribution.id;

    await request(server)
      .post(`/admin/distributions/${distributionId}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const second = await request(server)
      .post(`/admin/distributions/${distributionId}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(409);

    expect((second.body as ErrorResponseBody).code).toBe('DISTRIBUTION_NOT_PENDING');

    const finalDistribution = await pollUntilDone(server, ownerToken, distributionId, 15000);
    expect(finalDistribution.status).toBe('COMPLETED');
    const items = await prisma.distributionItem.findMany({ where: { distributionId } });
    await trackUsersFromItems(items);
  }, 30000);
});

describe('GET /admin/distributions/:id', () => {
  it('distribuição de outra organização retorna 404', async () => {
    const ownerA = await createAdmin('OWNER');
    const ownerB = await createAdmin('OWNER');
    const ownerAToken = await tokenFor(ownerA);
    const ownerBToken = await tokenFor(ownerB);
    const csv = csvOf([`${randomCpf()},Isolamento,10,`]);

    const upload = await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .field('membershipType', 'EMPLOYEE')
      .attach('file', Buffer.from(csv), 'isolamento.csv')
      .expect(201);

    const distributionId = (upload.body as GetDistributionResponseBody).distribution.id;

    await request(server)
      .get(`/admin/distributions/${distributionId}`)
      .set('Authorization', `Bearer ${ownerBToken}`)
      .expect(404);
  });
});

describe('fluxo completo: upload -> confirm -> processamento -> minimização de CPF', () => {
  it('linhas OK zeram cpfHash/cpfEncrypted; linhas FAILED mantêm', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    await createPaidBatch(owner.organizationId, 1000, 30);

    const cpfDup = randomCpf();
    const csv = csvOf([
      `${randomCpf()},Sucesso,100,`,
      `${cpfDup},Duplicado A,50,`,
      `${cpfDup},Duplicado B,50,`,
    ]);

    const upload = await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .field('membershipType', 'EMPLOYEE')
      .attach('file', Buffer.from(csv), 'minimizacao.csv')
      .expect(201);

    const uploadBody = upload.body as GetDistributionResponseBody;
    const distributionId = uploadBody.distribution.id;

    // SEGURANÇA: a resposta HTTP do upload nunca pode incluir cpfHash/cpfEncrypted, nem nas
    // linhas FAILED (que no banco mantêm os dois — ver asserções abaixo, direto no Prisma).
    // A minimização é sobre o que sai pra fora, não sobre apagar o dado internamente.
    for (const item of uploadBody.items.items) {
      expect(item).not.toHaveProperty('cpfHash');
      expect(item).not.toHaveProperty('cpfEncrypted');
    }

    await request(server)
      .post(`/admin/distributions/${distributionId}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const finalDistribution = await pollUntilDone(server, ownerToken, distributionId, 15000);
    expect(finalDistribution.status).toBe('COMPLETED_WITH_ERRORS');
    expect(finalDistribution.successItems).toBe(1);
    expect(finalDistribution.failedItems).toBe(2);

    const items = await prisma.distributionItem.findMany({ where: { distributionId } });
    await trackUsersFromItems(items);

    const okItem = items.find((item) => item.status === 'OK');
    expect(okItem?.cpfHash).toBeNull();
    expect(okItem?.cpfEncrypted).toBeNull();

    const failedItems = items.filter((item) => item.status === 'FAILED');
    expect(failedItems).toHaveLength(2);
    for (const failed of failedItems) {
      expect(failed.cpfHash).not.toBeNull();
      expect(failed.cpfEncrypted).not.toBeNull();
      expect(failed.errorReason).toBe('CPF duplicado no arquivo');
    }
  }, 30000);
});

describe('CSV de 1.000 linhas com erros propositais', () => {
  it('processa 940 linhas válidas e falha exatamente 60, sem travar no meio', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const batch = await createPaidBatch(owner.organizationId, 10_000, 60);

    const rows: string[] = [];

    for (let i = 0; i < 20; i += 1) {
      rows.push(`123abc${i},CPF Invalido ${i},10,`);
    }
    for (let i = 0; i < 20; i += 1) {
      rows.push(`${randomCpf()},Valor Invalido ${i},0,`);
    }
    for (let i = 0; i < 10; i += 1) {
      const dup = randomCpf();
      rows.push(`${dup},Duplicado ${i} A,10,`);
      rows.push(`${dup},Duplicado ${i} B,10,`);
    }
    for (let i = 0; i < 940; i += 1) {
      rows.push(`${randomCpf()},Valido ${i},10,EMP-${i}`);
    }

    expect(rows).toHaveLength(1000);

    const csv = csvOf(rows);

    const upload = await request(server)
      .post('/admin/distributions/csv')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .field('membershipType', 'EMPLOYEE')
      .attach('file', Buffer.from(csv), 'mil-linhas.csv')
      .expect(201);

    const uploadBody = upload.body as GetDistributionResponseBody;
    const distributionId = uploadBody.distribution.id;
    expect(uploadBody.distribution.totalItems).toBe(1000);
    expect(uploadBody.distribution.failedItems).toBe(60);
    expect(uploadBody.distribution.status).toBe('PENDING');

    await request(server)
      .post(`/admin/distributions/${distributionId}/confirm`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(201);

    const finalDistribution = await pollUntilDone(server, ownerToken, distributionId, 240_000);

    expect(finalDistribution.status).toBe('COMPLETED_WITH_ERRORS');
    expect(finalDistribution.totalItems).toBe(1000);
    expect(finalDistribution.successItems).toBe(940);
    expect(finalDistribution.failedItems).toBe(60);

    const pendingLeft = await prisma.distributionItem.count({ where: { distributionId, status: 'PENDING' } });
    expect(pendingLeft).toBe(0);

    const okCount = await prisma.distributionItem.count({ where: { distributionId, status: 'OK' } });
    const failedCount = await prisma.distributionItem.count({ where: { distributionId, status: 'FAILED' } });
    expect(okCount).toBe(940);
    expect(failedCount).toBe(60);

    const finalBatch = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(finalBatch.remainingCoins).toBe(10_000 - 940 * 10);

    const ledgerCount = await prisma.ledgerEntry.count({ where: { batchId: batch.id } });
    expect(ledgerCount).toBe(940);

    // Amostra: confere que linhas OK realmente creditaram a wallet certa.
    const sampleOkItems = await prisma.distributionItem.findMany({
      where: { distributionId, status: 'OK' },
      take: 5,
      include: { membership: { include: { wallet: true, user: true } } },
    });
    for (const item of sampleOkItems) {
      expect(item.membership?.wallet?.cachedBalance).toBe(10);
      expect(item.membership?.user.status).toBe('PENDING_CLAIM');
      expect(item.cpfHash).toBeNull();
      expect(item.cpfEncrypted).toBeNull();
    }

    const items = await prisma.distributionItem.findMany({ where: { distributionId } });
    await trackUsersFromItems(items);
  }, 280_000);
});
