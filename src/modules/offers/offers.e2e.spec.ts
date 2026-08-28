import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PartnerStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';

interface OfferCatalogBody {
  id: string;
  title: string;
  description: string;
  category: string;
  costInCoins: number;
  imageUrl: string | null;
  validFrom: string | null;
  validUntil: string | null;
  perUserLimit: number | null;
  partner: { id: string; name: string; category: string };
}

interface ListResponseBody<T> {
  items: T[];
  nextCursor: string | null;
}

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

const createdPartnerIds: string[] = [];
const createdOfferIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

async function createPartner(status: PartnerStatus = 'ACTIVE'): Promise<{ id: string; name: string }> {
  const suffix = randomUUID();
  const partner = await prisma.partner.create({
    data: {
      name: `Offer Test Partner ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
      category: 'Teste',
      takeRateBps: 500,
      pixKey: `pix-${suffix}@test.coins-api.dev`,
      status,
    },
  });
  createdPartnerIds.push(partner.id);
  return { id: partner.id, name: partner.name };
}

async function createOffer(
  partnerId: string,
  overrides: Partial<{
    status: 'ACTIVE' | 'INACTIVE';
    validFrom: Date | null;
    validUntil: Date | null;
    costInCoins: number;
    perUserLimit: number | null;
    imageUrl: string | null;
  }> = {},
): Promise<{ id: string; title: string }> {
  const suffix = randomUUID();
  const offer = await prisma.offer.create({
    data: {
      partnerId,
      title: `Offer Test ${suffix}`,
      description: `Offer Test ${suffix}`,
      category: 'Teste',
      costInCoins: overrides.costInCoins ?? 100,
      imageUrl: overrides.imageUrl,
      validFrom: overrides.validFrom,
      validUntil: overrides.validUntil,
      perUserLimit: overrides.perUserLimit,
      status: overrides.status ?? 'ACTIVE',
    },
  });
  createdOfferIds.push(offer.id);
  return { id: offer.id, title: offer.title };
}

async function createUserToken(): Promise<string> {
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { cpfEncrypted: `enc-${suffix}`, cpfHash: `hash-${suffix}`, name: `Offer Test User ${suffix}` },
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
  await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: createdPartnerIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('GET /offers (catálogo do app) — filtro em duas camadas', () => {
  it('oferta ACTIVE de parceiro ACTIVE aparece, com custo em coins, imagem e partner embutido', async () => {
    const partner = await createPartner('ACTIVE');
    const offer = await createOffer(partner.id, {
      costInCoins: 250,
      imageUrl: 'https://picsum.photos/seed/offer-test/600/400',
    });
    const token = await createUserToken();

    const response = await request(server)
      .get('/offers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<OfferCatalogBody>;
    const found = body.items.find((o) => o.id === offer.id);
    expect(found).toBeDefined();
    expect(found?.costInCoins).toBe(250);
    expect(found?.imageUrl).toBe('https://picsum.photos/seed/offer-test/600/400');
    expect(found?.partner).toEqual({ id: partner.id, name: partner.name, category: 'Teste' });
  });

  it('oferta sem imageUrl devolve null (imagem é opcional)', async () => {
    const partner = await createPartner('ACTIVE');
    const offer = await createOffer(partner.id);
    const token = await createUserToken();

    const response = await request(server)
      .get('/offers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<OfferCatalogBody>;
    const found = body.items.find((o) => o.id === offer.id);
    expect(found?.imageUrl).toBeNull();
  });

  it('oferta ACTIVE de parceiro INACTIVE NÃO aparece', async () => {
    const partner = await createPartner('INACTIVE');
    const offer = await createOffer(partner.id);
    const token = await createUserToken();

    const response = await request(server)
      .get('/offers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<OfferCatalogBody>;
    expect(body.items.map((o) => o.id)).not.toContain(offer.id);
  });

  it('oferta INACTIVE de parceiro ACTIVE NÃO aparece', async () => {
    const partner = await createPartner('ACTIVE');
    const offer = await createOffer(partner.id, { status: 'INACTIVE' });
    const token = await createUserToken();

    const response = await request(server)
      .get('/offers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<OfferCatalogBody>;
    expect(body.items.map((o) => o.id)).not.toContain(offer.id);
  });

  it('oferta com validUntil no passado NÃO aparece, mesmo ACTIVE', async () => {
    const partner = await createPartner('ACTIVE');
    const offer = await createOffer(partner.id, { validUntil: new Date(Date.now() - 1000 * 60 * 60 * 24) });
    const token = await createUserToken();

    const response = await request(server)
      .get('/offers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<OfferCatalogBody>;
    expect(body.items.map((o) => o.id)).not.toContain(offer.id);
  });

  it('oferta com validFrom no futuro NÃO aparece ainda', async () => {
    const partner = await createPartner('ACTIVE');
    const offer = await createOffer(partner.id, { validFrom: new Date(Date.now() + 1000 * 60 * 60 * 24) });
    const token = await createUserToken();

    const response = await request(server)
      .get('/offers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<OfferCatalogBody>;
    expect(body.items.map((o) => o.id)).not.toContain(offer.id);
  });

  it('oferta sem validFrom/validUntil (nulos) aparece — sem restrição de janela', async () => {
    const partner = await createPartner('ACTIVE');
    const offer = await createOffer(partner.id, { validFrom: null, validUntil: null });
    const token = await createUserToken();

    const response = await request(server)
      .get('/offers')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<OfferCatalogBody>;
    expect(body.items.map((o) => o.id)).toContain(offer.id);
  });

  it('?partnerId= filtra só as ofertas daquele parceiro', async () => {
    const partnerA = await createPartner('ACTIVE');
    const partnerB = await createPartner('ACTIVE');
    const offerA = await createOffer(partnerA.id);
    const offerB = await createOffer(partnerB.id);
    const token = await createUserToken();

    const response = await request(server)
      .get('/offers')
      .query({ partnerId: partnerA.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as ListResponseBody<OfferCatalogBody>;
    const ids = body.items.map((o) => o.id);
    expect(ids).toContain(offerA.id);
    expect(ids).not.toContain(offerB.id);
  });

  it('sem token retorna 401', async () => {
    await request(server).get('/offers').expect(401);
  });
});

describe('GET /offers/:id', () => {
  it('oferta fora da disponibilidade retorna 404', async () => {
    const partner = await createPartner('INACTIVE');
    const offer = await createOffer(partner.id);
    const token = await createUserToken();

    await request(server)
      .get(`/offers/${offer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('oferta disponível devolve o shape do catálogo', async () => {
    const partner = await createPartner('ACTIVE');
    const offer = await createOffer(partner.id, { perUserLimit: 3 });
    const token = await createUserToken();

    const response = await request(server)
      .get(`/offers/${offer.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as OfferCatalogBody;
    expect(body.perUserLimit).toBe(3);
    expect(Object.keys(response.body as object).sort()).toEqual(
      [
        'category',
        'costInCoins',
        'description',
        'id',
        'imageUrl',
        'partner',
        'perUserLimit',
        'title',
        'validFrom',
        'validUntil',
      ].sort(),
    );
  });
});
