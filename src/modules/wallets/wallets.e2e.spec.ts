import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { LedgerService } from '../ledger/ledger.service';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';

interface ExpiringBatchBody {
  batchId: string;
  amount: number;
}

interface WalletResponseBody {
  cachedBalance: number;
  totalEarned: number;
  totalSpent: number;
  expiring: ExpiringBatchBody[];
}

interface EntryBody {
  id: string;
}

interface EntriesResponseBody {
  items: EntryBody[];
  nextCursor: string | null;
}

interface ErrorResponseBody {
  code: string;
}

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const ledgerService = new LedgerService(prisma);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

function tokenFor(userId: string): Promise<string> {
  return jwtService.signAsync({ sub: userId, type: 'user' });
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Wallet Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

async function createUserWithWallet(organizationId: string): Promise<{ userId: string; walletId: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Wallet Test User ${suffix}`,
      email: `wallet-test-${suffix}@test.coins-api.dev`,
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
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('GET /wallet', () => {
  it('saldo bate com cachedBalance e "coins a expirar" reflete o batch com saldo positivo', async () => {
    const org = await createOrg();
    const { userId, walletId } = await createUserWithWallet(org.id);

    const batch = await prisma.coinBatch.create({
      data: {
        organizationId: org.id,
        totalCoins: 1000,
        remainingCoins: 1000,
        priceInCents: 100000,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 500,
      referenceType: 'DISTRIBUTION',
      referenceId: randomUUID(),
      description: 'Distribuição inicial',
      batchId: batch.id,
      idempotencyKey: randomUUID(),
    });
    await ledgerService.post({
      walletId,
      type: 'DEBIT',
      amount: 150,
      referenceType: 'REDEMPTION',
      referenceId: randomUUID(),
      description: 'Resgate',
      batchId: batch.id,
      idempotencyKey: randomUUID(),
    });

    const token = await tokenFor(userId);
    const response = await request(server)
      .get('/wallet')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as WalletResponseBody;
    expect(body.cachedBalance).toBe(350);
    expect(body.totalEarned).toBe(500);
    expect(body.totalSpent).toBe(150);
    expect(body.expiring).toHaveLength(1);
    expect(body.expiring[0]?.batchId).toBe(batch.id);
    expect(body.expiring[0]?.amount).toBe(350);
  });

  it('usuário sem Membership na organização recebe MEMBERSHIP_NOT_FOUND', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const { userId } = await createUserWithWallet(orgA.id);
    const token = await tokenFor(userId);

    const response = await request(server)
      .get('/wallet')
      .query({ organizationId: orgB.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    expect((response.body as ErrorResponseBody).code).toBe('MEMBERSHIP_NOT_FOUND');
  });

  it('usuário nunca acessa a wallet de outro usuário na mesma organização', async () => {
    const org = await createOrg();
    const userA = await createUserWithWallet(org.id);
    const userB = await createUserWithWallet(org.id);

    await ledgerService.post({
      walletId: userA.walletId,
      type: 'CREDIT',
      amount: 999,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Ajuste em A',
      idempotencyKey: randomUUID(),
    });

    const tokenB = await tokenFor(userB.userId);
    const response = await request(server)
      .get('/wallet')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    const body = response.body as WalletResponseBody;
    expect(body.cachedBalance).toBe(0);
    expect(body.totalEarned).toBe(0);
    expect(body.totalSpent).toBe(0);
  });
});

describe('totalEarned/totalSpent', () => {
  it('CREDIT/DEBIT-REDEMPTION líquidos de estorno; EXPIRE fica de fora dos dois mas reduz cachedBalance', async () => {
    const org = await createOrg();
    const { userId, walletId } = await createUserWithWallet(org.id);
    const token = await tokenFor(userId);

    async function getWallet(): Promise<WalletResponseBody> {
      const res = await request(server)
        .get('/wallet')
        .query({ organizationId: org.id })
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      return res.body as WalletResponseBody;
    }

    const creditA = await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 1000,
      referenceType: 'DISTRIBUTION',
      referenceId: randomUUID(),
      description: 'Distribuição A',
      idempotencyKey: randomUUID(),
    });
    const creditB = await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 300,
      referenceType: 'DISTRIBUTION',
      referenceId: randomUUID(),
      description: 'Distribuição B',
      idempotencyKey: randomUUID(),
    });
    await ledgerService.post({
      walletId,
      type: 'DEBIT',
      amount: 200,
      referenceType: 'REDEMPTION',
      referenceId: randomUUID(),
      description: 'Resgate A',
      idempotencyKey: randomUUID(),
    });
    const debitB = await ledgerService.post({
      walletId,
      type: 'DEBIT',
      amount: 150,
      referenceType: 'REDEMPTION',
      referenceId: randomUUID(),
      description: 'Resgate B',
      idempotencyKey: randomUUID(),
    });

    let body = await getWallet();
    expect(body.totalEarned).toBe(1300);
    expect(body.totalSpent).toBe(350);
    expect(body.cachedBalance).toBe(950);

    // Estorna a distribuição B (300) — totalEarned líquido cai, totalSpent intocado.
    await ledgerService.reverse({ entryId: creditB.id, reason: 'Correção', idempotencyKey: randomUUID() });
    body = await getWallet();
    expect(body.totalEarned).toBe(1000);
    expect(body.totalSpent).toBe(350);
    expect(body.cachedBalance).toBe(650);

    // Estorna o resgate B (150) — totalSpent líquido cai, totalEarned intocado.
    await ledgerService.reverse({ entryId: debitB.id, reason: 'Estorno de resgate', idempotencyKey: randomUUID() });
    body = await getWallet();
    expect(body.totalEarned).toBe(1000);
    expect(body.totalSpent).toBe(200);
    expect(body.cachedBalance).toBe(800);

    // EXPIRE não é "gasto" nem desfaz "ganho" — fica de fora dos dois totais, mas o saldo
    // cai de verdade. totalEarned - totalSpent (800) > cachedBalance (700): a diferença (100)
    // é exatamente o total expirado, por definição não exposto como campo próprio.
    await ledgerService.post({
      walletId,
      type: 'EXPIRE',
      amount: 100,
      referenceType: 'EXPIRATION',
      referenceId: creditA.id,
      description: 'Expiração',
      idempotencyKey: randomUUID(),
    });
    body = await getWallet();
    expect(body.totalEarned).toBe(1000);
    expect(body.totalSpent).toBe(200);
    expect(body.cachedBalance).toBe(700);
    expect(body.totalEarned - body.totalSpent).toBeGreaterThan(body.cachedBalance);
    expect(body.totalEarned - body.totalSpent - body.cachedBalance).toBe(100);
  });
});

describe('GET /wallet/entries', () => {
  it('pagina por cursor', async () => {
    const org = await createOrg();
    const { userId, walletId } = await createUserWithWallet(org.id);

    for (let i = 0; i < 3; i += 1) {
      await ledgerService.post({
        walletId,
        type: 'CREDIT',
        amount: 10,
        referenceType: 'MANUAL_ADJUSTMENT',
        referenceId: randomUUID(),
        description: `Entry ${i}`,
        idempotencyKey: randomUUID(),
      });
    }

    const token = await tokenFor(userId);
    const firstPage = await request(server)
      .get('/wallet/entries')
      .query({ organizationId: org.id, limit: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const firstBody = firstPage.body as EntriesResponseBody;
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).toBeTruthy();

    const secondPage = await request(server)
      .get('/wallet/entries')
      .query({ organizationId: org.id, limit: 2, cursor: firstBody.nextCursor as string })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const secondBody = secondPage.body as EntriesResponseBody;
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();
  });

  it('SEGURANÇA: nunca inclui hash/prevHash/idempotencyKey — auditoria interna do ledger não sai pra fora', async () => {
    const org = await createOrg();
    const { userId, walletId } = await createUserWithWallet(org.id);

    await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 10,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Entry',
      idempotencyKey: randomUUID(),
    });

    const token = await tokenFor(userId);
    const response = await request(server)
      .get('/wallet/entries')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as EntriesResponseBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty('hash');
    expect(body.items[0]).not.toHaveProperty('prevHash');
    expect(body.items[0]).not.toHaveProperty('idempotencyKey');
  });
});
