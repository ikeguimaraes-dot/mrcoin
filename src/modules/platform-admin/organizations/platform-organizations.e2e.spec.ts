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

interface ConversionRateBody {
  coinsPerReal: number;
  coinsPerRealScaled: number;
  effectiveSince: string;
}

interface CreateOrganizationResponseBody {
  id: string;
  name: string;
  cnpj: string;
  status: string;
  invite: { id: string; inviteLink: string };
  conversionRate: ConversionRateBody;
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
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
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
    // sem coinsPerReal no create, nasce com a taxa padrão da plataforma
    expect(created.conversionRate.coinsPerReal).toBe(1.25);
    expect(created.conversionRate.coinsPerRealScaled).toBe(125);

    const listResponse = await request(server)
      .get('/platform/organizations?limit=100')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const listBody = listResponse.body as {
      items: Array<{
        id: string;
        adminUserCount: number;
        memberCount: number;
        circulatingBalance: number;
        conversionRate: ConversionRateBody;
      }>;
    };
    const listedOrg = listBody.items.find((item) => item.id === created.id);
    expect(listedOrg).toBeDefined();
    expect(listedOrg?.adminUserCount).toBe(0);
    expect(listedOrg?.memberCount).toBe(0);
    expect(listedOrg?.circulatingBalance).toBe(0);
    expect(listedOrg?.conversionRate.coinsPerReal).toBe(1.25);
    expect(listedOrg?.conversionRate.coinsPerRealScaled).toBe(125);

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

  it('coinsPerReal explícito no create usa o valor dado em vez do padrão', async () => {
    const { token } = await createPlatformAdminFixture();
    const suffix = randomUUID();

    const response = await request(server)
      .post('/platform/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Empresa Taxa Custom ${suffix}`,
        cnpj: fixtureCnpj(),
        ownerEmail: `owner-taxa-custom-${suffix}@test.coins-api.dev`,
        coinsPerReal: 2.5,
      })
      .expect(201);
    const created = response.body as CreateOrganizationResponseBody;
    createdOrgIds.push(created.id);

    expect(created.conversionRate.coinsPerReal).toBe(2.5);
    expect(created.conversionRate.coinsPerRealScaled).toBe(250);
  });

  it('organização sem taxa (fora do caminho normal) não derruba a listagem — conversionRate vem null pra ela', async () => {
    const { token } = await createPlatformAdminFixture();

    // Cria direto via Prisma, bypassando createOrganizationWithOwnerInvite — simula uma
    // organização que, por algum motivo fora do fluxo normal, nunca ganhou uma taxa.
    const suffix = randomUUID();
    const orphanOrg = await prisma.organization.create({
      data: { name: `Empresa Sem Taxa ${suffix}`, cnpj: fixtureCnpj() },
    });
    createdOrgIds.push(orphanOrg.id);

    const listResponse = await request(server)
      .get(`/platform/organizations?limit=100`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const listBody = listResponse.body as { items: Array<{ id: string; conversionRate: ConversionRateBody | null }> };
    const listedOrphan = listBody.items.find((item) => item.id === orphanOrg.id);
    expect(listedOrphan).toBeDefined();
    expect(listedOrphan?.conversionRate).toBeNull();

    const detailResponse = await request(server)
      .get(`/platform/organizations/${orphanOrg.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detailResponse.body as { conversionRate: ConversionRateBody | null }).conversionRate).toBeNull();
  });
});

describe('GET/PATCH /platform/organizations/:id/conversion-rate', () => {
  it('GET devolve a taxa vigente; PATCH muda e grava audit log', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();
    const suffix = randomUUID();

    const createResponse = await request(server)
      .post('/platform/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Empresa Rate Endpoint ${suffix}`,
        cnpj: fixtureCnpj(),
        ownerEmail: `owner-rate-endpoint-${suffix}@test.coins-api.dev`,
      })
      .expect(201);
    const organizationId = (createResponse.body as CreateOrganizationResponseBody).id;
    createdOrgIds.push(organizationId);

    const getResponse = await request(server)
      .get(`/platform/organizations/${organizationId}/conversion-rate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const getBody = getResponse.body as ConversionRateBody;
    expect(getBody.coinsPerReal).toBe(1.25);
    expect(getBody.coinsPerRealScaled).toBe(125);

    const patchResponse = await request(server)
      .patch(`/platform/organizations/${organizationId}/conversion-rate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ coinsPerReal: 3.33 })
      .expect(200);
    const patchBody = patchResponse.body as ConversionRateBody;
    expect(patchBody.coinsPerReal).toBe(3.33);
    expect(patchBody.coinsPerRealScaled).toBe(333);

    const getAfterPatch = await request(server)
      .get(`/platform/organizations/${organizationId}/conversion-rate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((getAfterPatch.body as ConversionRateBody).coinsPerReal).toBe(3.33);

    const auditLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'CONVERSION_RATE_UPDATED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditLog).not.toBeNull();
    const payload = auditLog?.payload as { organizationId?: string; newCoinsPerReal?: number } | null;
    expect(payload?.organizationId).toBe(organizationId);
    expect(payload?.newCoinsPerReal).toBe(3.33);
  });

  it('organização inexistente retorna 404 no GET e no PATCH', async () => {
    const { token } = await createPlatformAdminFixture();

    await request(server)
      .get(`/platform/organizations/${randomUUID()}/conversion-rate`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    await request(server)
      .patch(`/platform/organizations/${randomUUID()}/conversion-rate`)
      .set('Authorization', `Bearer ${token}`)
      .send({ coinsPerReal: 1 })
      .expect(404);
  });

  it('token de AdminUser e de Partner recebem 401', async () => {
    const { token } = await createPlatformAdminFixture();
    const suffix = randomUUID();

    const createResponse = await request(server)
      .post('/platform/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: `Empresa Rate Isolamento ${suffix}`,
        cnpj: fixtureCnpj(),
        ownerEmail: `owner-rate-isolamento-${suffix}@test.coins-api.dev`,
      })
      .expect(201);
    const organizationId = (createResponse.body as CreateOrganizationResponseBody).id;
    createdOrgIds.push(organizationId);

    const jwtService = app.get(JwtService);
    const adminToken = jwtService.sign({ sub: randomUUID(), organizationId: randomUUID(), role: 'OPERATOR', type: 'admin' });
    const partnerToken = jwtService.sign({ sub: randomUUID(), type: 'partner' });

    for (const badToken of [adminToken, partnerToken]) {
      await request(server)
        .get(`/platform/organizations/${organizationId}/conversion-rate`)
        .set('Authorization', `Bearer ${badToken}`)
        .expect(401);
      await request(server)
        .patch(`/platform/organizations/${organizationId}/conversion-rate`)
        .set('Authorization', `Bearer ${badToken}`)
        .send({ coinsPerReal: 1 })
        .expect(401);
    }
  });
});

describe('Isolamento total — apenas PlatformAdmin acessa /platform/organizations', () => {
  it('token de AdminUser recebe 401 em todas as rotas', async () => {
    // Assina o token direto (não passa por POST /auth/login) — mesmo raciocínio do token de
    // Partner logo abaixo: evita consumir o rate limit de login compartilhado entre todos os
    // specs e2e que rodam serial no mesmo processo Jest. O que este teste prova é a rejeição
    // no guard de platform admin, não o fluxo de login em si.
    const jwtService = app.get(JwtService);
    const accessToken = jwtService.sign({ sub: randomUUID(), organizationId: randomUUID(), role: 'OPERATOR', type: 'admin' });

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
