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
import { PLATFORM_JWT_SERVICE } from '../platform-admin/platform-jwt.token';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';

interface ManualPixInfo {
  method: 'MANUAL';
  pixKey: string;
  amountInCents: number;
}

interface CreateBatchResponseBody {
  batch: CoinBatch;
  pix: ManualPixInfo | null;
}

interface ListBatchesResponseBody {
  items: CoinBatch[];
  nextCursor: string | null;
}

/**
 * Cobre o fluxo PADRÃO (ASAAS_ENABLED=false, definido em .env) — compra de lote virou
 * aprovação manual pela plataforma, não chama o Asaas. O caminho legado com
 * ASAAS_ENABLED=true tem regressão coberta à parte em batches.service.spec.ts (instancia o
 * service direto com a flag ligada — evita a fragilidade de sobrescrever ConfigService
 * global numa suíte HTTP inteira só pra um cenário).
 */
const FIXTURE_PASSWORD = 'Test@Password123';
const MRCOIN_PIX_KEY = process.env.MRCOIN_PIX_KEY as string;

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const tokenService = new TokenService(jwtService, prisma);

const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];
const createdBatchIds: string[] = [];
const createdPlatformAdminIds: string[] = [];

let app: INestApplication;
let server: Server;
let platformJwtService: JwtService;

async function createPlatformAdminFixture(): Promise<string> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `Batches Test Platform Admin ${suffix}`,
      email: `batches-test-platform-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  return platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
}

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
  // Toda organização precisa de uma taxa própria pra POST /admin/batches funcionar —
  // criada aqui direto (bypassa createOrganizationWithOwnerInvite, que faz isso sozinho em
  // produção) porque este fixture só quer um org+admin, não o fluxo de convite completo.
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });

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

async function expectedPriceFor(organizationId: string, totalCoins: number): Promise<number> {
  const rate = await prisma.conversionRate.findFirstOrThrow({
    where: { organizationId },
    orderBy: { createdAt: 'desc' },
  });
  return Math.round((totalCoins * 10000) / rate.coinsPerRealScaled);
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
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.coinBatch.deleteMany({ where: { id: { in: createdBatchIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.platformAdminAuditLog.deleteMany({
    where: { platformAdminId: { in: createdPlatformAdminIds } },
  });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdPlatformAdminIds } } });
  await prisma.$disconnect();
});

describe('POST /admin/batches — fluxo de aprovação manual (padrão, ASAAS_ENABLED=false)', () => {
  it('OWNER cria lote pendente com a chave Pix da mrcoin — não chama o PSP, sem pspChargeId', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const idempotencyKey = `test-${randomUUID()}`;

    const createResponse = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ totalCoins: 2000, validityMonths: 12 })
      .expect(201);

    const created = createResponse.body as CreateBatchResponseBody;
    createdBatchIds.push(created.batch.id);

    const expectedPriceInCents = await expectedPriceFor(owner.organizationId, 2000);
    expect(created.batch.status).toBe('PENDING');
    expect(created.batch.organizationId).toBe(owner.organizationId);
    expect(created.batch.totalCoins).toBe(2000);
    expect(created.batch.remainingCoins).toBe(2000);
    expect(created.batch.priceInCents).toBe(expectedPriceInCents);
    expect(created.pix).toEqual({ method: 'MANUAL', pixKey: MRCOIN_PIX_KEY, amountInCents: expectedPriceInCents });

    // SEGURANÇA: pspChargeId e idempotencyKey são referência interna / chave de replay —
    // nunca saem na resposta HTTP.
    expect(created.batch).not.toHaveProperty('pspChargeId');
    expect(created.batch).not.toHaveProperty('idempotencyKey');

    const createdInDb = await prisma.coinBatch.findUniqueOrThrow({ where: { id: created.batch.id } });
    expect(createdInDb.pspChargeId).toBeNull();

    // Replay idempotente — mesma chave e mesmo body não cria um segundo lote.
    const replayResponse = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ totalCoins: 2000, validityMonths: 12 })
      .expect(201);

    const replayed = replayResponse.body as CreateBatchResponseBody;
    expect(replayed.batch.id).toBe(created.batch.id);
    expect(replayed.pix).toEqual({ method: 'MANUAL', pixKey: MRCOIN_PIX_KEY, amountInCents: expectedPriceInCents });

    const listResponse = await request(server)
      .get('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const list = listResponse.body as ListBatchesResponseBody;
    const listed = list.items.find((item) => item.id === created.batch.id);
    expect(listed?.status).toBe('PENDING');
    expect(listed?.remainingCoins).toBe(2000);
  }, 30000);

  it('GET /admin/batches expõe rejectionReason depois de uma recusa da plataforma', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const platformAdminToken = await createPlatformAdminFixture();

    const created = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ totalCoins: 500 })
      .expect(201);
    const batchId = (created.body as CreateBatchResponseBody).batch.id;
    createdBatchIds.push(batchId);

    await request(server)
      .post(`/platform/batches/${batchId}/reject`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ reason: 'Comprovante de pagamento não localizado' })
      .expect(201);

    const listResponse = await request(server)
      .get('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    const list = listResponse.body as ListBatchesResponseBody;
    const listed = list.items.find((item) => item.id === batchId);
    expect(listed?.status).toBe('REJECTED');
    expect(listed?.rejectionReason).toBe('Comprovante de pagamento não localizado');
  });

  it('Idempotency-Key repetida com body diferente retorna 409 IDEMPOTENCY_CONFLICT', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const idempotencyKey = `test-${randomUUID()}`;

    const first = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ totalCoins: 500 })
      .expect(201);

    createdBatchIds.push((first.body as CreateBatchResponseBody).batch.id);

    const conflict = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ totalCoins: 999 })
      .expect(409);

    expect((conflict.body as { code: string }).code).toBe('IDEMPOTENCY_CONFLICT');
  }, 30000);

  it('sem o header Idempotency-Key retorna 400', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    const response = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ totalCoins: 100 })
      .expect(400);

    expect((response.body as { code: string }).code).toBe('VALIDATION_ERROR');
  });

  it('totalCoins que resulta em preço abaixo do piso mínimo (R$5,00) retorna 400', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    // taxa padrão (1,25 coins/real) — totalCoins=1 vira priceInCents=80, bem abaixo do
    // piso de 500 (R$5,00)
    const response = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ totalCoins: 1 })
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
      .send({ totalCoins: 100 })
      .expect(403);
  });
});

describe('Taxa de conversão é por organização', () => {
  it('duas organizações com taxas diferentes geram priceInCents diferentes pro mesmo totalCoins', async () => {
    const platformAdminToken = await createPlatformAdminFixture();
    const ownerA = await createAdmin('OWNER');
    const ownerB = await createAdmin('OWNER');
    const ownerTokenA = await tokenFor(ownerA);
    const ownerTokenB = await tokenFor(ownerB);

    await request(server)
      .patch(`/platform/organizations/${ownerB.organizationId}/conversion-rate`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ coinsPerReal: 2.5 })
      .expect(200);

    const responseA = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ totalCoins: 1000 })
      .expect(201);
    const batchA = (responseA.body as CreateBatchResponseBody).batch;
    createdBatchIds.push(batchA.id);

    const responseB = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerTokenB}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ totalCoins: 1000 })
      .expect(201);
    const batchB = (responseB.body as CreateBatchResponseBody).batch;
    createdBatchIds.push(batchB.id);

    expect(batchA.priceInCents).toBe(await expectedPriceFor(ownerA.organizationId, 1000));
    expect(batchB.priceInCents).toBe(await expectedPriceFor(ownerB.organizationId, 1000));
    expect(batchA.priceInCents).not.toBe(batchB.priceInCents);
  }, 30000);

  it('mudar a taxa da organização não reprecifica lote já existente; lote novo usa a taxa nova', async () => {
    const platformAdminToken = await createPlatformAdminFixture();
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    const firstResponse = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ totalCoins: 1000 })
      .expect(201);
    const firstBatch = (firstResponse.body as CreateBatchResponseBody).batch;
    createdBatchIds.push(firstBatch.id);
    const priceBeforePatch = firstBatch.priceInCents;

    await request(server)
      .patch(`/platform/organizations/${owner.organizationId}/conversion-rate`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ coinsPerReal: 5 })
      .expect(200);

    // lote já criado antes do PATCH continua com o priceInCents/totalCoins de quando foi criado
    const firstBatchAfterPatch = await prisma.coinBatch.findUniqueOrThrow({ where: { id: firstBatch.id } });
    expect(firstBatchAfterPatch.priceInCents).toBe(priceBeforePatch);
    expect(firstBatchAfterPatch.totalCoins).toBe(1000);

    // lote novo, criado DEPOIS do PATCH, usa a taxa nova
    const secondResponse = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${ownerToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ totalCoins: 1000 })
      .expect(201);
    const secondBatch = (secondResponse.body as CreateBatchResponseBody).batch;
    createdBatchIds.push(secondBatch.id);

    expect(secondBatch.priceInCents).toBe(await expectedPriceFor(owner.organizationId, 1000));
    expect(secondBatch.priceInCents).not.toBe(priceBeforePatch);
  }, 30000);
});
