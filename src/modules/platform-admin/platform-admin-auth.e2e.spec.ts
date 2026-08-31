import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { generate } from 'otplib';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';

interface LoginResponseBody {
  status: string;
  mfaChallengeToken?: string;
}

interface TokenPairBody {
  accessToken: string;
  refreshToken: string;
}

const prisma = new PrismaService();
const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];
const createdPlatformAdminIds: string[] = [];

let app: INestApplication;
let server: Server;

const FIXTURE_PASSWORD = 'Test@Password123';

async function createPlatformAdminFixture(): Promise<{ email: string; password: string }> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `E2E Platform Admin ${suffix}`,
      email: `e2e-platform-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  return { email: platformAdmin.email, password: FIXTURE_PASSWORD };
}

async function createAdminUserFixture(): Promise<{ email: string; password: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `E2E Platform Isolation Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `E2E AdminUser ${suffix}`,
      email: `e2e-adminuser-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role: 'OPERATOR',
    },
  });
  createdOrgIds.push(organization.id);
  createdAdminIds.push(admin.id);
  return { email: admin.email, password: FIXTURE_PASSWORD };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.platformAdminRefreshToken.deleteMany({
    where: { platformAdminId: { in: createdPlatformAdminIds } },
  });
  await prisma.platformAdminAuditLog.deleteMany({
    where: { platformAdminId: { in: createdPlatformAdminIds } },
  });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdPlatformAdminIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.auditLog.deleteMany({ where: { actorAdminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

async function completePlatformAdminLogin(email: string, password: string): Promise<TokenPairBody> {
  const loginResponse = await request(server).post('/platform/auth/login').send({ email, password }).expect(200);
  const loginBody = loginResponse.body as LoginResponseBody;
  expect(loginBody.status).toBe('MFA_SETUP_REQUIRED');

  const setupResponse = await request(server)
    .post('/platform/auth/mfa/setup')
    .set('Authorization', `Bearer ${loginBody.mfaChallengeToken}`)
    .expect(200);
  const secret = (setupResponse.body as { secret: string }).secret;
  const code = await generate({ secret });

  const enableResponse = await request(server)
    .post('/platform/auth/mfa/enable')
    .set('Authorization', `Bearer ${loginBody.mfaChallengeToken}`)
    .send({ code })
    .expect(200);

  return enableResponse.body as TokenPairBody;
}

describe('Fluxo completo de login + MFA — POST /platform/auth/*', () => {
  it('primeiro login força MFA_SETUP_REQUIRED, mfa/setup + mfa/enable devolvem tokens, e /me funciona', async () => {
    const { email, password } = await createPlatformAdminFixture();
    const tokens = await completePlatformAdminLogin(email, password);

    expect(tokens.accessToken).toEqual(expect.any(String));

    const meResponse = await request(server)
      .get('/platform/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(200);
    expect((meResponse.body as { email: string }).email).toBe(email);

    const refreshResponse = await request(server)
      .post('/platform/auth/refresh')
      .send({ refreshToken: tokens.refreshToken })
      .expect(200);
    const rotated = refreshResponse.body as TokenPairBody;
    expect(rotated.refreshToken).not.toBe(tokens.refreshToken);

    await request(server).post('/platform/auth/logout').send({ refreshToken: rotated.refreshToken }).expect(204);
    await request(server).post('/platform/auth/refresh').send({ refreshToken: rotated.refreshToken }).expect(401);
  });
});

describe('Isolamento total entre PlatformAdmin e AdminUser', () => {
  it('token de AdminUser recebe 401 em GET /platform/auth/me', async () => {
    const { email, password } = await createAdminUserFixture();
    const loginResponse = await request(server).post('/auth/login').send({ email, password }).expect(200);
    const accessToken = (loginResponse.body as { accessToken: string }).accessToken;

    await request(server)
      .get('/platform/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
  });

  it('token de PlatformAdmin recebe 401 em GET /auth/me', async () => {
    const { email, password } = await createPlatformAdminFixture();
    const tokens = await completePlatformAdminLogin(email, password);

    await request(server)
      .get('/auth/me')
      .set('Authorization', `Bearer ${tokens.accessToken}`)
      .expect(401);
  });
});
