import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AdminRole, CoinBatch } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { TokenService } from '../auth/token.service';

interface PixInfo {
  qrCodeImage: string;
  copyPasteCode: string;
  expirationDate: string;
}

interface CreateBatchResponseBody {
  batch: CoinBatch;
  pix: PixInfo | null;
}

interface ListBatchesResponseBody {
  items: CoinBatch[];
  nextCursor: string | null;
}

/** Bate no sandbox real do Asaas via BillingService (sem mock) — mesma filosofia de
 * teste do resto do repo. Exige ASAAS_API_KEY sandbox válida no `.env`. */
const FIXTURE_PASSWORD = 'Test@Password123';
const WEBHOOK_SECRET = process.env.ASAAS_WEBHOOK_SECRET as string;

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const tokenService = new TokenService(jwtService, prisma);

const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];
const createdBatchIds: string[] = [];

let app: INestApplication;
let server: Server;

interface AdminFixture {
  adminId: string;
  organizationId: string;
  role: AdminRole;
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

async function createAdmin(role: AdminRole): Promise<AdminFixture> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Batches Test Org ${suffix}`, cnpj: generateValidCnpj() },
  });
  createdOrgIds.push(organization.id);

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `Batches Test Admin ${role} ${suffix}`,
      email: `batches-test-${role.toLowerCase()}-${suffix}@test.coins-api.dev`,
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

function webhookPayload(pspChargeId: string, event = 'PAYMENT_RECEIVED') {
  return { event, payment: { id: pspChargeId, status: 'RECEIVED' } };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.coinBatch.deleteMany({ where: { id: { in: createdBatchIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('POST /admin/batches — fluxo completo com PSP em sandbox', () => {
  it('OWNER cria lote pendente com cobrança Pix real e confirma via webhook, sem duplicar em reenvio', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const idempotencyKey = `test-${randomUUID()}`;

    const createResponse = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ totalCoins: 10000, priceInCents: 150000, validityMonths: 12 })
      .expect(201);

    const created = createResponse.body as CreateBatchResponseBody;
    createdBatchIds.push(created.batch.id);

    expect(created.batch.status).toBe('PENDING');
    expect(created.batch.organizationId).toBe(owner.organizationId);
    expect(created.batch.totalCoins).toBe(10000);
    expect(created.batch.remainingCoins).toBe(10000);
    expect(created.batch.pspChargeId).toBeTruthy();
    expect(created.pix?.qrCodeImage.length).toBeGreaterThan(0);
    expect(created.pix?.copyPasteCode.length).toBeGreaterThan(0);

    const pspChargeId = created.batch.pspChargeId as string;

    // Replay idempotente — mesma chave e mesmo body não cria um segundo lote nem uma
    // segunda cobrança no PSP.
    const replayResponse = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ totalCoins: 10000, priceInCents: 150000, validityMonths: 12 })
      .expect(201);

    const replayed = replayResponse.body as CreateBatchResponseBody;
    expect(replayed.batch.id).toBe(created.batch.id);
    expect(replayed.batch.pspChargeId).toBe(pspChargeId);
    expect(replayed.pix?.qrCodeImage.length).toBeGreaterThan(0);

    // Webhook confirma o pagamento — lote vira PAID e um AuditLog de sistema é gravado.
    await request(server)
      .post('/webhooks/psp/payment')
      .set('asaas-access-token', WEBHOOK_SECRET)
      .send(webhookPayload(pspChargeId))
      .expect(200);

    const paidBatch = await prisma.coinBatch.findUniqueOrThrow({ where: { id: created.batch.id } });
    expect(paidBatch.status).toBe('PAID');

    const auditEntries = await prisma.auditLog.findMany({
      where: { organizationId: owner.organizationId, action: 'BATCH_PAYMENT_CONFIRMED' },
    });
    expect(auditEntries).toHaveLength(1);
    const [confirmedEntry] = auditEntries;
    expect(confirmedEntry?.actorType).toBe('SYSTEM');
    expect(confirmedEntry?.actorAdminUserId).toBeNull();

    // Webhook duplicado — mesma notificação de novo não deve duplicar nada.
    await request(server)
      .post('/webhooks/psp/payment')
      .set('asaas-access-token', WEBHOOK_SECRET)
      .send(webhookPayload(pspChargeId))
      .expect(200);

    const stillPaidBatch = await prisma.coinBatch.findUniqueOrThrow({ where: { id: created.batch.id } });
    expect(stillPaidBatch.status).toBe('PAID');

    const auditEntriesAfterReplay = await prisma.auditLog.findMany({
      where: { organizationId: owner.organizationId, action: 'BATCH_PAYMENT_CONFIRMED' },
    });
    expect(auditEntriesAfterReplay).toHaveLength(1);

    const listResponse = await request(server)
      .get('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const list = listResponse.body as ListBatchesResponseBody;
    const listed = list.items.find((item) => item.id === created.batch.id);
    expect(listed?.status).toBe('PAID');
    expect(listed?.remainingCoins).toBe(10000);
  }, 30000);

  it('Idempotency-Key repetida com body diferente retorna 409 IDEMPOTENCY_CONFLICT', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const idempotencyKey = `test-${randomUUID()}`;

    const first = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ totalCoins: 5000, priceInCents: 50000 })
      .expect(201);

    createdBatchIds.push((first.body as CreateBatchResponseBody).batch.id);

    const conflict = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ totalCoins: 9999, priceInCents: 50000 })
      .expect(409);

    expect((conflict.body as { code: string }).code).toBe('IDEMPOTENCY_CONFLICT');
  }, 30000);

  it('sem o header Idempotency-Key retorna 400', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    const response = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ totalCoins: 100, priceInCents: 5000 })
      .expect(400);

    expect((response.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('MANAGER não pode criar lote (rota exige OWNER)', async () => {
    const manager = await createAdmin('MANAGER');
    const managerToken = await tokenFor(manager);

    await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${managerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ totalCoins: 100, priceInCents: 5000 })
      .expect(403);
  });
});
