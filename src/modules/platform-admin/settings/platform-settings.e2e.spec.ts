import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AdminRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashPassword } from '../../auth/password.util';
import { TokenService } from '../../auth/token.service';
import { PLATFORM_JWT_SERVICE } from '../platform-jwt.token';

interface ConversionRateBody {
  coinsPerReal: number;
  effectiveSince: string;
}

interface CreateBatchResponseBody {
  batch: { id: string; totalCoins: number; remainingCoins: number };
}

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const tokenService = new TokenService(jwtService, prisma);

const FIXTURE_PASSWORD = 'Test@Password123';

const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];
const createdBatchIds: string[] = [];
const createdPlatformAdminIds: string[] = [];

let app: INestApplication;
let server: Server;
let platformJwtService: JwtService;

/** Mesmo gerador de batches.e2e.spec.ts — a cobrança Pix vai pro sandbox real do Asaas, que
 * valida o formato/dígito verificador do CNPJ, então não dá pra usar dígitos aleatórios. */
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

async function createPlatformAdminFixture(): Promise<{ platformAdminId: string; token: string }> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `E2E Platform Settings Admin ${suffix}`,
      email: `e2e-platform-settings-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  const token = platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
  return { platformAdminId: platformAdmin.id, token };
}

interface OwnerFixture {
  adminId: string;
  organizationId: string;
}

async function createOwnerFixture(): Promise<OwnerFixture> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `E2E Platform Settings Batch Org ${suffix}`, cnpj: generateValidCnpj() },
  });
  createdOrgIds.push(organization.id);

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `E2E Owner ${suffix}`,
      email: `e2e-owner-settings-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role: 'OWNER',
    },
  });
  createdAdminIds.push(admin.id);

  return { adminId: admin.id, organizationId: organization.id };
}

function ownerToken(owner: OwnerFixture): Promise<string> {
  return tokenService.issueAccessToken({ id: owner.adminId, organizationId: owner.organizationId, role: AdminRole.OWNER });
}

async function currentRate(): Promise<{ coinsPerRealScaled: number }> {
  return prisma.conversionRate.findFirstOrThrow({ orderBy: { createdAt: 'desc' } });
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
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.auditLog.deleteMany({ where: { actorAdminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
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

describe('GET/PATCH /platform/settings/conversion-rate', () => {
  it('GET devolve a taxa vigente', async () => {
    const { token } = await createPlatformAdminFixture();

    const response = await request(server)
      .get('/platform/settings/conversion-rate')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ConversionRateBody;
    expect(body.coinsPerReal).toBeGreaterThan(0);
    expect(new Date(body.effectiveSince).toString()).not.toBe('Invalid Date');
  });

  it('PATCH muda a taxa, GET subsequente reflete o valor novo, audit log gravado', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();

    const patchResponse = await request(server)
      .patch('/platform/settings/conversion-rate')
      .set('Authorization', `Bearer ${token}`)
      .send({ coinsPerReal: 3.33 })
      .expect(200);
    expect((patchResponse.body as ConversionRateBody).coinsPerReal).toBe(3.33);

    const getResponse = await request(server)
      .get('/platform/settings/conversion-rate')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((getResponse.body as ConversionRateBody).coinsPerReal).toBe(3.33);

    const auditLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'CONVERSION_RATE_UPDATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditLog).not.toBeNull();
    expect((auditLog?.payload as { newCoinsPerReal?: number } | null)?.newCoinsPerReal).toBe(3.33);
  });

  it('mudar a taxa NÃO reprecifica um lote já criado; um lote novo usa a taxa nova', async () => {
    const { token } = await createPlatformAdminFixture();
    const owner = await createOwnerFixture();
    const accessToken = await ownerToken(owner);

    const priceInCents = 200000;

    const rateBeforePatch = await currentRate();
    const firstBatchResponse = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ priceInCents })
      .expect(201);
    const firstBatch = (firstBatchResponse.body as CreateBatchResponseBody).batch;
    createdBatchIds.push(firstBatch.id);
    const expectedFirstTotal = Math.round((priceInCents * rateBeforePatch.coinsPerRealScaled) / 10000);
    expect(firstBatch.totalCoins).toBe(expectedFirstTotal);

    await request(server)
      .patch('/platform/settings/conversion-rate')
      .set('Authorization', `Bearer ${token}`)
      .send({ coinsPerReal: 7.77 })
      .expect(200);

    // lote já criado antes do PATCH continua com o totalCoins de quando foi criado
    const firstBatchAfterPatch = await prisma.coinBatch.findUniqueOrThrow({ where: { id: firstBatch.id } });
    expect(firstBatchAfterPatch.totalCoins).toBe(expectedFirstTotal);

    // lote novo, criado DEPOIS do PATCH, usa a taxa nova
    const secondBatchResponse = await request(server)
      .post('/admin/batches')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ priceInCents })
      .expect(201);
    const secondBatch = (secondBatchResponse.body as CreateBatchResponseBody).batch;
    createdBatchIds.push(secondBatch.id);
    const expectedSecondTotal = Math.round((priceInCents * 777) / 10000);
    expect(secondBatch.totalCoins).toBe(expectedSecondTotal);
    expect(secondBatch.totalCoins).not.toBe(firstBatch.totalCoins);
  }, 30000);
});

describe('Isolamento total — apenas PlatformAdmin acessa /platform/settings', () => {
  it('token de AdminUser recebe 401 em todas as rotas', async () => {
    // Assina o token direto (não passa por POST /auth/login) — mesmo raciocínio do token de
    // Partner logo abaixo: evita consumir o rate limit de login compartilhado entre todos os
    // specs e2e que rodam serial no mesmo processo Jest (foi exatamente isso que derrubou
    // auth.e2e.spec.ts com 429 na rodada anterior).
    const accessToken = jwtService.sign({ sub: randomUUID(), organizationId: randomUUID(), role: 'OPERATOR', type: 'admin' });

    await request(server)
      .get('/platform/settings/conversion-rate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await request(server)
      .patch('/platform/settings/conversion-rate')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ coinsPerReal: 1 })
      .expect(401);
  });

  it('token de Partner recebe 401 em todas as rotas', async () => {
    const partnerToken = jwtService.sign({ sub: randomUUID(), type: 'partner' });

    await request(server)
      .get('/platform/settings/conversion-rate')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(401);
    await request(server)
      .patch('/platform/settings/conversion-rate')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ coinsPerReal: 1 })
      .expect(401);
  });
});
