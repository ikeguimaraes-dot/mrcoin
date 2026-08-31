import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AdminRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { TokenService } from '../auth/token.service';
import { PLATFORM_JWT_SERVICE } from '../platform-admin/platform-jwt.token';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';

interface OrganizationResponseBody {
  id: string;
  name: string;
  conversionRate: { coinsPerReal: number; coinsPerRealScaled: number; effectiveSince: string };
}

interface AuditLogEntryBody {
  id: string;
  action: string;
  organizationId: string;
}

interface AuditLogListResponseBody {
  items: AuditLogEntryBody[];
}

const FIXTURE_PASSWORD = 'Test@Password123';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const tokenService = new TokenService(jwtService, prisma);

const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];
const createdPlatformAdminIds: string[] = [];

let app: INestApplication;
let server: Server;
let platformJwtService: JwtService;

async function createPlatformAdminFixture(): Promise<string> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `Org Test Platform Admin ${suffix}`,
      email: `org-test-platform-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  return platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
}

interface AdminFixture {
  adminId: string;
  organizationId: string;
  email: string;
  role: AdminRole;
}

async function createAdmin(role: AdminRole): Promise<AdminFixture> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Org Test ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  // Toda organização precisa de uma taxa própria pra GET /organizations/me funcionar —
  // criada aqui direto (bypassa createOrganizationWithOwnerInvite, que faz isso sozinho em
  // produção) porque este fixture só quer um org+admin, não o fluxo de convite completo.
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `Org Test Admin ${role} ${suffix}`,
      email: `org-test-${role.toLowerCase()}-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role,
    },
  });
  createdAdminIds.push(admin.id);

  return { adminId: admin.id, organizationId: organization.id, email: admin.email, role };
}

function tokenFor(admin: AdminFixture): Promise<string> {
  return tokenService.issueAccessToken({ id: admin.adminId, organizationId: admin.organizationId, role: admin.role });
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
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.platformAdminAuditLog.deleteMany({
    where: { platformAdminId: { in: createdPlatformAdminIds } },
  });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdPlatformAdminIds } } });
  await prisma.$disconnect();
});

describe('GET/PATCH /organizations/me', () => {
  it('qualquer admin autenticado lê os dados da própria organização', async () => {
    const viewer = await createAdmin('VIEWER');
    const viewerToken = await tokenFor(viewer);

    const response = await request(server)
      .get('/organizations/me')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(200);

    expect((response.body as OrganizationResponseBody).id).toBe(viewer.organizationId);
    // SEGURANÇA: asaasCustomerId é referência interna do PSP — nunca sai na resposta HTTP.
    expect(response.body).not.toHaveProperty('asaasCustomerId');
  });

  it('OWNER atualiza nome da organização e a mudança fica registrada no audit log', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const newName = `Renomeada ${randomUUID()}`;

    const response = await request(server)
      .patch('/organizations/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: newName })
      .expect(200);

    expect((response.body as OrganizationResponseBody).name).toBe(newName);

    const auditLog = await prisma.auditLog.findFirst({
      where: { organizationId: owner.organizationId, action: 'ORGANIZATION_UPDATED', actorAdminUserId: owner.adminId },
    });
    expect(auditLog).not.toBeNull();
  });

  it('MANAGER não pode atualizar a organização', async () => {
    const manager = await createAdmin('MANAGER');
    const managerToken = await tokenFor(manager);

    await request(server)
      .patch('/organizations/me')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ name: 'Não deveria funcionar' })
      .expect(403);
  });

  it('OWNER lê a taxa de conversão vigente da própria organização, nunca a de outra', async () => {
    const ownerA = await createAdmin('OWNER');
    const ownerB = await createAdmin('OWNER');
    const ownerTokenA = await tokenFor(ownerA);

    const platformAdminToken = await createPlatformAdminFixture();
    await request(server)
      .patch(`/platform/organizations/${ownerB.organizationId}/conversion-rate`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ coinsPerReal: 9.99 })
      .expect(200);

    const response = await request(server)
      .get('/organizations/me')
      .set('Authorization', `Bearer ${ownerTokenA}`)
      .expect(200);

    const body = response.body as OrganizationResponseBody;
    expect(body.id).toBe(ownerA.organizationId);
    // taxa padrão da própria org A — nunca o 9,99 que acabou de ser setado na org B
    expect(body.conversionRate.coinsPerReal).toBe(1.25);
    expect(body.conversionRate.coinsPerRealScaled).toBe(125);
  });

  it('reflete a taxa vigente depois que platform admin muda', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const platformAdminToken = await createPlatformAdminFixture();

    await request(server)
      .patch(`/platform/organizations/${owner.organizationId}/conversion-rate`)
      .set('Authorization', `Bearer ${platformAdminToken}`)
      .send({ coinsPerReal: 4.5 })
      .expect(200);

    const response = await request(server)
      .get('/organizations/me')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);

    const body = response.body as OrganizationResponseBody;
    expect(body.conversionRate.coinsPerReal).toBe(4.5);
    expect(body.conversionRate.coinsPerRealScaled).toBe(450);
  });
});

describe('GET /organizations/audit-log', () => {
  it('filtra por action e nunca mistura entries de outra organização', async () => {
    const ownerA = await createAdmin('OWNER');
    const ownerB = await createAdmin('OWNER');
    const ownerAToken = await tokenFor(ownerA);
    const ownerBToken = await tokenFor(ownerB);

    await request(server)
      .patch('/organizations/me')
      .set('Authorization', `Bearer ${ownerAToken}`)
      .send({ name: 'Org A renomeada' })
      .expect(200);

    await request(server)
      .patch('/organizations/me')
      .set('Authorization', `Bearer ${ownerBToken}`)
      .send({ name: 'Org B renomeada' })
      .expect(200);

    const response = await request(server)
      .get('/organizations/audit-log')
      .query({ action: 'ORGANIZATION_UPDATED' })
      .set('Authorization', `Bearer ${ownerAToken}`)
      .expect(200);

    const items = (response.body as AuditLogListResponseBody).items;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.organizationId).toBe(ownerA.organizationId);
      expect(item.action).toBe('ORGANIZATION_UPDATED');
      // SEGURANÇA: ip é PII do ator — nunca sai na resposta HTTP do audit log.
      expect(item).not.toHaveProperty('ip');
    }
  });

  it('VIEWER não pode consultar o audit log (rota exige MANAGER+)', async () => {
    const viewer = await createAdmin('VIEWER');
    const viewerToken = await tokenFor(viewer);

    await request(server)
      .get('/organizations/audit-log')
      .set('Authorization', `Bearer ${viewerToken}`)
      .expect(403);
  });
});
