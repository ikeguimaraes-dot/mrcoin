import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashPassword } from '../../auth/password.util';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../../settings/settings.constants';
import { PLATFORM_JWT_SERVICE } from '../platform-jwt.token';

interface BatchItemBody {
  id: string;
  organizationId: string;
  organizationName: string;
  totalCoins: number;
  priceInCents: number;
  status: string;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ListResponseBody {
  items: BatchItemBody[];
  nextCursor: string | null;
}

interface ErrorBody {
  code: string;
}

const FIXTURE_PASSWORD = 'Test@Password123';

const prisma = new PrismaService();

const createdOrgIds: string[] = [];
const createdBatchIds: string[] = [];
const createdPlatformAdminIds: string[] = [];

let app: INestApplication;
let server: Server;
let platformJwtService: JwtService;

async function createPlatformAdminFixture(): Promise<{ platformAdminId: string; token: string }> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `Platform Batches Admin ${suffix}`,
      email: `platform-batches-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  const token = platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
  return { platformAdminId: platformAdmin.id, token };
}

function generateValidCnpj(): string {
  const base = Array.from({ length: 12 }, () => Math.floor(Math.random() * 10));
  const calcDigit = (nums: number[]): number => {
    const weights = nums.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = nums.reduce((acc, n, i) => acc + n * (weights[i] ?? 0), 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };
  const firstDigit = calcDigit(base);
  const secondDigit = calcDigit([...base, firstDigit]);
  return [...base, firstDigit, secondDigit].join('');
}

async function createOrg(): Promise<{ id: string; name: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Platform Batches Org ${suffix}`, cnpj: generateValidCnpj() },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

async function createPendingBatch(organizationId: string, overrides: { totalCoins?: number; priceInCents?: number } = {}) {
  const batch = await prisma.coinBatch.create({
    data: {
      organizationId,
      totalCoins: overrides.totalCoins ?? 1000,
      remainingCoins: overrides.totalCoins ?? 1000,
      priceInCents: overrides.priceInCents ?? 80000,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  createdBatchIds.push(batch.id);
  return batch;
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
  await prisma.coinBatch.deleteMany({ where: { id: { in: createdBatchIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.platformAdminAuditLog.deleteMany({ where: { platformAdminId: { in: createdPlatformAdminIds } } });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdPlatformAdminIds } } });
  await prisma.$disconnect();
});

describe('GET /platform/batches', () => {
  it('lista lotes com filtro por status e nome da organização', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const pending = await createPendingBatch(org.id, { totalCoins: 500, priceInCents: 40000 });

    const res = await request(server)
      .get('/platform/batches')
      .query({ status: 'PENDING' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as ListResponseBody;
    const found = body.items.find((item) => item.id === pending.id);
    expect(found).toBeDefined();
    expect(found?.organizationName).toBe(org.name);
    expect(found?.totalCoins).toBe(500);
    expect(found?.priceInCents).toBe(40000);
    expect(found?.status).toBe('PENDING');
  });

  it('sem token retorna 401', async () => {
    await request(server).get('/platform/batches').expect(401);
  });
});

describe('POST /platform/batches/:id/approve', () => {
  it('aprova (marca pago), audita quem aprovou, idempotente, não move nenhuma coin em ledger', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const batch = await createPendingBatch(org.id);

    const firstRes = await request(server)
      .post(`/platform/batches/${batch.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const first = firstRes.body as BatchItemBody;
    expect(first.status).toBe('PAID');

    const stored = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(stored.approvedByPlatformAdminId).toBe(platformAdminId);

    const auditLogs = await prisma.platformAdminAuditLog.findMany({
      where: { platformAdminId, action: 'BATCH_APPROVED' },
    });
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0]?.payload).toMatchObject({ batchId: batch.id, organizationId: org.id });

    // Aprovar não move NENHUMA coin em ledger — nenhum LedgerEntry referencia este lote.
    const entryCount = await prisma.ledgerEntry.count({ where: { batchId: batch.id } });
    expect(entryCount).toBe(0);

    // Idempotente: aprovar de novo devolve o mesmo estado, sem novo audit log.
    const secondRes = await request(server)
      .post(`/platform/batches/${batch.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect((secondRes.body as BatchItemBody).status).toBe('PAID');

    const auditLogsAfterReplay = await prisma.platformAdminAuditLog.findMany({
      where: { platformAdminId, action: 'BATCH_APPROVED' },
    });
    expect(auditLogsAfterReplay).toHaveLength(1);
  });

  it('aprovar um lote já REJECTED retorna 409 BATCH_DECISION_CONFLICT', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const batch = await createPendingBatch(org.id);

    await request(server).post(`/platform/batches/${batch.id}/reject`).set('Authorization', `Bearer ${token}`).send({}).expect(201);

    const res = await request(server)
      .post(`/platform/batches/${batch.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
    expect((res.body as ErrorBody).code).toBe('BATCH_DECISION_CONFLICT');
  });

  it('lote inexistente retorna 404', async () => {
    const { token } = await createPlatformAdminFixture();

    const res = await request(server)
      .post(`/platform/batches/${randomUUID()}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    expect((res.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('token de AdminUser e de Partner recebem 401', async () => {
    const org = await createOrg();
    const batch = await createPendingBatch(org.id);
    const jwtService = app.get(JwtService);
    const adminToken = jwtService.sign({ sub: randomUUID(), organizationId: randomUUID(), role: 'OPERATOR', type: 'admin' });
    const partnerToken = jwtService.sign({ sub: randomUUID(), type: 'partner' });

    for (const badToken of [adminToken, partnerToken]) {
      await request(server)
        .post(`/platform/batches/${batch.id}/approve`)
        .set('Authorization', `Bearer ${badToken}`)
        .expect(401);
    }
  });
});

describe('POST /platform/batches/:id/reject', () => {
  it('recusa com motivo, audita quem recusou, idempotente', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const batch = await createPendingBatch(org.id);

    const firstRes = await request(server)
      .post(`/platform/batches/${batch.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Valor pago divergente do esperado' })
      .expect(201);
    const first = firstRes.body as BatchItemBody;
    expect(first.status).toBe('REJECTED');
    expect(first.rejectionReason).toBe('Valor pago divergente do esperado');

    const stored = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(stored.rejectedByPlatformAdminId).toBe(platformAdminId);

    const auditLogs = await prisma.platformAdminAuditLog.findMany({
      where: { platformAdminId, action: 'BATCH_REJECTED' },
    });
    expect(auditLogs).toHaveLength(1);

    // Idempotente.
    const secondRes = await request(server)
      .post(`/platform/batches/${batch.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'Motivo diferente, ignorado no replay' })
      .expect(201);
    expect((secondRes.body as BatchItemBody).status).toBe('REJECTED');
    expect((secondRes.body as BatchItemBody).rejectionReason).toBe('Valor pago divergente do esperado');

    const auditLogsAfterReplay = await prisma.platformAdminAuditLog.findMany({
      where: { platformAdminId, action: 'BATCH_REJECTED' },
    });
    expect(auditLogsAfterReplay).toHaveLength(1);
  });

  it('recusa sem motivo — rejectionReason fica null', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const batch = await createPendingBatch(org.id);

    const res = await request(server)
      .post(`/platform/batches/${batch.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);
    expect((res.body as BatchItemBody).rejectionReason).toBeNull();
  });

  it('recusar um lote já PAID retorna 409 BATCH_DECISION_CONFLICT', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const batch = await createPendingBatch(org.id);

    await request(server).post(`/platform/batches/${batch.id}/approve`).set('Authorization', `Bearer ${token}`).expect(201);

    const res = await request(server)
      .post(`/platform/batches/${batch.id}/reject`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(409);
    expect((res.body as ErrorBody).code).toBe('BATCH_DECISION_CONFLICT');
  });

  it('sem token retorna 401', async () => {
    await request(server).post(`/platform/batches/${randomUUID()}/reject`).send({}).expect(401);
  });
});
