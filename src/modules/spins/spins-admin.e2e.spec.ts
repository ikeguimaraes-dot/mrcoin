import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { AdminRole, CoinBatch } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { hashCpf } from '../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../auth/password.util';
import { TokenService } from '../auth/token.service';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';

interface SpinItemBody {
  id: string;
  expiresAt: string;
}

interface GrantSpinsResponseBody {
  id: string;
  membershipId: string;
  quantity: number;
  spins: SpinItemBody[];
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
    data: { name: `Spins Admin Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `Spins Test Admin ${role} ${suffix}`,
      email: `spins-admin-test-${role.toLowerCase()}-${suffix}@test.coins-api.dev`,
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

function grantBody(cpf: string, quantity: number) {
  return { cpf, name: 'Fulano de Tal', quantity, membershipType: 'EMPLOYEE' as const };
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
  await prisma.spin.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.spinGrant.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: users.map((u) => u.id) } } });
  await prisma.coinBatch.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('POST /admin/spins', () => {
  it('concede giros pra CPF novo — cria User/Membership/Wallet e reserva 1.000/giro do lote', async () => {
    const owner = await createAdmin('OWNER');
    const token = await tokenFor(owner);
    const batch = await createPaidBatch(owner.organizationId, 5000, 90);

    const cpf = randomCpf();
    const res = await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send(grantBody(cpf, 3))
      .expect(201);

    const body = res.body as GrantSpinsResponseBody;
    expect(body.quantity).toBe(3);
    expect(body.spins).toHaveLength(3);

    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    createdUserIds.push(user.id);
    expect(user.status).toBe('PENDING_CLAIM');

    const spins = await prisma.spin.findMany({ where: { spinGrantId: body.id } });
    expect(spins).toHaveLength(3);
    expect(spins.every((s) => s.reservedBatchId === batch.id)).toBe(true);
    expect(spins.every((s) => s.status === 'PENDING')).toBe(true);

    const drainedBatch = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(drainedBatch.remainingCoins).toBe(5000 - 3 * 1000);
  });

  it('concede giros pra CPF já existente na organização', async () => {
    const owner = await createAdmin('OWNER');
    const token = await tokenFor(owner);
    await createPaidBatch(owner.organizationId, 5000, 90);

    const cpf = randomCpf();
    await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send(grantBody(cpf, 1))
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    createdUserIds.push(user.id);

    const second = await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send(grantBody(cpf, 2))
      .expect(201);
    const secondBody = second.body as GrantSpinsResponseBody;
    expect(secondBody.membershipId).toBeDefined();

    const totalSpins = await prisma.spin.count({ where: { membershipId: secondBody.membershipId } });
    expect(totalSpins).toBe(3);
  });

  it('estoque insuficiente rejeita a concessão inteira — nenhum Spin fica órfão', async () => {
    const owner = await createAdmin('OWNER');
    const token = await tokenFor(owner);
    // Só um lote com 2.500 — dá pra 2 giros (2.000), não pra 3 (3.000).
    await createPaidBatch(owner.organizationId, 2500, 90);

    const cpf = randomCpf();
    const res = await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send(grantBody(cpf, 3))
      .expect(422);

    expect((res.body as ErrorResponseBody).code).toBe('INSUFFICIENT_COIN_STOCK');

    const user = await prisma.user.findUnique({ where: { cpfHash: hashCpf(cpf) } });
    // Nem o User chegou a ser criado — a transação inteira reverteu (falha antes de qualquer
    // escrita sobreviver), incluindo o upsert de User/Membership/Wallet.
    expect(user).toBeNull();
  });

  it('duas concessões concorrentes que juntas excedem o estoque — a 2ª rejeita (prova da reserva real)', async () => {
    const owner = await createAdmin('OWNER');
    const token = await tokenFor(owner);
    // Só 1.500 disponíveis — dá pra exatamente UMA concessão de 1 giro (reserva 1.000), a
    // segunda não encontra lote com 1.000+ sobrando.
    await createPaidBatch(owner.organizationId, 1500, 90);

    const cpf1 = randomCpf();
    const cpf2 = randomCpf();

    const first = await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send(grantBody(cpf1, 1))
      .expect(201);
    const firstUser = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf1) } });
    createdUserIds.push(firstUser.id);
    expect((first.body as GrantSpinsResponseBody).spins).toHaveLength(1);

    const second = await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send(grantBody(cpf2, 1))
      .expect(422);
    expect((second.body as ErrorResponseBody).code).toBe('INSUFFICIENT_COIN_STOCK');
  });

  it('replay por Idempotency-Key não duplica giros nem re-decrementa remainingCoins', async () => {
    const owner = await createAdmin('OWNER');
    const token = await tokenFor(owner);
    const batch = await createPaidBatch(owner.organizationId, 5000, 90);

    const cpf = randomCpf();
    const idempotencyKey = `test-${randomUUID()}`;
    const first = await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(grantBody(cpf, 2))
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    createdUserIds.push(user.id);

    const second = await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send(grantBody(cpf, 2))
      .expect(201);

    expect((second.body as GrantSpinsResponseBody).id).toBe((first.body as GrantSpinsResponseBody).id);

    const spins = await prisma.spin.findMany({ where: { spinGrantId: (first.body as GrantSpinsResponseBody).id } });
    expect(spins).toHaveLength(2);

    const batchAfter = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchAfter.remainingCoins).toBe(5000 - 2 * 1000);
  });

  it('isolamento por organização — token de uma org não concede giros contra o lote de outra', async () => {
    const ownerA = await createAdmin('OWNER');
    const ownerB = await createAdmin('OWNER');
    const tokenA = await tokenFor(ownerA);
    await createPaidBatch(ownerB.organizationId, 5000, 90);

    const cpf = randomCpf();
    const res = await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send(grantBody(cpf, 1))
      .expect(422);

    expect((res.body as ErrorResponseBody).code).toBe('INSUFFICIENT_COIN_STOCK');
  });

  it('sem token retorna 401; role OPERATOR retorna 403', async () => {
    const owner = await createAdmin('OWNER');
    await createPaidBatch(owner.organizationId, 5000, 90);

    await request(server)
      .post('/admin/spins')
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send(grantBody(randomCpf(), 1))
      .expect(401);

    const operator = await createAdmin('OPERATOR');
    const operatorToken = await tokenFor(operator);
    await request(server)
      .post('/admin/spins')
      .set('Authorization', `Bearer ${operatorToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send(grantBody(randomCpf(), 1))
      .expect(403);
  });
});
