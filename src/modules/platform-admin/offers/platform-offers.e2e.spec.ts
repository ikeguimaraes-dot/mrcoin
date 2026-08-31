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

interface OfferSummaryBody {
  id: string;
  partnerId: string;
  title: string;
  costInCoins: number;
  imageUrl: string | null;
  status: string;
  partner: { id: string; name: string };
}

const prisma = new PrismaService();
const createdOfferIds: string[] = [];
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

async function createPlatformAdminFixture(): Promise<{ platformAdminId: string; token: string }> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `E2E Platform Offers Admin ${suffix}`,
      email: `e2e-platform-offers-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  const token = platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
  return { platformAdminId: platformAdmin.id, token };
}

async function createPartnerFixture(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const partner = await prisma.partner.create({
    data: {
      name: `E2E Platform Offers Partner ${suffix}`,
      cnpj: fixtureCnpj(),
      category: 'Teste',
      takeRateBps: 500,
      pixKey: `pix-${suffix}@test.coins-api.dev`,
    },
  });
  createdPartnerIds.push(partner.id);
  return { id: partner.id };
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
  await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
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

describe('Fluxo feliz — POST/GET/PATCH /platform/offers', () => {
  it('cria oferta, lista (com filtro partnerId), mostra detalhe e atualiza', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();
    const partner = await createPartnerFixture();
    const otherPartner = await createPartnerFixture();

    const suffix = randomUUID();
    const createResponse = await request(server)
      .post('/platform/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        partnerId: partner.id,
        title: `Oferta E2E ${suffix}`,
        description: 'Descrição de teste',
        category: 'Comida',
        costInCoins: 100,
        imageUrl: 'https://example.com/imagem.png',
      })
      .expect(201);
    const created = createResponse.body as OfferSummaryBody;
    createdOfferIds.push(created.id);

    expect(created.status).toBe('ACTIVE');
    expect(created.partner.id).toBe(partner.id);
    expect(created.imageUrl).toBe('https://example.com/imagem.png');

    // outra oferta de outro parceiro, pra validar o filtro
    const otherOfferResponse = await request(server)
      .post('/platform/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        partnerId: otherPartner.id,
        title: `Oferta Outro Parceiro ${suffix}`,
        description: 'Descrição de teste',
        category: 'Comida',
        costInCoins: 50,
      })
      .expect(201);
    createdOfferIds.push((otherOfferResponse.body as OfferSummaryBody).id);

    const listResponse = await request(server)
      .get(`/platform/offers?partnerId=${partner.id}&limit=100`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const listBody = listResponse.body as { items: OfferSummaryBody[] };
    expect(listBody.items.every((item) => item.partnerId === partner.id)).toBe(true);
    expect(listBody.items.some((item) => item.id === created.id)).toBe(true);

    const detailResponse = await request(server)
      .get(`/platform/offers/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detailResponse.body as { id: string }).id).toBe(created.id);

    const patchResponse = await request(server)
      .patch(`/platform/offers/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ costInCoins: 200, status: 'INACTIVE', imageUrl: null })
      .expect(200);
    const patched = patchResponse.body as OfferSummaryBody;
    expect(patched.costInCoins).toBe(200);
    expect(patched.status).toBe('INACTIVE');
    expect(patched.imageUrl).toBeNull();

    const createLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'OFFER_CREATED' },
    });
    expect(createLog).not.toBeNull();
    const updateLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'OFFER_UPDATED' },
    });
    expect(updateLog).not.toBeNull();
  });

  it('partnerId inexistente no create retorna 404', async () => {
    const { token } = await createPlatformAdminFixture();

    await request(server)
      .post('/platform/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        partnerId: randomUUID(),
        title: 'Oferta Órfã',
        description: 'Descrição',
        category: 'Comida',
        costInCoins: 100,
      })
      .expect(404);
  });

  it('imageUrl inválida retorna 400', async () => {
    const { token } = await createPlatformAdminFixture();
    const partner = await createPartnerFixture();

    await request(server)
      .post('/platform/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        partnerId: partner.id,
        title: 'Oferta Imagem Inválida',
        description: 'Descrição',
        category: 'Comida',
        costInCoins: 100,
        imageUrl: 'not-a-url',
      })
      .expect(400);
  });

  it('costInCoins zero ou negativo retorna 400', async () => {
    const { token } = await createPlatformAdminFixture();
    const partner = await createPartnerFixture();

    await request(server)
      .post('/platform/offers')
      .set('Authorization', `Bearer ${token}`)
      .send({
        partnerId: partner.id,
        title: 'Oferta Custo Inválido',
        description: 'Descrição',
        category: 'Comida',
        costInCoins: 0,
      })
      .expect(400);
  });
});

describe('Isolamento total — apenas PlatformAdmin acessa /platform/offers', () => {
  it('token de AdminUser recebe 401 em todas as rotas', async () => {
    // Assina o token direto (não passa por POST /auth/login) — mesmo raciocínio do token de
    // Partner logo abaixo: evita consumir o rate limit de login compartilhado entre todos os
    // specs e2e que rodam serial no mesmo processo Jest.
    const jwtService = app.get(JwtService);
    const accessToken = jwtService.sign({ sub: randomUUID(), organizationId: randomUUID(), role: 'OPERATOR', type: 'admin' });

    await request(server).get('/platform/offers').set('Authorization', `Bearer ${accessToken}`).expect(401);
    await request(server)
      .post('/platform/offers')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ partnerId: randomUUID(), title: 'X', description: 'X', category: 'X', costInCoins: 10 })
      .expect(401);
  });

  it('token de Partner recebe 401 em todas as rotas', async () => {
    const jwtService = app.get(JwtService);
    const partnerToken = jwtService.sign({ sub: randomUUID(), type: 'partner' });

    await request(server).get('/platform/offers').set('Authorization', `Bearer ${partnerToken}`).expect(401);
    await request(server)
      .post('/platform/offers')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send({ partnerId: randomUUID(), title: 'X', description: 'X', category: 'X', costInCoins: 10 })
      .expect(401);
  });
});
