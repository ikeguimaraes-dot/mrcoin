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

interface PartnerCatalogBody {
  id: string;
  name: string;
  category: string;
  latitude: number | null;
  longitude: number | null;
}

interface PartnerAdminBody extends PartnerCatalogBody {
  cnpj: string;
  status: string;
  contactEmail: string | null;
  contactPhone: string | null;
}

interface ListResponseBody<T> {
  items: T[];
  nextCursor: string | null;
}

const FIXTURE_PASSWORD = 'Test@Password123';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const tokenService = new TokenService(jwtService, prisma);

const createdPartnerIds: string[] = [];
const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

async function createPartner(status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE'): Promise<{ id: string; name: string }> {
  const suffix = randomUUID();
  const partner = await prisma.partner.create({
    data: {
      name: `Partner Test ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
      category: 'Teste',
      takeRateBps: 500,
      pixKey: `pix-${suffix}@test.coins-api.dev`,
      contactEmail: `contato-${suffix}@test.coins-api.dev`,
      contactPhone: '11999990000',
      status,
    },
  });
  createdPartnerIds.push(partner.id);
  return { id: partner.id, name: partner.name };
}

interface AdminFixture {
  adminId: string;
  organizationId: string;
  role: AdminRole;
}

async function createAdmin(role: AdminRole): Promise<AdminFixture> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Partners Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `Partners Test Admin ${suffix}`,
      email: `partners-test-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role,
    },
  });
  createdAdminIds.push(admin.id);

  return { adminId: admin.id, organizationId: organization.id, role };
}

function adminTokenFor(admin: AdminFixture): Promise<string> {
  return tokenService.issueAccessToken({ id: admin.adminId, organizationId: admin.organizationId, role: admin.role });
}

async function createUserToken(): Promise<string> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: `enc-${suffix}`,
      cpfHash: `hash-${suffix}`,
      name: `Partners Test User ${suffix}`,
    },
  });
  createdUserIds.push(user.id);
  return jwtService.signAsync({ sub: user.id, type: 'user' });
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: createdPartnerIds } } });
  await prisma.$disconnect();
});

describe('GET /partners (catálogo do app)', () => {
  it('lista só parceiros ACTIVE — INACTIVE fica de fora', async () => {
    const active = await createPartner('ACTIVE');
    const inactive = await createPartner('INACTIVE');
    const token = await createUserToken();

    const response = await request(server)
      .get('/partners')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<PartnerCatalogBody>;
    const ids = body.items.map((p) => p.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });

  it('resposta nunca tem pixKey nem takeRateBps', async () => {
    const partner = await createPartner('ACTIVE');
    const token = await createUserToken();

    const response = await request(server)
      .get('/partners')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<PartnerCatalogBody>;
    const found = body.items.find((p) => p.id === partner.id);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty('pixKey');
    expect(found).not.toHaveProperty('takeRateBps');
    expect(found).not.toHaveProperty('cnpj');
  });

  it('sem token retorna 401', async () => {
    await request(server).get('/partners').expect(401);
  });
});

describe('GET /partners/:id (catálogo do app)', () => {
  it('parceiro INACTIVE retorna 404 (fora do catálogo = não encontrado)', async () => {
    const inactive = await createPartner('INACTIVE');
    const token = await createUserToken();

    await request(server)
      .get(`/partners/${inactive.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('parceiro ACTIVE devolve o shape do catálogo', async () => {
    const active = await createPartner('ACTIVE');
    const token = await createUserToken();

    const response = await request(server)
      .get(`/partners/${active.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Object.keys(response.body as object).sort()).toEqual(['category', 'id', 'latitude', 'longitude', 'name']);
  });
});

describe('GET /admin/partners (revisão administrativa)', () => {
  it('lista TODOS os status — inclui INACTIVE', async () => {
    const active = await createPartner('ACTIVE');
    const inactive = await createPartner('INACTIVE');
    const admin = await createAdmin('VIEWER');
    const token = await adminTokenFor(admin);

    const response = await request(server)
      .get('/admin/partners')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<PartnerAdminBody>;
    const ids = body.items.map((p) => p.id);
    expect(ids).toContain(active.id);
    expect(ids).toContain(inactive.id);
  });

  it('resposta nunca tem pixKey nem takeRateBps', async () => {
    const partner = await createPartner('ACTIVE');
    const admin = await createAdmin('VIEWER');
    const token = await adminTokenFor(admin);

    const response = await request(server)
      .get('/admin/partners')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<PartnerAdminBody>;
    const found = body.items.find((p) => p.id === partner.id);
    expect(found).toBeDefined();
    expect(found).not.toHaveProperty('pixKey');
    expect(found).not.toHaveProperty('takeRateBps');
    expect(found?.contactEmail).toBeTruthy();
  });

  it('sem token de admin retorna 401', async () => {
    await request(server).get('/admin/partners').expect(401);
  });
});
