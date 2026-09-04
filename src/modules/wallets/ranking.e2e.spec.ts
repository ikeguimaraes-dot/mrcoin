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

interface RankingItemBody {
  position: number;
  name: string;
  coinsEarned: number;
}

interface RankingResponseBody {
  items: RankingItemBody[];
  currentUser: { position: number; coinsEarned: number };
  period: string;
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

function monthsAgo(n: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - n, 15, 12, 0, 0));
}

function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Ranking Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

async function createMember(
  organizationId: string,
  overrides: { status?: 'ACTIVE' | 'INACTIVE' } = {},
): Promise<{ userId: string; walletId: string; membershipId: string; name: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const name = `Ranking Test User ${suffix}`;
  const user = await prisma.user.create({
    data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name, email: `ranking-${suffix}@test.coins-api.dev` },
  });
  createdUserIds.push(user.id);

  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId, type: 'CUSTOMER', status: overrides.status ?? 'ACTIVE' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id } });

  return { userId: user.id, walletId: wallet.id, membershipId: membership.id, name };
}

async function creditDistribution(walletId: string, amount: number, at?: Date): Promise<string> {
  const entry = await ledgerService.post({
    walletId,
    type: 'CREDIT',
    amount,
    referenceType: 'DISTRIBUTION',
    referenceId: randomUUID(),
    description: 'Distribuição',
    idempotencyKey: randomUUID(),
  });
  if (at) {
    await prisma.ledgerEntry.update({ where: { id: entry.id }, data: { createdAt: at } });
  }
  return entry.id;
}

async function getRanking(
  token: string,
  organizationId: string,
  period?: string,
): Promise<{ status: number; body: RankingResponseBody | ErrorResponseBody }> {
  const res = await request(server)
    .get('/ranking')
    .query(period ? { organizationId, period } : { organizationId })
    .set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body as RankingResponseBody | ErrorResponseBody };
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
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('GET /ranking', () => {
  it('top 10 correto e ordenado por coins ganhos desc', async () => {
    const org = await createOrg();
    const members = [];
    for (let i = 0; i < 12; i += 1) {
      members.push(await createMember(org.id));
    }
    // Valores distintos, em ordem "embaralhada" de criação — confere que a resposta ordena.
    const amounts = [50, 120, 10, 90, 60, 30, 110, 20, 100, 70, 80, 40];
    for (let i = 0; i < members.length; i += 1) {
      await creditDistribution(members[i]!.walletId, amounts[i]!);
    }

    const token = await tokenFor(members[1]!.userId); // dono do maior valor (120)
    const { status, body } = await getRanking(token, org.id);

    expect(status).toBe(200);
    const rankingBody = body as RankingResponseBody;
    expect(rankingBody.items).toHaveLength(10);
    expect(rankingBody.items.map((i) => i.coinsEarned)).toEqual([120, 110, 100, 90, 80, 70, 60, 50, 40, 30]);
    expect(rankingBody.items.map((i) => i.position)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(rankingBody.items[0]?.name).toBe(members[1]!.name);
    expect(rankingBody.currentUser).toEqual({ position: 1, coinsEarned: 120 });
  });

  it('empate desempata por quem atingiu o total primeiro (createdAt menor)', async () => {
    const org = await createOrg();
    const first = await createMember(org.id);
    const second = await createMember(org.id);

    const now = new Date();
    await creditDistribution(first.walletId, 100, new Date(now.getTime() - 60_000));
    await creditDistribution(second.walletId, 100, now);

    const token = await tokenFor(first.userId);
    const { body } = await getRanking(token, org.id);
    const rankingBody = body as RankingResponseBody;

    expect(rankingBody.items[0]?.name).toBe(first.name);
    expect(rankingBody.items[0]?.position).toBe(1);
    expect(rankingBody.items[1]?.name).toBe(second.name);
    expect(rankingBody.items[1]?.position).toBe(2);
  });

  it('currentUser aparece com posição correta mesmo fora do top 10', async () => {
    const org = await createOrg();
    const members = [];
    for (let i = 0; i < 11; i += 1) {
      members.push(await createMember(org.id));
    }
    // Décimo primeiro membro (índice 10) fica com o menor valor — posição 11, fora do top 10.
    for (let i = 0; i < members.length; i += 1) {
      await creditDistribution(members[i]!.walletId, (11 - i) * 10);
    }

    const lastPlace = members[10]!;
    const token = await tokenFor(lastPlace.userId);
    const { body } = await getRanking(token, org.id);
    const rankingBody = body as RankingResponseBody;

    expect(rankingBody.items).toHaveLength(10);
    expect(rankingBody.items.find((i) => i.name === lastPlace.name)).toBeUndefined();
    expect(rankingBody.currentUser).toEqual({ position: 11, coinsEarned: 10 });
  });

  it('currentUser sem nenhum ganho no período ainda aparece, com coinsEarned 0', async () => {
    const org = await createOrg();
    const earner = await createMember(org.id);
    await creditDistribution(earner.walletId, 500);
    const zeroEarner = await createMember(org.id);

    const token = await tokenFor(zeroEarner.userId);
    const { status, body } = await getRanking(token, org.id);
    const rankingBody = body as RankingResponseBody;

    expect(status).toBe(200);
    expect(rankingBody.currentUser).toEqual({ position: 2, coinsEarned: 0 });
  });

  it('coins recebidos por transferência não contam no ranking', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    await creditDistribution(member.walletId, 300);
    await ledgerService.post({
      walletId: member.walletId,
      type: 'CREDIT',
      amount: 9999,
      referenceType: 'TRANSFER',
      referenceId: randomUUID(),
      description: 'Transferência recebida de um colega',
      idempotencyKey: randomUUID(),
    });

    const token = await tokenFor(member.userId);
    const { body } = await getRanking(token, org.id);
    const rankingBody = body as RankingResponseBody;

    expect(rankingBody.currentUser.coinsEarned).toBe(300);
  });

  it('distribuição revertida no mesmo mês não conta; revertida num mês posterior não retroage', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);

    const twoMonthsAgo = monthsAgo(2);
    const entryId = await creditDistribution(member.walletId, 400, twoMonthsAgo);
    // Reversão acontece HOJE (mês corrente), não no mês da distribuição original.
    await ledgerService.reverse({ entryId, reason: 'Correção de CSV', idempotencyKey: randomUUID() });

    const token = await tokenFor(member.userId);

    // Mês da distribuição original: ainda mostra os 400 (a reversão abate no mês DELA, não
    // retroage pro mês da distribuição).
    const pastPeriodRes = await getRanking(token, org.id, periodOf(twoMonthsAgo));
    expect((pastPeriodRes.body as RankingResponseBody).currentUser.coinsEarned).toBe(400);

    // Mês corrente (onde a reversão de fato aconteceu): reversão conta, mas não há
    // distribuição original aqui — líquido fica negativo/zero-referenciado à reversão.
    const currentPeriodRes = await getRanking(token, org.id);
    expect((currentPeriodRes.body as RankingResponseBody).currentUser.coinsEarned).toBe(-400);
  });

  it('isolamento por organização — membro de outra org com saldo maior não aparece', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const memberA = await createMember(orgA.id);
    const memberB = await createMember(orgB.id);
    await creditDistribution(memberA.walletId, 100);
    await creditDistribution(memberB.walletId, 99999);

    const token = await tokenFor(memberA.userId);
    const { body } = await getRanking(token, orgA.id);
    const rankingBody = body as RankingResponseBody;

    expect(rankingBody.items.find((i) => i.name === memberB.name)).toBeUndefined();
    expect(rankingBody.currentUser).toEqual({ position: 1, coinsEarned: 100 });
  });

  it('membership INACTIVE não aparece no ranking de outro membro', async () => {
    const org = await createOrg();
    const active = await createMember(org.id);
    const inactive = await createMember(org.id, { status: 'INACTIVE' });
    await creditDistribution(active.walletId, 50);
    await creditDistribution(inactive.walletId, 99999);

    const token = await tokenFor(active.userId);
    const { body } = await getRanking(token, org.id);
    const rankingBody = body as RankingResponseBody;

    expect(rankingBody.items.find((i) => i.name === inactive.name)).toBeUndefined();
    expect(rankingBody.currentUser).toEqual({ position: 1, coinsEarned: 50 });
  });

  it('membership INACTIVE do próprio autenticado recebe MEMBERSHIP_NOT_FOUND', async () => {
    const org = await createOrg();
    const inactive = await createMember(org.id, { status: 'INACTIVE' });

    const token = await tokenFor(inactive.userId);
    const { status, body } = await getRanking(token, org.id);

    expect(status).toBe(404);
    expect((body as ErrorResponseBody).code).toBe('MEMBERSHIP_NOT_FOUND');
  });

  it('period de mês anterior funciona e traz dados diferentes do mês corrente', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const lastMonth = monthsAgo(1);
    await creditDistribution(member.walletId, 700, lastMonth);
    await creditDistribution(member.walletId, 200); // mês corrente

    const token = await tokenFor(member.userId);

    const currentRes = await getRanking(token, org.id);
    expect((currentRes.body as RankingResponseBody).currentUser.coinsEarned).toBe(200);

    const pastRes = await getRanking(token, org.id, periodOf(lastMonth));
    expect(pastRes.status).toBe(200);
    expect((pastRes.body as RankingResponseBody).currentUser.coinsEarned).toBe(700);
    expect((pastRes.body as RankingResponseBody).period).toBe(periodOf(lastMonth));
  });

  it('period em formato errado retorna 400', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);

    const res = await request(server)
      .get('/ranking')
      .query({ organizationId: org.id, period: '2026-9' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('period futuro retorna 400 FUTURE_PERIOD_NOT_ALLOWED', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);

    const nextMonth = monthsAgo(-1);
    const { status, body } = await getRanking(token, org.id, periodOf(nextMonth));

    expect(status).toBe(400);
    expect((body as ErrorResponseBody).code).toBe('FUTURE_PERIOD_NOT_ALLOWED');
  });

  it('sem token retorna 401', async () => {
    const org = await createOrg();
    await request(server).get('/ranking').query({ organizationId: org.id }).expect(401);
  });

  it('sem organizationId retorna 400', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);

    await request(server).get('/ranking').set('Authorization', `Bearer ${token}`).expect(400);
  });
});
