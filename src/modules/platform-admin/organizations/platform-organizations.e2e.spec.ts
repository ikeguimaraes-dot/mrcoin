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

interface CreateOrganizationResponseBody {
  id: string;
  name: string;
  cnpj: string;
  status: string;
  invite: { id: string; inviteLink: string };
}

const prisma = new PrismaService();
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

/**
 * Assina o token direto com PLATFORM_JWT_SERVICE em vez de rodar o fluxo HTTP completo de
 * login+MFA (POST /platform/auth/login → mfa/setup → mfa/enable) — esse fluxo já é
 * exercitado por platform-admin-auth.e2e.spec.ts, e repeti-lo aqui bateria no rate limit
 * de MFA (PlatformAdminMfaRateLimitGuard: 5 tentativas/60s POR IP, compartilhado entre TODO
 * spec e2e que roda no mesmo processo Jest serial) e derrubaria aquele outro arquivo por
 * 429. O que este arquivo testa é a autorização/CRUD de organizations, não o login em si.
 */
async function createPlatformAdminFixture(): Promise<{ platformAdminId: string; email: string; token: string }> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `E2E Platform Orgs Admin ${suffix}`,
      email: `e2e-platform-orgs-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  const token = platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
  return { platformAdminId: platformAdmin.id, email: platformAdmin.email, token };
}

async function createAdminUserFixture(): Promise<{ email: string; password: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `E2E Platform Orgs Isolation Org ${suffix}`, cnpj: fixtureCnpj() },
  });
  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `E2E AdminUser ${suffix}`,
      email: `e2e-adminuser-orgs-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role: 'OPERATOR',
    },
  });
  createdOrgIds.push(organization.id);
  createdAdminIds.push(admin.id);
  return { email: admin.email, password: FIXTURE_PASSWORD };
}

function rawTokenFromInviteLink(inviteLink: string): string {
  const rawToken = inviteLink.split('/invites/')[1];
  if (!rawToken) {
    throw new Error(`inviteLink sem token: ${inviteLink}`);
  }
  return rawToken;
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
  await prisma.adminInvite.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.auditLog.deleteMany({ where: { actorAdminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { OR: [{ id: { in: createdAdminIds } }, { organizationId: { in: createdOrgIds } }] } });
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

describe('Fluxo feliz — POST/GET/PATCH /platform/organizations', () => {
  it('cria organização + convite de OWNER, lista, mostra detalhe e atualiza status', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();

    const suffix = randomUUID();
    const createResponse = await request(server)
      .post('/platform/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Empresa E2E ${suffix}`, cnpj: fixtureCnpj(), ownerEmail: `owner-e2e-${suffix}@test.coins-api.dev` })
      .expect(201);
    const created = createResponse.body as CreateOrganizationResponseBody;
    createdOrgIds.push(created.id);

    expect(created.status).toBe('ACTIVE');
    expect(created.invite.inviteLink).toContain('/invites/');

    const listResponse = await request(server)
      .get('/platform/organizations?limit=100')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const listBody = listResponse.body as { items: Array<{ id: string; adminUserCount: number; memberCount: number; circulatingBalance: number }> };
    const listedOrg = listBody.items.find((item) => item.id === created.id);
    expect(listedOrg).toBeDefined();
    expect(listedOrg?.adminUserCount).toBe(0);
    expect(listedOrg?.memberCount).toBe(0);
    expect(listedOrg?.circulatingBalance).toBe(0);

    const detailResponse = await request(server)
      .get(`/platform/organizations/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detailResponse.body as { id: string }).id).toBe(created.id);

    const patchResponse = await request(server)
      .patch(`/platform/organizations/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'SUSPENDED' })
      .expect(200);
    expect((patchResponse.body as { status: string }).status).toBe('SUSPENDED');

    const createLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'ORGANIZATION_CREATED' },
    });
    expect(createLog).not.toBeNull();
    const updateLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'ORGANIZATION_UPDATED' },
    });
    expect(updateLog).not.toBeNull();

    const acceptResponse = await request(server)
      .post(`/organizations/admins/invites/${rawTokenFromInviteLink(created.invite.inviteLink)}/accept`)
      .send({ name: 'Owner E2E', password: 'Owner@Password123' })
      .expect(200);
    expect((acceptResponse.body as { status: string }).status).toBe('MFA_SETUP_REQUIRED');

    const ownerAdmin = await prisma.adminUser.findFirst({ where: { organizationId: created.id } });
    if (ownerAdmin) createdAdminIds.push(ownerAdmin.id);
  });

  it('CNPJ duplicado retorna 409', async () => {
    const { token } = await createPlatformAdminFixture();
    const suffix = randomUUID();
    const cnpj = fixtureCnpj();

    const first = await request(server)
      .post('/platform/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Empresa Dup A ${suffix}`, cnpj, ownerEmail: `owner-dup-a-${suffix}@test.coins-api.dev` })
      .expect(201);
    createdOrgIds.push((first.body as CreateOrganizationResponseBody).id);

    await request(server)
      .post('/platform/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Empresa Dup B ${suffix}`, cnpj, ownerEmail: `owner-dup-b-${suffix}@test.coins-api.dev` })
      .expect(409);
  });
});

describe('Isolamento total — apenas PlatformAdmin acessa /platform/organizations', () => {
  it('token de AdminUser recebe 401 em todas as rotas', async () => {
    const { email, password } = await createAdminUserFixture();
    const loginResponse = await request(server).post('/auth/login').send({ email, password }).expect(200);
    const accessToken = (loginResponse.body as { accessToken: string }).accessToken;

    await request(server)
      .get('/platform/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(401);
    await request(server)
      .post('/platform/organizations')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'X', cnpj: fixtureCnpj(), ownerEmail: 'x@test.coins-api.dev' })
      .expect(401);
  });

  it('token de Partner recebe 401 em todas as rotas', async () => {
    const jwtService = app.get(JwtService);
    const partnerToken = jwtService.sign({ sub: randomUUID(), type: 'partner' });

    await request(server)
      .get('/platform/organizations')
      .set('Authorization', `Bearer ${partnerToken}`)
      .expect(401);
    await request(server)
      .post('/platform/organizations')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ name: 'X', cnpj: fixtureCnpj(), ownerEmail: 'x@test.coins-api.dev' })
      .expect(401);
  });
});
