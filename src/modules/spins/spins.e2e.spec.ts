import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { CoinBatch, Spin, SpinGrant } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../auth/password.util';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { SPIN_SECTORS } from './spins.constants';

interface SpinsAvailableResponseBody {
  availableSpins: number;
  sectors: number[];
}

interface RedeemSpinResponseBody {
  sectorIndex: number;
  coinsAwarded: number;
}

interface RankingResponseBody {
  currentUser: { position: number; coinsEarned: number };
}

interface ErrorResponseBody {
  code: string;
}

const FIXTURE_PASSWORD = 'Test@Password123';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;
let moduleRef: TestingModule;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

function tokenFor(userId: string): Promise<string> {
  return jwtService.signAsync({ sub: userId, type: 'user' });
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Spins Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

async function createMember(organizationId: string): Promise<{ userId: string; membershipId: string; walletId: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name: `Spins Test User ${suffix}` },
  });
  createdUserIds.push(user.id);
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId, type: 'EMPLOYEE' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id } });
  return { userId: user.id, membershipId: membership.id, walletId: wallet.id };
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

async function createAdminForOrg(organizationId: string): Promise<string> {
  const suffix = randomUUID();
  const admin = await prisma.adminUser.create({
    data: {
      organizationId,
      name: `Spins Test Admin ${suffix}`,
      email: `spins-test-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role: 'OWNER',
    },
  });
  return admin.id;
}

async function createSpinGrantFixture(
  organizationId: string,
  membershipId: string,
  quantity: number,
): Promise<SpinGrant> {
  const adminUserId = await createAdminForOrg(organizationId);
  return prisma.spinGrant.create({
    data: { organizationId, adminUserId, membershipId, quantity, idempotencyKey: randomUUID() },
  });
}

/** Cria um Spin PENDING já "reservado" — decrementa o lote em 1.000 igual a concessão de
 * verdade faria, pra manter o invariante (reserva == decremento real) consistente nos testes
 * que manipulam Spin diretamente via Prisma. */
async function createReservedSpin(params: {
  organizationId: string;
  membershipId: string;
  batch: CoinBatch;
  expiresAt?: Date;
}): Promise<Spin> {
  const grant = await createSpinGrantFixture(params.organizationId, params.membershipId, 1);
  await prisma.coinBatch.update({ where: { id: params.batch.id }, data: { remainingCoins: { decrement: 1000 } } });
  return prisma.spin.create({
    data: {
      spinGrantId: grant.id,
      organizationId: params.organizationId,
      membershipId: params.membershipId,
      reservedBatchId: params.batch.id,
      expiresAt: params.expiresAt ?? params.batch.expiresAt,
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
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const wallets = await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  const walletIds = wallets.map((w) => w.id);

  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.spin.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.spinGrant.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.adminUser.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.coinBatch.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('GET /spins', () => {
  it('conta os giros PENDING disponíveis e exclui os expirados, liberando a reserva de volta pro lote', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const batch = await createPaidBatch(org.id, 5000, 90);

    await createReservedSpin({ organizationId: org.id, membershipId: member.membershipId, batch });
    await createReservedSpin({ organizationId: org.id, membershipId: member.membershipId, batch });
    const expired = await createReservedSpin({
      organizationId: org.id,
      membershipId: member.membershipId,
      batch,
      expiresAt: new Date(Date.now() - 1000),
    });

    const batchBefore = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });

    const res = await request(server)
      .get('/spins')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((res.body as SpinsAvailableResponseBody).availableSpins).toBe(2);
    expect((res.body as SpinsAvailableResponseBody).sectors).toEqual([...SPIN_SECTORS]);

    const expiredAfter = await prisma.spin.findUniqueOrThrow({ where: { id: expired.id } });
    expect(expiredAfter.status).toBe('EXPIRED');

    const batchAfter = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchAfter.remainingCoins).toBe(batchBefore.remainingCoins + 1000);
  });

  it('devolve sectors mesmo com availableSpins zerado — o app desenha a roleta independente de ter giro', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);

    const res = await request(server)
      .get('/spins')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as SpinsAvailableResponseBody;

    expect(body.availableSpins).toBe(0);
    expect(body.sectors).toEqual([...SPIN_SECTORS]);
  });

  it('sem token retorna 401', async () => {
    const org = await createOrg();
    await request(server).get('/spins').query({ organizationId: org.id }).expect(401);
  });
});

describe('POST /spins/redeem', () => {
  it('sorteia dentro dos 8 setores válidos e credita exatamente o valor sorteado, liberando a sobra pro lote', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const batch = await createPaidBatch(org.id, 20_000, 90);

    for (let i = 0; i < 15; i += 1) {
      await createReservedSpin({ organizationId: org.id, membershipId: member.membershipId, batch });
    }

    for (let i = 0; i < 15; i += 1) {
      const batchBefore = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });

      const res = await request(server)
        .post('/spins/redeem')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `test-${randomUUID()}`)
        .send({ organizationId: org.id })
        .expect(201);
      const body = res.body as RedeemSpinResponseBody;

      expect(body.sectorIndex).toBeGreaterThanOrEqual(0);
      expect(body.sectorIndex).toBeLessThan(SPIN_SECTORS.length);
      expect(body.coinsAwarded).toBe(SPIN_SECTORS[body.sectorIndex]);

      const batchAfter = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
      expect(batchAfter.remainingCoins).toBe(batchBefore.remainingCoins + (1000 - body.coinsAwarded));
    }

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: member.walletId } });
    const entries = await prisma.ledgerEntry.findMany({ where: { walletId: member.walletId, referenceType: 'SPIN' } });
    expect(entries).toHaveLength(15);
    const totalAwarded = entries.reduce((sum, e) => sum + e.amount, 0);
    expect(wallet.cachedBalance).toBe(totalAwarded);
  });

  it('girar sem giro disponível retorna 422 NO_SPIN_AVAILABLE', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);

    const res = await request(server)
      .post('/spins/redeem')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id })
      .expect(422);
    expect((res.body as ErrorResponseBody).code).toBe('NO_SPIN_AVAILABLE');
  });

  it('giro expirado não pode ser resgatado — libera a reserva automaticamente e não sobra nenhum giro', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const batch = await createPaidBatch(org.id, 5000, 90);

    await createReservedSpin({
      organizationId: org.id,
      membershipId: member.membershipId,
      batch,
      expiresAt: new Date(Date.now() - 1000),
    });
    const batchBefore = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });

    const res = await request(server)
      .post('/spins/redeem')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id })
      .expect(422);
    expect((res.body as ErrorResponseBody).code).toBe('NO_SPIN_AVAILABLE');

    const batchAfter = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(batchAfter.remainingCoins).toBe(batchBefore.remainingCoins + 1000);
  });

  it('replay por Idempotency-Key devolve o mesmo resultado, sem consumir 2º giro nem creditar 2x', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const batch = await createPaidBatch(org.id, 5000, 90);
    await createReservedSpin({ organizationId: org.id, membershipId: member.membershipId, batch });
    await createReservedSpin({ organizationId: org.id, membershipId: member.membershipId, batch });

    const idempotencyKey = `test-${randomUUID()}`;
    const first = await request(server)
      .post('/spins/redeem')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ organizationId: org.id })
      .expect(201);

    const second = await request(server)
      .post('/spins/redeem')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ organizationId: org.id })
      .expect(201);

    expect(second.body).toEqual(first.body);

    const entries = await prisma.ledgerEntry.findMany({ where: { walletId: member.walletId, referenceType: 'SPIN' } });
    expect(entries).toHaveLength(1);

    const remaining = await request(server)
      .get('/spins')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    // Só 1 dos 2 giros foi consumido pelo replay (a mesma chave nunca consome um 2º).
    expect((remaining.body as SpinsAvailableResponseBody).availableSpins).toBe(1);
  });

  it('duas chamadas concorrentes nunca consomem o mesmo giro duas vezes', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const batch = await createPaidBatch(org.id, 5000, 90);
    await createReservedSpin({ organizationId: org.id, membershipId: member.membershipId, batch });

    const [resA, resB] = await Promise.all([
      request(server)
        .post('/spins/redeem')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `test-${randomUUID()}`)
        .send({ organizationId: org.id }),
      request(server)
        .post('/spins/redeem')
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `test-${randomUUID()}`)
        .send({ organizationId: org.id }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 422]);

    const entries = await prisma.ledgerEntry.findMany({ where: { walletId: member.walletId, referenceType: 'SPIN' } });
    expect(entries).toHaveLength(1);
  });

  it('isolamento por organização — membro de outra org sem giro não resgata nada', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const memberB = await createMember(orgB.id);
    const tokenB = await tokenFor(memberB.userId);
    const batch = await createPaidBatch(orgA.id, 5000, 90);
    const memberA = await createMember(orgA.id);
    await createReservedSpin({ organizationId: orgA.id, membershipId: memberA.membershipId, batch });

    const res = await request(server)
      .post('/spins/redeem')
      .set('Authorization', `Bearer ${tokenB}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: orgB.id })
      .expect(422);
    expect((res.body as ErrorResponseBody).code).toBe('NO_SPIN_AVAILABLE');
  });

  it('sem token retorna 401', async () => {
    const org = await createOrg();
    await request(server)
      .post('/spins/redeem')
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id })
      .expect(401);
  });
});

describe('GET /ranking conta prêmio de roleta', () => {
  it('coins ganhos via roleta somam junto com distribuição no ranking mensal', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const batch = await createPaidBatch(org.id, 5000, 90);
    await createReservedSpin({ organizationId: org.id, membershipId: member.membershipId, batch });

    const redeemRes = await request(server)
      .post('/spins/redeem')
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id })
      .expect(201);
    const { coinsAwarded } = redeemRes.body as RedeemSpinResponseBody;

    const rankingRes = await request(server)
      .get('/ranking')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((rankingRes.body as RankingResponseBody).currentUser.coinsEarned).toBe(coinsAwarded);
  });
});
