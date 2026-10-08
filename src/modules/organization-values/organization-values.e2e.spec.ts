import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AdminRole, OrganizationValue } from '@prisma/client';
import { SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { swaggerConfig } from '../../swagger';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { TokenService } from '../auth/token.service';
import {
  backfillDefaultOrganizationValues,
  createDefaultOrganizationValues,
} from './default-organization-values';

interface ErrorResponseBody {
  code: string;
}

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
  role: AdminRole;
  token: string;
}

async function createOrganization(): Promise<string> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Values Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await createDefaultOrganizationValues(prisma, organization.id);
  return organization.id;
}

async function createAdmin(role: AdminRole, organizationId?: string): Promise<AdminFixture> {
  const orgId = organizationId ?? (await createOrganization());
  const suffix = randomUUID();
  const admin = await prisma.adminUser.create({
    data: {
      organizationId: orgId,
      name: `Values Test Admin ${role}`,
      email: `values-test-${role.toLowerCase()}-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword('Test@Password123'),
      role,
    },
  });
  createdAdminIds.push(admin.id);
  const token = await tokenService.issueAccessToken({ id: admin.id, organizationId: orgId, role });
  return { adminId: admin.id, organizationId: orgId, role, token };
}

function valuesOf(organizationId: string): Promise<OrganizationValue[]> {
  return prisma.organizationValue.findMany({
    where: { organizationId },
    orderBy: { sortOrder: 'asc' },
  });
}

function findValue(organizationId: string, name: string): Promise<OrganizationValue> {
  return prisma.organizationValue.findUniqueOrThrow({
    where: { organizationId_name: { organizationId, name } },
  });
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
  await prisma.distribution.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organizationValue.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('GET /admin/organization-values', () => {
  it('VIEWER lista só os valores ativos da própria organização, em ordem', async () => {
    const viewer = await createAdmin('VIEWER');
    const foco = await findValue(viewer.organizationId, 'Foco');
    await prisma.organizationValue.update({ where: { id: foco.id }, data: { isActive: false } });
    const otherOrg = await createAdmin('OWNER');

    const response = await request(server)
      .get('/admin/organization-values')
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);

    const body = response.body as { items: OrganizationValue[] };
    expect(body.items.map((value) => value.name)).toEqual(['Ordem', 'Método', 'Execução']);
    expect(body.items.every((value) => value.organizationId === viewer.organizationId)).toBe(true);
    expect(body.items.some((value) => value.organizationId === otherOrg.organizationId)).toBe(
      false,
    );
  });

  it('includeInactive=true também traz os desativados', async () => {
    const viewer = await createAdmin('VIEWER');
    const foco = await findValue(viewer.organizationId, 'Foco');
    await prisma.organizationValue.update({ where: { id: foco.id }, data: { isActive: false } });

    const response = await request(server)
      .get('/admin/organization-values?includeInactive=true')
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(200);

    const body = response.body as { items: OrganizationValue[] };
    expect(body.items).toHaveLength(4);
    expect(body.items[0]).toMatchObject({ name: 'Foco', isActive: false });
  });
});

describe('contrato do GET /admin/organization-values', () => {
  it('includeInactive sai opcional no OpenAPI (o coins-admin gera tipos daqui)', () => {
    const document = cleanupOpenApiDoc(SwaggerModule.createDocument(app, swaggerConfig));
    const parameters = document.paths['/admin/organization-values']?.get?.parameters ?? [];
    const includeInactive = parameters.find((parameter) => 'name' in parameter && parameter.name === 'includeInactive');

    expect(includeInactive).toMatchObject({ in: 'query', required: false });
  });

  it('includeInactive com valor fora de true/false é 400', async () => {
    const viewer = await createAdmin('VIEWER');

    await request(server)
      .get('/admin/organization-values?includeInactive=sim')
      .set('Authorization', `Bearer ${viewer.token}`)
      .expect(400);
  });
});

describe('POST /admin/organization-values', () => {
  it('MANAGER cria valor no fim da lista quando sortOrder é omitido, e grava AuditLog', async () => {
    const manager = await createAdmin('MANAGER');

    const response = await request(server)
      .post('/admin/organization-values')
      .set('Authorization', `Bearer ${manager.token}`)
      .send({ name: '  Coragem ', description: 'Agir mesmo com medo' })
      .expect(201);

    expect(response.body).toMatchObject({
      organizationId: manager.organizationId,
      name: 'Coragem',
      description: 'Agir mesmo com medo',
      sortOrder: 5,
      isActive: true,
    });

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: manager.organizationId, action: 'ORGANIZATION_VALUE_CREATED' },
    });
    expect(audit).not.toBeNull();
  });

  it('nome repetido na mesma organização é 409 ORGANIZATION_VALUE_NAME_TAKEN', async () => {
    const owner = await createAdmin('OWNER');

    const response = await request(server)
      .post('/admin/organization-values')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Foco' })
      .expect(409);

    expect((response.body as ErrorResponseBody).code).toBe('ORGANIZATION_VALUE_NAME_TAKEN');
  });

  it('OPERATOR e VIEWER não escrevem (403)', async () => {
    const operator = await createAdmin('OPERATOR');
    const viewer = await createAdmin('VIEWER', operator.organizationId);

    for (const admin of [operator, viewer]) {
      await request(server)
        .post('/admin/organization-values')
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ name: 'Proibido' })
        .expect(403);
    }
  });

  it('nome vazio ou longo demais é 400', async () => {
    const owner = await createAdmin('OWNER');

    for (const name of ['   ', 'x'.repeat(61)]) {
      await request(server)
        .post('/admin/organization-values')
        .set('Authorization', `Bearer ${owner.token}`)
        .send({ name })
        .expect(400);
    }
  });
});

describe('PATCH /admin/organization-values/:id', () => {
  it('renomeia, reordena e desativa', async () => {
    const owner = await createAdmin('OWNER');
    const foco = await findValue(owner.organizationId, 'Foco');

    const response = await request(server)
      .patch(`/admin/organization-values/${foco.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Foco total', sortOrder: 10, isActive: false, description: null })
      .expect(200);

    expect(response.body).toMatchObject({
      id: foco.id,
      name: 'Foco total',
      sortOrder: 10,
      isActive: false,
      description: null,
    });
  });

  it('renomear pra um nome já usado na organização é 409', async () => {
    const owner = await createAdmin('OWNER');
    const foco = await findValue(owner.organizationId, 'Foco');

    const response = await request(server)
      .patch(`/admin/organization-values/${foco.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Ordem' })
      .expect(409);

    expect((response.body as ErrorResponseBody).code).toBe('ORGANIZATION_VALUE_NAME_TAKEN');
  });

  it('valor de outra organização é 404 (não revela que existe)', async () => {
    const owner = await createAdmin('OWNER');
    const intruder = await createAdmin('OWNER');
    const foco = await findValue(owner.organizationId, 'Foco');

    const response = await request(server)
      .patch(`/admin/organization-values/${foco.id}`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ name: 'Sequestrado' })
      .expect(404);

    expect((response.body as ErrorResponseBody).code).toBe('ORGANIZATION_VALUE_NOT_FOUND');
    const unchanged = await prisma.organizationValue.findUniqueOrThrow({ where: { id: foco.id } });
    expect(unchanged.name).toBe('Foco');
  });

  it('body vazio é 400', async () => {
    const owner = await createAdmin('OWNER');
    const foco = await findValue(owner.organizationId, 'Foco');

    await request(server)
      .patch(`/admin/organization-values/${foco.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({})
      .expect(400);
  });
});

describe('DELETE /admin/organization-values/:id', () => {
  it('valor sem uso é apagado (204)', async () => {
    const owner = await createAdmin('OWNER');
    const foco = await findValue(owner.organizationId, 'Foco');

    await request(server)
      .delete(`/admin/organization-values/${foco.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(204);

    expect(await prisma.organizationValue.findUnique({ where: { id: foco.id } })).toBeNull();
  });

  it('valor usado em reconhecimento não pode ser apagado (409), só desativado', async () => {
    const owner = await createAdmin('OWNER');
    const foco = await findValue(owner.organizationId, 'Foco');
    await prisma.distribution.create({
      data: {
        organizationId: owner.organizationId,
        adminUserId: owner.adminId,
        message: 'Mandou bem',
        organizationValueId: foco.id,
        status: 'COMPLETED',
      },
    });

    const response = await request(server)
      .delete(`/admin/organization-values/${foco.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(409);

    expect((response.body as ErrorResponseBody).code).toBe('ORGANIZATION_VALUE_IN_USE');
    expect(await prisma.organizationValue.findUnique({ where: { id: foco.id } })).not.toBeNull();

    await request(server)
      .patch(`/admin/organization-values/${foco.id}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ isActive: false })
      .expect(200);
  });

  it('valor de outra organização é 404', async () => {
    const owner = await createAdmin('OWNER');
    const intruder = await createAdmin('OWNER');
    const foco = await findValue(owner.organizationId, 'Foco');

    await request(server)
      .delete(`/admin/organization-values/${foco.id}`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .expect(404);

    expect(await prisma.organizationValue.findUnique({ where: { id: foco.id } })).not.toBeNull();
  });
});

describe('backfillDefaultOrganizationValues', () => {
  it('semeia só organizações sem nenhum valor e é idempotente', async () => {
    const suffix = randomUUID();
    const empty = await prisma.organization.create({
      data: {
        name: `Values Backfill Empty ${suffix}`,
        cnpj: suffix.replace(/-/g, '').slice(0, 14),
      },
    });
    createdOrgIds.push(empty.id);
    const customized = await createAdmin('OWNER');
    const foco = await findValue(customized.organizationId, 'Foco');
    await prisma.organizationValue.update({
      where: { id: foco.id },
      data: { name: 'Foco renomeado' },
    });

    const first = await backfillDefaultOrganizationValues(prisma);
    const second = await backfillDefaultOrganizationValues(prisma);

    expect(first.seededOrganizationIds).toContain(empty.id);
    expect(second.seededOrganizationIds).not.toContain(empty.id);
    expect((await valuesOf(empty.id)).map((value) => value.name)).toEqual([
      'Foco',
      'Ordem',
      'Método',
      'Execução',
    ]);
    expect((await valuesOf(customized.organizationId)).map((value) => value.name)).toEqual([
      'Foco renomeado',
      'Ordem',
      'Método',
      'Execução',
    ]);
  });
});
