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

interface InviteResponseBody {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  inviteLink: string;
}

interface AcceptResponseBody {
  status: 'OK' | 'MFA_SETUP_REQUIRED';
  accessToken?: string;
  mfaChallengeToken?: string;
}

interface ErrorResponseBody {
  code: string;
}

interface AuditLogPayloadWithPassword {
  password?: string;
}

const FIXTURE_PASSWORD = 'Test@Password123';
const NEW_ADMIN_PASSWORD = 'Str0ngPassword!';

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

async function createAdmin(role: AdminRole, organizationId?: string): Promise<AdminFixture> {
  const suffix = randomUUID();
  const orgId =
    organizationId ??
    (
      await prisma.organization.create({
        data: { name: `Invites Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
      })
    ).id;

  if (!organizationId) {
    createdOrgIds.push(orgId);
  }

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: orgId,
      name: `Invites Test ${role} ${suffix}`,
      email: `invites-test-${role.toLowerCase()}-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role,
    },
  });

  createdAdminIds.push(admin.id);
  return { adminId: admin.id, organizationId: orgId, email: admin.email, role };
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

describe('Fluxo completo de convite', () => {
  it('OWNER convida MANAGER, aceite cria o AdminUser mas exige MFA antes de qualquer sessão válida', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const inviteeEmail = `invitee-${randomUUID()}@test.coins-api.dev`;

    const inviteResponse = await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: inviteeEmail, role: 'MANAGER' })
      .expect(201);

    const inviteBody = inviteResponse.body as InviteResponseBody;
    expect(inviteBody.email).toBe(inviteeEmail);
    const rawToken = inviteBody.inviteLink.split('/invites/')[1];

    const acceptResponse = await request(server)
      .post(`/organizations/admins/invites/${rawToken}/accept`)
      .send({ name: 'Novo Manager', password: NEW_ADMIN_PASSWORD })
      .expect(200);

    // Achado da Sessão 11: antes desse fix, accept() devolvia accessToken direto pra
    // qualquer role — MANAGER/OWNER furavam a obrigatoriedade de MFA do CLAUDE.md. Agora
    // tem que vir MFA_SETUP_REQUIRED, igual AuthService.login() já faz.
    const acceptBody = acceptResponse.body as AcceptResponseBody;
    expect(acceptBody.status).toBe('MFA_SETUP_REQUIRED');
    expect(acceptBody.mfaChallengeToken).toBeTruthy();
    expect(acceptBody.accessToken).toBeUndefined();

    const created = await prisma.adminUser.findUniqueOrThrow({ where: { email: inviteeEmail } });
    createdAdminIds.push(created.id);
    expect(created.role).toBe('MANAGER');
    expect(created.organizationId).toBe(owner.organizationId);
    expect(created.mfaEnabled).toBe(false);

    const invite = await prisma.adminInvite.findUniqueOrThrow({ where: { id: inviteBody.id } });
    expect(invite.acceptedAt).not.toBeNull();

    const inviteAuditLog = await prisma.auditLog.findFirst({
      where: { organizationId: owner.organizationId, action: 'ADMIN_INVITE_CREATED', actorAdminUserId: owner.adminId },
    });
    expect(inviteAuditLog).not.toBeNull();

    const acceptAuditLog = await prisma.auditLog.findFirst({
      where: { organizationId: owner.organizationId, action: 'ADMIN_INVITE_ACCEPTED', actorAdminUserId: created.id },
    });
    expect(acceptAuditLog).not.toBeNull();
    const acceptPayload = acceptAuditLog?.payload as AuditLogPayloadWithPassword;
    expect(acceptPayload.password).toBe('[REDACTED]');
  });

  it('convite de OWNER também exige MFA_SETUP_REQUIRED no aceite, nunca sessão direta', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const inviteeEmail = `owner-invitee-${randomUUID()}@test.coins-api.dev`;

    const inviteResponse = await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: inviteeEmail, role: 'OWNER' })
      .expect(201);

    const rawToken = (inviteResponse.body as InviteResponseBody).inviteLink.split('/invites/')[1];

    const acceptResponse = await request(server)
      .post(`/organizations/admins/invites/${rawToken}/accept`)
      .send({ name: 'Novo Owner', password: NEW_ADMIN_PASSWORD })
      .expect(200);

    const acceptBody = acceptResponse.body as AcceptResponseBody;
    expect(acceptBody.status).toBe('MFA_SETUP_REQUIRED');
    expect(acceptBody.mfaChallengeToken).toBeTruthy();
    expect(acceptBody.accessToken).toBeUndefined();

    const created = await prisma.adminUser.findUniqueOrThrow({ where: { email: inviteeEmail } });
    createdAdminIds.push(created.id);
    expect(created.role).toBe('OWNER');
  });

  it('convite de OPERATOR (fora da regra de MFA obrigatório) continua recebendo sessão direto no aceite', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const inviteeEmail = `operator-invitee-${randomUUID()}@test.coins-api.dev`;

    const inviteResponse = await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: inviteeEmail, role: 'OPERATOR' })
      .expect(201);

    const rawToken = (inviteResponse.body as InviteResponseBody).inviteLink.split('/invites/')[1];

    const acceptResponse = await request(server)
      .post(`/organizations/admins/invites/${rawToken}/accept`)
      .send({ name: 'Novo Operator', password: NEW_ADMIN_PASSWORD })
      .expect(200);

    const acceptBody = acceptResponse.body as AcceptResponseBody;
    expect(acceptBody.status).toBe('OK');
    expect(acceptBody.accessToken).toBeTruthy();
    expect(acceptBody.mfaChallengeToken).toBeUndefined();

    const created = await prisma.adminUser.findUniqueOrThrow({ where: { email: inviteeEmail } });
    createdAdminIds.push(created.id);
    expect(created.role).toBe('OPERATOR');
  });
});

describe('Permissões por papel — convites', () => {
  it('MANAGER convida OPERATOR com sucesso', async () => {
    const manager = await createAdmin('MANAGER');
    const managerToken = await tokenFor(manager);

    await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ email: `op-${randomUUID()}@test.coins-api.dev`, role: 'OPERATOR' })
      .expect(201);
  });

  it('MANAGER não pode convidar OWNER (CANNOT_ASSIGN_HIGHER_ROLE)', async () => {
    const manager = await createAdmin('MANAGER');
    const managerToken = await tokenFor(manager);

    const response = await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ email: `owner-${randomUUID()}@test.coins-api.dev`, role: 'OWNER' })
      .expect(403);

    expect((response.body as ErrorResponseBody).code).toBe('CANNOT_ASSIGN_HIGHER_ROLE');
  });

  it('OPERATOR não pode convidar ninguém', async () => {
    const operator = await createAdmin('OPERATOR');
    const operatorToken = await tokenFor(operator);

    await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ email: `x-${randomUUID()}@test.coins-api.dev`, role: 'VIEWER' })
      .expect(403);
  });

  it('VIEWER não pode convidar ninguém', async () => {
    const viewer = await createAdmin('VIEWER');
    const viewerToken = await tokenFor(viewer);

    await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ email: `x-${randomUUID()}@test.coins-api.dev`, role: 'VIEWER' })
      .expect(403);
  });

  it('convidar e-mail já cadastrado retorna EMAIL_ALREADY_IN_USE', async () => {
    const owner = await createAdmin('OWNER');
    const existing = await createAdmin('VIEWER');
    const ownerToken = await tokenFor(owner);

    const response = await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: existing.email, role: 'VIEWER' })
      .expect(409);

    expect((response.body as ErrorResponseBody).code).toBe('EMAIL_ALREADY_IN_USE');
  });
});

describe('Aceite de convite — casos de erro', () => {
  it('token inexistente retorna INVITE_TOKEN_INVALID', async () => {
    const response = await request(server)
      .post(`/organizations/admins/invites/${randomUUID()}/accept`)
      .send({ name: 'X', password: NEW_ADMIN_PASSWORD })
      .expect(404);

    expect((response.body as ErrorResponseBody).code).toBe('INVITE_TOKEN_INVALID');
  });

  it('token expirado retorna INVITE_EXPIRED', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    const inviteResponse = await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: `expired-${randomUUID()}@test.coins-api.dev`, role: 'VIEWER' })
      .expect(201);

    const inviteBody = inviteResponse.body as InviteResponseBody;
    const rawToken = inviteBody.inviteLink.split('/invites/')[1];
    await prisma.adminInvite.update({ where: { id: inviteBody.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const response = await request(server)
      .post(`/organizations/admins/invites/${rawToken}/accept`)
      .send({ name: 'X', password: NEW_ADMIN_PASSWORD })
      .expect(400);

    expect((response.body as ErrorResponseBody).code).toBe('INVITE_EXPIRED');
  });

  it('token já aceito retorna INVITE_ALREADY_USED na segunda tentativa', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);
    const inviteeEmail = `twice-${randomUUID()}@test.coins-api.dev`;

    const inviteResponse = await request(server)
      .post('/organizations/admins/invites')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ email: inviteeEmail, role: 'VIEWER' })
      .expect(201);

    const rawToken = (inviteResponse.body as InviteResponseBody).inviteLink.split('/invites/')[1];

    await request(server)
      .post(`/organizations/admins/invites/${rawToken}/accept`)
      .send({ name: 'X', password: NEW_ADMIN_PASSWORD })
      .expect(200);

    const created = await prisma.adminUser.findUniqueOrThrow({ where: { email: inviteeEmail } });
    createdAdminIds.push(created.id);

    const response = await request(server)
      .post(`/organizations/admins/invites/${rawToken}/accept`)
      .send({ name: 'X', password: NEW_ADMIN_PASSWORD })
      .expect(409);

    expect((response.body as ErrorResponseBody).code).toBe('INVITE_ALREADY_USED');
  });
});

describe('Troca de papel e desativação', () => {
  it('OWNER troca o papel de outro admin com sucesso', async () => {
    const owner = await createAdmin('OWNER');
    const target = await createAdmin('VIEWER', owner.organizationId);
    const ownerToken = await tokenFor(owner);

    await request(server)
      .patch(`/organizations/admins/${target.adminId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'OPERATOR' })
      .expect(200);

    const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: target.adminId } });
    expect(updated.role).toBe('OPERATOR');
  });

  it('OWNER não pode trocar o próprio papel (CANNOT_MODIFY_SELF)', async () => {
    const owner = await createAdmin('OWNER');
    const ownerToken = await tokenFor(owner);

    const response = await request(server)
      .patch(`/organizations/admins/${owner.adminId}/role`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ role: 'MANAGER' })
      .expect(403);

    expect((response.body as ErrorResponseBody).code).toBe('CANNOT_MODIFY_SELF');
  });

  it('MANAGER não pode trocar papel de ninguém (rota exige OWNER)', async () => {
    const manager = await createAdmin('MANAGER');
    const target = await createAdmin('VIEWER', manager.organizationId);
    const managerToken = await tokenFor(manager);

    await request(server)
      .patch(`/organizations/admins/${target.adminId}/role`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ role: 'OPERATOR' })
      .expect(403);
  });

  it('MANAGER desativa OPERATOR com sucesso', async () => {
    const manager = await createAdmin('MANAGER');
    const target = await createAdmin('OPERATOR', manager.organizationId);
    const managerToken = await tokenFor(manager);

    await request(server)
      .patch(`/organizations/admins/${target.adminId}/deactivate`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(200);

    const updated = await prisma.adminUser.findUniqueOrThrow({ where: { id: target.adminId } });
    expect(updated.status).toBe('INACTIVE');
  });

  it('OPERATOR não pode desativar ninguém (rota exige MANAGER+)', async () => {
    const operator = await createAdmin('OPERATOR');
    const target = await createAdmin('VIEWER', operator.organizationId);
    const operatorToken = await tokenFor(operator);

    await request(server)
      .patch(`/organizations/admins/${target.adminId}/deactivate`)
      .set('Authorization', `Bearer ${operatorToken}`)
      .expect(403);
  });

  it('MANAGER não pode desativar outro MANAGER (CANNOT_MODIFY_HIGHER_RANK)', async () => {
    const manager = await createAdmin('MANAGER');
    const otherManager = await createAdmin('MANAGER', manager.organizationId);
    const managerToken = await tokenFor(manager);

    const response = await request(server)
      .patch(`/organizations/admins/${otherManager.adminId}/deactivate`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);

    expect((response.body as ErrorResponseBody).code).toBe('CANNOT_MODIFY_HIGHER_RANK');
  });

  it('admin não pode desativar a si mesmo (CANNOT_MODIFY_SELF)', async () => {
    const manager = await createAdmin('MANAGER');
    const managerToken = await tokenFor(manager);

    const response = await request(server)
      .patch(`/organizations/admins/${manager.adminId}/deactivate`)
      .set('Authorization', `Bearer ${managerToken}`)
      .expect(403);

    expect((response.body as ErrorResponseBody).code).toBe('CANNOT_MODIFY_SELF');
  });
});
