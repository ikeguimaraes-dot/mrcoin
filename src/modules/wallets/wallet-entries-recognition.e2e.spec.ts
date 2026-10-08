import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../auth/password.util';
import { LedgerService } from '../ledger/ledger.service';
import { createDefaultOrganizationValues } from '../organization-values/default-organization-values';

interface RecognitionBody {
  message: string | null;
  recognizedByName: string;
  value: { id: string; name: string } | null;
}

interface EntryBody {
  id: string;
  referenceType: string;
  recognition: RecognitionBody | null;
}

interface EntriesResponseBody {
  items: EntryBody[];
}

/** PrismaService que emite evento por query — só pra contar quantas queries um request faz
 * (prova de ausência de N+1 no extrato). */
class QueryCountingPrismaService extends PrismaService {
  queryCount = 0;

  constructor() {
    super({ log: [{ emit: 'event', level: 'query' }] });
    (this as unknown as PrismaClient<Prisma.PrismaClientOptions, 'query'>).$on('query', () => {
      this.queryCount += 1;
    });
  }
}

const prisma = new PrismaService();
const countingPrisma = new QueryCountingPrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const ledgerService = new LedgerService(prisma);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const createdAdminIds: string[] = [];

let app: INestApplication;
let server: Server;

interface Fixture {
  organizationId: string;
  userId: string;
  membershipId: string;
  walletId: string;
}

async function createFixture(): Promise<Fixture> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: {
      name: `Recognition Entries Org ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
    },
  });
  createdOrgIds.push(organization.id);
  await createDefaultOrganizationValues(prisma, organization.id);

  const cpf = randomInt(10_000_000_000, 100_000_000_000).toString();
  const user = await prisma.user.create({
    data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name: `Recognized ${suffix}` },
  });
  createdUserIds.push(user.id);
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, type: 'EMPLOYEE' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id } });

  return {
    organizationId: organization.id,
    userId: user.id,
    membershipId: membership.id,
    walletId: wallet.id,
  };
}

async function createAdmin(organizationId: string, name: string): Promise<string> {
  const admin = await prisma.adminUser.create({
    data: {
      organizationId,
      name,
      email: `recognition-entries-${randomUUID()}@test.coins-api.dev`,
      passwordHash: await hashPassword('Test@Password123'),
      role: 'MANAGER',
    },
  });
  createdAdminIds.push(admin.id);
  return admin.id;
}

interface DistributionCreditInput {
  adminUserId: string;
  message?: string;
  organizationValueId?: string;
}

/** Simula o que DistributionsService grava: Distribution + DistributionItem + CREDIT ligado ao item. */
async function creditDistribution(fixture: Fixture, input: DistributionCreditInput): Promise<void> {
  const distribution = await prisma.distribution.create({
    data: {
      organizationId: fixture.organizationId,
      adminUserId: input.adminUserId,
      message: input.message,
      organizationValueId: input.organizationValueId,
      status: 'COMPLETED',
      totalItems: 1,
      successItems: 1,
    },
  });
  const item = await prisma.distributionItem.create({
    data: {
      distributionId: distribution.id,
      membershipId: fixture.membershipId,
      amount: 10,
      status: 'OK',
    },
  });
  await ledgerService.post({
    walletId: fixture.walletId,
    type: 'CREDIT',
    amount: 10,
    referenceType: 'DISTRIBUTION',
    referenceId: item.id,
    distributionItemId: item.id,
    description: 'Reconhecimento',
    idempotencyKey: randomUUID(),
  });
}

async function valueIds(organizationId: string): Promise<{ id: string; name: string }[]> {
  return prisma.organizationValue.findMany({
    where: { organizationId },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true },
  });
}

async function fetchEntries(
  fixture: Fixture,
): Promise<{ body: EntriesResponseBody; queries: number }> {
  const token = await jwtService.signAsync({ sub: fixture.userId, type: 'user' });
  countingPrisma.queryCount = 0;
  const response = await request(server)
    .get('/wallet/entries')
    .query({ organizationId: fixture.organizationId, limit: 50 })
    .set('Authorization', `Bearer ${token}`)
    .expect(200);
  return { body: response.body as EntriesResponseBody, queries: countingPrisma.queryCount };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue(countingPrisma)
    .compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  const memberships = await prisma.membership.findMany({
    where: { userId: { in: createdUserIds } },
  });
  const walletIds = (
    await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } })
  ).map((w) => w.id);
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.distributionItem.deleteMany({
    where: { distribution: { organizationId: { in: createdOrgIds } } },
  });
  await prisma.distribution.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organizationValue.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
  await countingPrisma.$disconnect();
});

describe('GET /wallet/entries — dados de reconhecimento', () => {
  it('entrada de distribuição traz quem reconheceu, a mensagem e o valor; demais entradas trazem null', async () => {
    const fixture = await createFixture();
    const adminId = await createAdmin(fixture.organizationId, 'Ana Gestora');
    const [foco] = await valueIds(fixture.organizationId);
    await creditDistribution(fixture, {
      adminUserId: adminId,
      message: 'Mandou muito bem',
      organizationValueId: foco?.id,
    });
    await creditDistribution(fixture, { adminUserId: adminId });
    await ledgerService.post({
      walletId: fixture.walletId,
      type: 'CREDIT',
      amount: 5,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Ajuste',
      idempotencyKey: randomUUID(),
    });

    const { body } = await fetchEntries(fixture);

    const [manual, legacyDistribution, recognition] = body.items;
    expect(recognition?.recognition).toEqual({
      message: 'Mandou muito bem',
      recognizedByName: 'Ana Gestora',
      value: { id: foco?.id, name: 'Foco' },
    });
    // distribuição antiga (sem message nem valor) não é reconhecimento — fica null, sem backfill
    expect(legacyDistribution?.referenceType).toBe('DISTRIBUTION');
    expect(legacyDistribution?.recognition).toBeNull();
    expect(manual?.recognition).toBeNull();
  });

  it('sem N+1: 10 reconhecimentos de admins e valores diferentes custam as mesmas queries que 1', async () => {
    const single = await createFixture();
    const singleAdmin = await createAdmin(single.organizationId, 'Admin Único');
    const [singleValue] = await valueIds(single.organizationId);
    await creditDistribution(single, {
      adminUserId: singleAdmin,
      message: 'Um',
      organizationValueId: singleValue?.id,
    });

    const many = await createFixture();
    const manyValues = await valueIds(many.organizationId);
    for (let i = 0; i < 10; i += 1) {
      const adminId = await createAdmin(many.organizationId, `Admin ${i}`);
      await creditDistribution(many, {
        adminUserId: adminId,
        message: `Reconhecimento ${i}`,
        organizationValueId: manyValues[i % manyValues.length]?.id,
      });
    }

    const singleResult = await fetchEntries(single);
    const manyResult = await fetchEntries(many);

    expect(singleResult.body.items).toHaveLength(1);
    expect(manyResult.body.items).toHaveLength(10);
    expect(manyResult.body.items.every((entry) => entry.recognition !== null)).toBe(true);
    expect(manyResult.queries).toBe(singleResult.queries);
  });
});
