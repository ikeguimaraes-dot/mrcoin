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

interface OrganizationResponseBody {
  id: string;
  name: string;
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

let app: INestApplication;
let server: Server;

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
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.adminInvite.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
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
