import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

const WEBHOOK_SECRET = process.env.ASAAS_WEBHOOK_SECRET as string;

const prisma = new PrismaService();

const createdOrgIds: string[] = [];
const createdBatchIds: string[] = [];

let app: INestApplication;
let server: Server;

async function createPendingBatchFixture() {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Webhooks Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);

  const batch = await prisma.coinBatch.create({
    data: {
      organizationId: organization.id,
      totalCoins: 1000,
      remainingCoins: 1000,
      priceInCents: 10000,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      pspChargeId: `pay_fixture_${suffix}`,
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
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.coinBatch.deleteMany({ where: { id: { in: createdBatchIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('POST /webhooks/psp/payment', () => {
  it('assinatura inválida é rejeitada com 401 e o lote não é alterado', async () => {
    const batch = await createPendingBatchFixture();

    await request(server)
      .post('/webhooks/psp/payment')
      .set('asaas-access-token', 'token-invalido')
      .send({ event: 'PAYMENT_RECEIVED', payment: { id: batch.pspChargeId, status: 'RECEIVED' } })
      .expect(401);

    const untouched = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(untouched.status).toBe('PENDING');
  });

  it('sem o header asaas-access-token é rejeitado com 401', async () => {
    const batch = await createPendingBatchFixture();

    await request(server)
      .post('/webhooks/psp/payment')
      .send({ event: 'PAYMENT_RECEIVED', payment: { id: batch.pspChargeId, status: 'RECEIVED' } })
      .expect(401);
  });

  it('pspChargeId desconhecido retorna 200 sem efeito (no-op)', async () => {
    await request(server)
      .post('/webhooks/psp/payment')
      .set('asaas-access-token', WEBHOOK_SECRET)
      .send({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_desconhecido_xyz', status: 'RECEIVED' } })
      .expect(200);
  });

  it('evento diferente de PAYMENT_RECEIVED não altera o lote', async () => {
    const batch = await createPendingBatchFixture();

    await request(server)
      .post('/webhooks/psp/payment')
      .set('asaas-access-token', WEBHOOK_SECRET)
      .send({ event: 'PAYMENT_OVERDUE', payment: { id: batch.pspChargeId, status: 'OVERDUE' } })
      .expect(200);

    const untouched = await prisma.coinBatch.findUniqueOrThrow({ where: { id: batch.id } });
    expect(untouched.status).toBe('PENDING');
  });
});
