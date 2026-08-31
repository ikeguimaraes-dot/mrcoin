import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { hashPassword } from './password.util';

interface LoginResponseBody {
  status: string;
  accessToken?: string;
  refreshToken?: string;
}

interface AdminSummaryBody {
  id: string;
  email: string;
}

interface ListAdminsResponseBody {
  items: AdminSummaryBody[];
}

const prisma = new PrismaService();
const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];

let app: INestApplication;
let server: Server;

interface AdminFixture {
  organizationId: string;
  adminId: string;
  email: string;
  password: string;
}

async function createOperatorAdmin(label: string): Promise<AdminFixture> {
  const suffix = randomUUID();
  const password = 'Test@Password123';

  const organization = await prisma.organization.create({
    data: { name: `E2E ${label} ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `E2E Admin ${label}`,
      email: `e2e-${label.toLowerCase().replace(/\s+/g, '-')}-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(password),
      role: 'OPERATOR',
    },
  });

  createdOrgIds.push(organization.id);
  createdAdminIds.push(admin.id);

  return { organizationId: organization.id, adminId: admin.id, email: admin.email, password };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.auditLog.deleteMany({ where: { actorAdminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('Isolamento multi-tenant — GET /auth/admins', () => {
  it('admin da org A só vê admins da org A, mesmo tentando ?organizationId= da org B', async () => {
    const orgA = await createOperatorAdmin('Org A');
    const orgB = await createOperatorAdmin('Org B');

    const loginResponse = await request(server)
      .post('/auth/login')
      .send({ email: orgA.email, password: orgA.password })
      .expect(200);

    const loginBody = loginResponse.body as LoginResponseBody;
    expect(loginBody.status).toBe('OK');
    const accessToken = loginBody.accessToken as string;

    const response = await request(server)
      .get(`/auth/admins?organizationId=${orgB.organizationId}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const items = (response.body as ListAdminsResponseBody).items;
    const emails = items.map((item) => item.email);

    expect(emails).toContain(orgA.email);
    expect(emails).not.toContain(orgB.email);

    const organizationIdsSeen = new Set(
      await Promise.all(
        items.map(async (item) => {
          const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: item.id } });
          return admin.organizationId;
        }),
      ),
    );

    expect(Array.from(organizationIdsSeen)).toEqual([orgA.organizationId]);
  });

  it('sem token de autenticação, GET /auth/admins retorna 401', async () => {
    await request(server).get('/auth/admins').expect(401);
  });
});
