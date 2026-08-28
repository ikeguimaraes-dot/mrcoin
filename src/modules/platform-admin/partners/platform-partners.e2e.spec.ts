import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashPassword } from '../../auth/password.util';
import { PLATFORM_JWT_SERVICE } from '../platform-jwt.token';

interface CreatePartnerResponseBody {
  id: string;
  cnpj: string;
  status: string;
  credential: { password: string };
}

interface PartnerTokenPairBody {
  accessToken: string;
  refreshToken: string;
}

interface PartnerSummaryBody {
  id: string;
  offerCount: number;
  confirmedRedemptionCount: number;
}

const prisma = new PrismaService();
const createdPartnerIds: string[] = [];
const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];
const createdPlatformAdminIds: string[] = [];

let app: INestApplication;
let server: Server;
let platformJwtService: JwtService;

const FIXTURE_PASSWORD = 'Test@Password123';

function fixtureCnpj(): string {
  return randomUUID().replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
}

/** Mesmo raciocínio de platform-organizations.e2e.spec.ts — assina o token direto em vez de
 * rodar o fluxo HTTP de login+MFA, pra não bater no rate limit de MFA compartilhado entre
 * specs e2e rodando serial no mesmo processo Jest. */
async function createPlatformAdminFixture(): Promise<{ platformAdminId: string; token: string }> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `E2E Platform Partners Admin ${suffix}`,
      email: `e2e-platform-partners-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  const token = platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
  return { platformAdminId: platformAdmin.id, token };
}

async function createAdminUserFixture(): Promise<{ email: string; password: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `E2E Platform Partners Isolation Org ${suffix}`, cnpj: fixtureCnpj() },
  });
  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `E2E AdminUser ${suffix}`,
      email: `e2e-adminuser-partners-${suffix}@test.coins-api.dev`,
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
  platformJwtService = app.get<JwtService>(PLATFORM_JWT_SERVICE);
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.partnerRefreshToken.deleteMany({ where: { partnerId: { in: createdPartnerIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: createdPartnerIds } } });
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

describe('Fluxo feliz — POST/GET/PATCH /platform/partners + reset-password', () => {
  it('cria parceiro, credencial funciona no login real, reset invalida sessão antiga e gera senha nova', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();

    const suffix = randomUUID();
    const contactEmail = `partner-e2e-${suffix}@test.coins-api.dev`;
    const createResponse = await request(server)
      .post('/platform/partners')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Parceiro E2E ${suffix}`,
        cnpj: fixtureCnpj(),
        category: 'Restaurante',
        takeRateBps: 500,
        pixKey: `pix-${suffix}@test.coins-api.dev`,
        contactEmail,
      })
      .expect(201);
    const created = createResponse.body as CreatePartnerResponseBody;
    createdPartnerIds.push(created.id);

    expect(created.status).toBe('ACTIVE');
    expect(created.credential.password).toEqual(expect.any(String));

    const listResponse = await request(server)
      .get('/platform/partners?limit=100')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const listBody = listResponse.body as { items: PartnerSummaryBody[] };
    const listedPartner = listBody.items.find((item) => item.id === created.id);
    expect(listedPartner).toBeDefined();
    expect(listedPartner?.offerCount).toBe(0);
    expect(listedPartner?.confirmedRedemptionCount).toBe(0);

    const detailResponse = await request(server)
      .get(`/platform/partners/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detailResponse.body as { id: string }).id).toBe(created.id);

    // credencial gerada no create funciona no login real do parceiro
    const loginResponse = await request(server)
      .post('/partners/login')
      .send({ email: contactEmail, password: created.credential.password })
      .expect(200);
    const originalTokens = loginResponse.body as PartnerTokenPairBody;

    const resetResponse = await request(server)
      .post(`/platform/partners/${created.id}/reset-password`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const newPassword = (resetResponse.body as { credential: { password: string } }).credential.password;
    expect(newPassword).not.toBe(created.credential.password);

    // refresh token emitido ANTES do reset deixou de funcionar
    await request(server)
      .post('/partners/refresh')
      .send({ refreshToken: originalTokens.refreshToken })
      .expect(401);

    // senha nova autentica
    await request(server)
      .post('/partners/login')
      .send({ email: contactEmail, password: newPassword })
      .expect(200);

    const patchResponse = await request(server)
      .patch(`/platform/partners/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'INACTIVE' })
      .expect(200);
    expect((patchResponse.body as { status: string }).status).toBe('INACTIVE');

    const createLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'PARTNER_CREATED' },
    });
    expect(createLog).not.toBeNull();
    const resetLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'PARTNER_PASSWORD_RESET' },
    });
    expect(resetLog).not.toBeNull();
    const updateLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'PARTNER_UPDATED' },
    });
    expect(updateLog).not.toBeNull();
  });

  it('CNPJ duplicado retorna 409', async () => {
    const { token } = await createPlatformAdminFixture();
    const suffix = randomUUID();
    const cnpj = fixtureCnpj();

    const first = await request(server)
      .post('/platform/partners')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Parceiro Dup A ${suffix}`,
        cnpj,
        category: 'Loja',
        takeRateBps: 300,
        pixKey: `pix-dup-a-${suffix}@test.coins-api.dev`,
        contactEmail: `partner-dup-a-${suffix}@test.coins-api.dev`,
      })
      .expect(201);
    createdPartnerIds.push((first.body as CreatePartnerResponseBody).id);

    await request(server)
      .post('/platform/partners')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Parceiro Dup B ${suffix}`,
        cnpj,
        category: 'Loja',
        takeRateBps: 300,
        pixKey: `pix-dup-b-${suffix}@test.coins-api.dev`,
        contactEmail: `partner-dup-b-${suffix}@test.coins-api.dev`,
      })
      .expect(409);
  });

  it('e-mail de contato duplicado retorna 409', async () => {
    const { token } = await createPlatformAdminFixture();
    const suffix = randomUUID();
    const contactEmail = `partner-dup-email-${suffix}@test.coins-api.dev`;

    const first = await request(server)
      .post('/platform/partners')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Parceiro Email Dup A ${suffix}`,
        cnpj: fixtureCnpj(),
        category: 'Loja',
        takeRateBps: 300,
        pixKey: `pix-email-dup-a-${suffix}@test.coins-api.dev`,
        contactEmail,
      })
      .expect(201);
    createdPartnerIds.push((first.body as CreatePartnerResponseBody).id);

    await request(server)
      .post('/platform/partners')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Parceiro Email Dup B ${suffix}`,
        cnpj: fixtureCnpj(),
        category: 'Loja',
        takeRateBps: 300,
        pixKey: `pix-email-dup-b-${suffix}@test.coins-api.dev`,
        contactEmail,
      })
      .expect(409);
  });
});

describe('Isolamento total — apenas PlatformAdmin acessa /platform/partners', () => {
  it('token de AdminUser recebe 401 em todas as rotas', async () => {
    const { email, password } = await createAdminUserFixture();
    const loginResponse = await request(server).post('/auth/login').send({ email, password }).expect(200);
    const accessToken = (loginResponse.body as { accessToken: string }).accessToken;

    await request(server)
      .get('/platform/partners')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await request(server)
      .post('/platform/partners')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        name: 'X',
        cnpj: fixtureCnpj(),
        category: 'Loja',
        takeRateBps: 300,
        pixKey: 'pix-x',
        contactEmail: 'x@test.coins-api.dev',
      })
      .expect(401);
  });

  it('token de Partner recebe 401 em todas as rotas', async () => {
    const jwtService = app.get(JwtService);
    const partnerToken = jwtService.sign({ sub: randomUUID(), type: 'partner' });

    await request(server)
      .get('/platform/partners')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(401);
    await request(server)
      .post('/platform/partners')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({
        name: 'X',
        cnpj: fixtureCnpj(),
        category: 'Loja',
        takeRateBps: 300,
        pixKey: 'pix-x',
        contactEmail: 'x@test.coins-api.dev',
      })
      .expect(401);
  });
});
