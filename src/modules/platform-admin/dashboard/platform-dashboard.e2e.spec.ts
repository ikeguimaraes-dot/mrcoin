import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { OrganizationStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../../auth/password.util';
import { LedgerService } from '../../ledger/ledger.service';
import { PLATFORM_JWT_SERVICE } from '../platform-jwt.token';

interface PlatformDashboardBody {
  cards: {
    organizations: { total: number; active: number; suspended: number; canceled: number };
    partners: { total: number; activeOffers: number };
    coinsInCirculation: number;
    coinsIssuedTotal: number;
    coinsRedeemedTotal: number;
    coinsExpiredTotal: number;
    revenue: { totalInCents: number; currentMonthInCents: number };
  };
  timeseries: {
    months: number;
    points: Array<{ month: string; coinsIssued: number; revenueInCents: number; coinsRedeemed: number }>;
  };
  rankings: {
    topOrganizationsByCoinsIssued: Array<{ organizationId: string; name: string; coinsIssued: number }>;
    topPartnersByConfirmedRedemptions: Array<{
      partnerId: string;
      name: string;
      confirmedRedemptions: number;
      coinsRedeemed: number;
    }>;
  };
  recentActivity: {
    latestBatches: Array<{
      id: string;
      organizationName: string;
      totalCoins: number;
      priceInCents: number;
      status: string;
      createdAt: string;
    }>;
    latestConfirmedRedemptions: Array<{
      id: string;
      partnerName: string;
      offerTitle: string | null;
      amount: number;
      confirmedAt: string;
    }>;
  };
}

const FIXTURE_PASSWORD = 'Test@Password123';
// Astronomicamente maior que qualquer soma possível de fixtures acumuladas por outros specs
// e2e no banco de dev compartilhado — garante 1º lugar nos rankings sem depender de "top N".
const HUGE_AMOUNT = 999_000_000;

const prisma = new PrismaService();
const ledgerService = new LedgerService(prisma);

const createdOrgIds: string[] = [];
const createdPartnerIds: string[] = [];
const createdOfferIds: string[] = [];
const createdUserIds: string[] = [];
const createdWalletIds: string[] = [];
const createdPlatformAdminIds: string[] = [];

let app: INestApplication;
let server: Server;
let platformJwtService: JwtService;

async function createPlatformAdminFixture(): Promise<{ platformAdminId: string; token: string }> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `E2E Platform Dashboard Admin ${suffix}`,
      email: `e2e-platform-dashboard-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  const token = platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
  return { platformAdminId: platformAdmin.id, token };
}

async function createOrg(status: OrganizationStatus = 'ACTIVE'): Promise<{ id: string; name: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: {
      name: `Platform Dashboard Org ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
      status,
    },
  });
  createdOrgIds.push(organization.id);
  return organization;
}

async function createMemberWithWallet(organizationId: string): Promise<{ membershipId: string; walletId: string }> {
  const suffix = randomUUID();
  const cpf = randomInt(10_000_000_000, 100_000_000_000).toString();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Platform Dashboard Member ${suffix}`,
    },
  });
  createdUserIds.push(user.id);

  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId, type: 'CUSTOMER' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id } });
  createdWalletIds.push(wallet.id);

  return { membershipId: membership.id, walletId: wallet.id };
}

async function createPartner(): Promise<{ id: string; name: string }> {
  const suffix = randomUUID();
  const partner = await prisma.partner.create({
    data: {
      name: `Platform Dashboard Partner ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
      category: 'Teste',
      takeRateBps: 500,
      pixKey: `pix-${suffix}@test.coins-api.dev`,
    },
  });
  createdPartnerIds.push(partner.id);
  return partner;
}

async function createOffer(partnerId: string): Promise<{ id: string; title: string }> {
  const suffix = randomUUID();
  const offer = await prisma.offer.create({
    data: {
      partnerId,
      title: `Platform Dashboard Offer ${suffix}`,
      description: `Platform Dashboard Offer ${suffix}`,
      category: 'Teste',
      costInCoins: 10,
      status: 'ACTIVE',
    },
  });
  createdOfferIds.push(offer.id);
  return offer;
}

async function createCoinBatch(params: {
  organizationId: string;
  totalCoins: number;
  priceInCents: number;
  status?: 'PAID' | 'PENDING' | 'EXPIRED' | 'CANCELED';
  updatedAt?: Date;
}) {
  return prisma.coinBatch.create({
    data: {
      organizationId: params.organizationId,
      totalCoins: params.totalCoins,
      remainingCoins: params.totalCoins,
      priceInCents: params.priceInCents,
      status: params.status ?? 'PAID',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...(params.updatedAt ? { updatedAt: params.updatedAt } : {}),
    },
  });
}

async function createConfirmedRedemption(params: {
  membershipId: string;
  walletId: string;
  partnerId: string;
  offerId?: string;
  amount: number;
}) {
  const suffix = randomUUID();
  return prisma.redemption.create({
    data: {
      membershipId: params.membershipId,
      walletId: params.walletId,
      partnerId: params.partnerId,
      offerId: params.offerId ?? null,
      amount: params.amount,
      code: suffix,
      qrPayload: `qr-${suffix}`,
      idempotencyKey: `test-${suffix}`,
      status: 'CONFIRMED',
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      confirmedAt: new Date(),
    },
  });
}

async function getDashboard(token: string): Promise<PlatformDashboardBody> {
  const response = await request(server)
    .get('/platform/dashboard')
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return response.body as PlatformDashboardBody;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
  platformJwtService = app.get<JwtService>(PLATFORM_JWT_SERVICE);
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.redemption.deleteMany({
    where: { OR: [{ partnerId: { in: createdPartnerIds } }, { walletId: { in: createdWalletIds } }] },
  });
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: createdWalletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: createdWalletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.coinBatch.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: createdPartnerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.platformAdminRefreshToken.deleteMany({
    where: { platformAdminId: { in: createdPlatformAdminIds } },
  });
  await prisma.platformAdminAuditLog.deleteMany({
    where: { platformAdminId: { in: createdPlatformAdminIds } },
  });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdPlatformAdminIds } } });
  await prisma.$disconnect();
});

describe('GET /platform/dashboard — cards', () => {
  it('cada card reflete exatamente o delta dos dados criados', async () => {
    const { token } = await createPlatformAdminFixture();
    const before = await getDashboard(token);

    const org = await createOrg('ACTIVE');
    const partner = await createPartner();
    await createOffer(partner.id);

    const member = await createMemberWithWallet(org.id);
    await ledgerService.post({
      walletId: member.walletId,
      type: 'CREDIT',
      amount: 1000,
      referenceType: 'DISTRIBUTION',
      referenceId: randomUUID(),
      description: 'Saldo inicial de teste',
      idempotencyKey: randomUUID(),
    });
    await ledgerService.post({
      walletId: member.walletId,
      type: 'DEBIT',
      amount: 120,
      referenceType: 'REDEMPTION',
      referenceId: randomUUID(),
      description: 'Resgate de teste',
      idempotencyKey: randomUUID(),
    });
    await ledgerService.post({
      walletId: member.walletId,
      type: 'EXPIRE',
      amount: 80,
      referenceType: 'EXPIRATION',
      referenceId: randomUUID(),
      description: 'Expiração de teste',
      idempotencyKey: randomUUID(),
    });
    await createCoinBatch({ organizationId: org.id, totalCoins: 500, priceInCents: 50000 });

    const after = await getDashboard(token);

    expect(after.cards.organizations.total - before.cards.organizations.total).toBe(1);
    expect(after.cards.organizations.active - before.cards.organizations.active).toBe(1);
    expect(after.cards.partners.total - before.cards.partners.total).toBe(1);
    expect(after.cards.partners.activeOffers - before.cards.partners.activeOffers).toBe(1);
    // 1000 (crédito) - 120 (resgate) - 80 (expiração) = 800 em circulação
    expect(after.cards.coinsInCirculation - before.cards.coinsInCirculation).toBe(800);
    expect(after.cards.coinsIssuedTotal - before.cards.coinsIssuedTotal).toBe(500);
    expect(after.cards.coinsRedeemedTotal - before.cards.coinsRedeemedTotal).toBe(120);
    expect(after.cards.coinsExpiredTotal - before.cards.coinsExpiredTotal).toBe(80);
    expect(after.cards.revenue.totalInCents - before.cards.revenue.totalInCents).toBe(50000);
    expect(after.cards.revenue.currentMonthInCents - before.cards.revenue.currentMonthInCents).toBe(50000);
  });

  it('lote PAID em mês anterior conta no total mas não no mês corrente', async () => {
    const { token } = await createPlatformAdminFixture();
    const before = await getDashboard(token);

    const org = await createOrg();
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setUTCMonth(twoMonthsAgo.getUTCMonth() - 2);

    await createCoinBatch({ organizationId: org.id, totalCoins: 10, priceInCents: 10000, updatedAt: twoMonthsAgo });
    await createCoinBatch({ organizationId: org.id, totalCoins: 20, priceInCents: 20000 });

    const after = await getDashboard(token);

    expect(after.cards.revenue.totalInCents - before.cards.revenue.totalInCents).toBe(30000);
    expect(after.cards.revenue.currentMonthInCents - before.cards.revenue.currentMonthInCents).toBe(20000);
  });

  it('lote PENDING não conta em nenhum card', async () => {
    const { token } = await createPlatformAdminFixture();
    const before = await getDashboard(token);

    const org = await createOrg();
    await createCoinBatch({ organizationId: org.id, totalCoins: 999, priceInCents: 99900, status: 'PENDING' });

    const after = await getDashboard(token);

    expect(after.cards.coinsIssuedTotal).toBe(before.cards.coinsIssuedTotal);
    expect(after.cards.revenue.totalInCents).toBe(before.cards.revenue.totalInCents);
  });
});

describe('GET /platform/dashboard — timeseries', () => {
  it('devolve 12 meses e o mês corrente reflete o delta esperado', async () => {
    const { token } = await createPlatformAdminFixture();
    const before = await getDashboard(token);
    expect(before.timeseries.months).toBe(12);
    expect(before.timeseries.points).toHaveLength(12);

    const currentMonth = new Date().toISOString().slice(0, 7);
    const beforePoint = before.timeseries.points.find((p) => p.month === currentMonth);
    expect(beforePoint).toBeDefined();

    const org = await createOrg();
    await createCoinBatch({ organizationId: org.id, totalCoins: 300, priceInCents: 30000 });
    const member = await createMemberWithWallet(org.id);
    await ledgerService.post({
      walletId: member.walletId,
      type: 'CREDIT',
      amount: 200,
      referenceType: 'DISTRIBUTION',
      referenceId: randomUUID(),
      description: 'Saldo pra resgate de teste',
      idempotencyKey: randomUUID(),
    });
    await ledgerService.post({
      walletId: member.walletId,
      type: 'DEBIT',
      amount: 90,
      referenceType: 'REDEMPTION',
      referenceId: randomUUID(),
      description: 'Resgate de teste na série',
      idempotencyKey: randomUUID(),
    });

    const after = await getDashboard(token);
    const afterPoint = after.timeseries.points.find((p) => p.month === currentMonth);
    expect(afterPoint).toBeDefined();

    expect((afterPoint?.coinsIssued ?? 0) - (beforePoint?.coinsIssued ?? 0)).toBe(300);
    expect((afterPoint?.revenueInCents ?? 0) - (beforePoint?.revenueInCents ?? 0)).toBe(30000);
    expect((afterPoint?.coinsRedeemed ?? 0) - (beforePoint?.coinsRedeemed ?? 0)).toBe(90);

    const months = after.timeseries.points.map((p) => p.month);
    expect(months).toEqual([...months].sort());
    expect(months[months.length - 1]).toBe(currentMonth);
  });
});

describe('GET /platform/dashboard — rankings', () => {
  it('organização de teste aparece no topo do ranking de coins emitidos', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    await createCoinBatch({ organizationId: org.id, totalCoins: HUGE_AMOUNT, priceInCents: 1 });

    const body = await getDashboard(token);
    const ranked = body.rankings.topOrganizationsByCoinsIssued.find((r) => r.organizationId === org.id);
    expect(ranked).toBeDefined();
    expect(ranked?.name).toBe(org.name);
    expect(ranked?.coinsIssued).toBe(HUGE_AMOUNT);
  });

  it('parceiro de teste aparece no topo do ranking de resgates confirmados', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const partner = await createPartner();
    const member = await createMemberWithWallet(org.id);

    const REDEMPTION_COUNT = 15;
    await Promise.all(
      Array.from({ length: REDEMPTION_COUNT }, () =>
        createConfirmedRedemption({
          membershipId: member.membershipId,
          walletId: member.walletId,
          partnerId: partner.id,
          amount: 10,
        }),
      ),
    );

    const body = await getDashboard(token);
    const ranked = body.rankings.topPartnersByConfirmedRedemptions.find((r) => r.partnerId === partner.id);
    expect(ranked).toBeDefined();
    expect(ranked?.name).toBe(partner.name);
    expect(ranked?.confirmedRedemptions).toBe(REDEMPTION_COUNT);
    expect(ranked?.coinsRedeemed).toBe(REDEMPTION_COUNT * 10);
  });
});

describe('GET /platform/dashboard — atividade recente', () => {
  it('lote recém-criado aparece em latestBatches com os dados certos', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const batch = await createCoinBatch({ organizationId: org.id, totalCoins: 42, priceInCents: 4200 });

    const body = await getDashboard(token);
    const found = body.recentActivity.latestBatches.find((b) => b.id === batch.id);
    expect(found).toBeDefined();
    expect(found?.organizationName).toBe(org.name);
    expect(found?.totalCoins).toBe(42);
    expect(found?.priceInCents).toBe(4200);
    expect(found?.status).toBe('PAID');
  });

  it('resgate confirmado recém-criado aparece em latestConfirmedRedemptions com os dados certos', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const partner = await createPartner();
    const offer = await createOffer(partner.id);
    const member = await createMemberWithWallet(org.id);

    const redemption = await createConfirmedRedemption({
      membershipId: member.membershipId,
      walletId: member.walletId,
      partnerId: partner.id,
      offerId: offer.id,
      amount: 77,
    });

    const body = await getDashboard(token);
    const found = body.recentActivity.latestConfirmedRedemptions.find((r) => r.id === redemption.id);
    expect(found).toBeDefined();
    expect(found?.partnerName).toBe(partner.name);
    expect(found?.offerTitle).toBe(offer.title);
    expect(found?.amount).toBe(77);
  });
});

describe('Isolamento total — apenas PlatformAdmin acessa GET /platform/dashboard', () => {
  it('token de AdminUser e de Partner recebem 401', async () => {
    const jwtService = app.get(JwtService);
    const adminToken = jwtService.sign({ sub: randomUUID(), organizationId: randomUUID(), role: 'OPERATOR', type: 'admin' });
    const partnerToken = jwtService.sign({ sub: randomUUID(), type: 'partner' });

    for (const badToken of [adminToken, partnerToken]) {
      await request(server)
        .get('/platform/dashboard')
        .set('Authorization', `Bearer ${badToken}`)
        .expect(401);
    }
  });

  it('sem token recebe 401', async () => {
    await request(server).get('/platform/dashboard').expect(401);
  });
});
