import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AdminRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../auth/password.util';
import { TokenService } from '../auth/token.service';
import { LedgerService } from '../ledger/ledger.service';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';

interface SummaryResponseBody {
  availableBalance: number;
  circulatingBalance: number;
  redeemedThisMonth: number;
}

interface TimeseriesPointBody {
  date: string;
  issued: number;
  redeemed: number;
}

interface TimeseriesResponseBody {
  days: number;
  points: TimeseriesPointBody[];
}

const FIXTURE_PASSWORD = 'Test@Password123';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const tokenService = new TokenService(jwtService, prisma);
const ledgerService = new LedgerService(prisma);

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

async function createAdmin(role: AdminRole): Promise<AdminFixture> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Dashboard Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `Dashboard Test Admin ${suffix}`,
      email: `dashboard-test-${suffix}@test.coins-api.dev`,
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

async function createMemberWithWallet(organizationId: string): Promise<{ userId: string; walletId: string }> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(suffix.replace(/-/g, '').slice(0, 11)),
      cpfHash: hashCpf(suffix.replace(/-/g, '').slice(0, 11)),
      name: `Dashboard Test Member ${suffix}`,
    },
  });
  createdUserIds.push(user.id);

  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId, type: 'CUSTOMER' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id } });

  return { userId: user.id, walletId: wallet.id };
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
  const walletIds = (
    await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } })
  ).map((w) => w.id);

  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.coinBatch.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('GET /admin/dashboard/summary', () => {
  it('isola por organização — dados de outra org nunca aparecem', async () => {
    const orgA = await createAdmin('OWNER');
    const orgB = await createAdmin('OWNER');

    const memberB = await createMemberWithWallet(orgB.organizationId);
    await ledgerService.post({
      walletId: memberB.walletId,
      type: 'CREDIT',
      amount: 500,
      referenceType: 'DISTRIBUTION',
      referenceId: randomUUID(),
      description: 'Distribuição em B',
      idempotencyKey: randomUUID(),
    });
    await prisma.coinBatch.create({
      data: {
        organizationId: orgB.organizationId,
        totalCoins: 1000,
        remainingCoins: 1000,
        priceInCents: 100000,
        status: 'PAID',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const tokenA = await tokenFor(orgA);
    const response = await request(server)
      .get('/admin/dashboard/summary')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const body = response.body as SummaryResponseBody;
    expect(body).toEqual({ availableBalance: 0, circulatingBalance: 0, redeemedThisMonth: 0 });
  });

  it('availableBalance soma só CoinBatch PAID, ignora PENDING', async () => {
    const org = await createAdmin('OWNER');
    await prisma.coinBatch.create({
      data: {
        organizationId: org.organizationId,
        totalCoins: 700,
        remainingCoins: 700,
        priceInCents: 70000,
        status: 'PAID',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.coinBatch.create({
      data: {
        organizationId: org.organizationId,
        totalCoins: 500,
        remainingCoins: 500,
        priceInCents: 50000,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const token = await tokenFor(org);
    const response = await request(server)
      .get('/admin/dashboard/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((response.body as SummaryResponseBody).availableBalance).toBe(700);
  });

  it('circulatingBalance soma cachedBalance de todas as wallets da org', async () => {
    const org = await createAdmin('OWNER');
    const memberA = await createMemberWithWallet(org.organizationId);
    const memberB = await createMemberWithWallet(org.organizationId);

    await ledgerService.post({
      walletId: memberA.walletId,
      type: 'CREDIT',
      amount: 300,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Ajuste A',
      idempotencyKey: randomUUID(),
    });
    await ledgerService.post({
      walletId: memberB.walletId,
      type: 'CREDIT',
      amount: 450,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Ajuste B',
      idempotencyKey: randomUUID(),
    });

    const token = await tokenFor(org);
    const response = await request(server)
      .get('/admin/dashboard/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((response.body as SummaryResponseBody).circulatingBalance).toBe(750);
  });

  it('redeemedThisMonth é líquido de estorno — resgate revertido não conta, resgate não revertido conta', async () => {
    const org = await createAdmin('OWNER');
    const member = await createMemberWithWallet(org.organizationId);

    await ledgerService.post({
      walletId: member.walletId,
      type: 'CREDIT',
      amount: 1000,
      referenceType: 'DISTRIBUTION',
      referenceId: randomUUID(),
      description: 'Saldo inicial',
      idempotencyKey: randomUUID(),
    });

    const reversedDebit = await ledgerService.post({
      walletId: member.walletId,
      type: 'DEBIT',
      amount: 200,
      referenceType: 'REDEMPTION',
      referenceId: randomUUID(),
      description: 'Resgate revertido',
      idempotencyKey: randomUUID(),
    });
    await ledgerService.reverse({
      entryId: reversedDebit.id,
      reason: 'Estorno de teste',
      idempotencyKey: randomUUID(),
    });

    await ledgerService.post({
      walletId: member.walletId,
      type: 'DEBIT',
      amount: 150,
      referenceType: 'REDEMPTION',
      referenceId: randomUUID(),
      description: 'Resgate não revertido',
      idempotencyKey: randomUUID(),
    });

    // DEBIT fora de REDEMPTION não pode entrar na soma (saldo nesse ponto: 1000 - 150 = 850).
    await ledgerService.post({
      walletId: member.walletId,
      type: 'DEBIT',
      amount: 50,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Ajuste, não é resgate',
      idempotencyKey: randomUUID(),
    });

    const token = await tokenFor(org);
    const response = await request(server)
      .get('/admin/dashboard/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((response.body as SummaryResponseBody).redeemedThisMonth).toBe(150);
  });
});

describe('GET /admin/dashboard/timeseries', () => {
  it('devolve um ponto por dia, mesmo sem atividade nenhuma', async () => {
    const org = await createAdmin('OWNER');
    const token = await tokenFor(org);

    const response = await request(server)
      .get('/admin/dashboard/timeseries')
      .query({ days: 5 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as TimeseriesResponseBody;
    expect(body.days).toBe(5);
    expect(body.points).toHaveLength(5);
    for (const point of body.points) {
      expect(point.issued).toBe(0);
      expect(point.redeemed).toBe(0);
    }

    const today = new Date().toISOString().slice(0, 10);
    expect(body.points[body.points.length - 1]?.date).toBe(today);

    const dates = body.points.map((p) => p.date);
    const sorted = [...dates].sort();
    expect(dates).toEqual(sorted);
  });

  it('issued é líquido de estorno no dia de hoje', async () => {
    const org = await createAdmin('OWNER');
    const member = await createMemberWithWallet(org.organizationId);

    const entry = await ledgerService.post({
      walletId: member.walletId,
      type: 'CREDIT',
      amount: 100,
      referenceType: 'DISTRIBUTION',
      referenceId: randomUUID(),
      description: 'Emissão de hoje',
      idempotencyKey: randomUUID(),
    });

    const token = await tokenFor(org);
    const beforeReversal = await request(server)
      .get('/admin/dashboard/timeseries')
      .query({ days: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((beforeReversal.body as TimeseriesResponseBody).points[0]?.issued).toBe(100);

    await ledgerService.reverse({
      entryId: entry.id,
      reason: 'Estorno de teste',
      idempotencyKey: randomUUID(),
    });

    const afterReversal = await request(server)
      .get('/admin/dashboard/timeseries')
      .query({ days: 1 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((afterReversal.body as TimeseriesResponseBody).points[0]?.issued).toBe(0);
  });

  it('isola por organização — join do raw SQL não vaza dado de outra org', async () => {
    const orgA = await createAdmin('OWNER');
    const orgB = await createAdmin('OWNER');
    const memberB = await createMemberWithWallet(orgB.organizationId);

    await ledgerService.post({
      walletId: memberB.walletId,
      type: 'CREDIT',
      amount: 777,
      referenceType: 'DISTRIBUTION',
      referenceId: randomUUID(),
      description: 'Emissão em B',
      idempotencyKey: randomUUID(),
    });

    const tokenA = await tokenFor(orgA);
    const response = await request(server)
      .get('/admin/dashboard/timeseries')
      .query({ days: 3 })
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    const body = response.body as TimeseriesResponseBody;
    for (const point of body.points) {
      expect(point.issued).toBe(0);
      expect(point.redeemed).toBe(0);
    }
  });
});
