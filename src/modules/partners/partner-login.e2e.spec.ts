import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { createRedisConnection } from '../../common/redis/redis-connection.factory';

interface TokenPairBody {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

interface ErrorBody {
  code: string;
}

interface PartnerProfileBody {
  id: string;
  name: string;
  category: string;
}

const prisma = new PrismaService();
const rateLimitRedis = createRedisConnection(process.env.REDIS_URL as string);
const createdPartnerIds: string[] = [];

let app: INestApplication;
let server: Server;

/** Mesmo raciocínio de users/login.e2e.spec.ts — só limpa a própria chave de IP, nunca as
 * sintéticas usadas por specs de guard isolados rodando em paralelo. */
async function clearLoginRateLimit(): Promise<void> {
  const keys = await rateLimitRedis.keys('partner-login-rl:ip:*');
  const ownKeys = keys.filter((key) => !key.includes('test-ip-'));
  if (ownKeys.length > 0) {
    await rateLimitRedis.del(...ownKeys);
  }
}

beforeEach(clearLoginRateLimit);

interface PartnerFixture {
  id: string;
  email: string;
  password: string;
}

async function createPartnerFixture(overrides: { withPassword?: boolean } = {}): Promise<PartnerFixture> {
  const suffix = randomUUID();
  const password = 'Test@Password123';
  const email = `partner-login-test-${suffix}@test.coins-api.dev`;

  const partner = await prisma.partner.create({
    data: {
      name: `Login Test Partner ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
      category: 'Teste',
      takeRateBps: 500,
      pixKey: `pix-${suffix}@test.coins-api.dev`,
      contactEmail: email,
      contactPhone: '11988880000',
      passwordHash: overrides.withPassword === false ? null : await hashPassword(password),
    },
  });
  createdPartnerIds.push(partner.id);
  return { id: partner.id, email, password };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  await clearLoginRateLimit();
  rateLimitRedis.disconnect();
  await prisma.partnerRefreshToken.deleteMany({ where: { partnerId: { in: createdPartnerIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: createdPartnerIds } } });
  await prisma.$disconnect();
});

describe('POST /partners/login', () => {
  it('credenciais corretas devolvem um par de tokens', async () => {
    const partner = await createPartnerFixture();

    const response = await request(server)
      .post('/partners/login')
      .send({ email: partner.email, password: partner.password })
      .expect(200);

    const body = response.body as TokenPairBody;
    expect(body.accessToken).toEqual(expect.any(String));
    expect(body.refreshToken).toEqual(expect.any(String));
    expect(body.tokenType).toBe('Bearer');
  });

  it('senha errada retorna 401 INVALID_CREDENTIALS', async () => {
    const partner = await createPartnerFixture();

    const response = await request(server)
      .post('/partners/login')
      .send({ email: partner.email, password: 'senha-errada' })
      .expect(401);
    expect((response.body as ErrorBody).code).toBe('INVALID_CREDENTIALS');
  });

  it('e-mail inexistente retorna 401 INVALID_CREDENTIALS (mesma resposta de senha errada)', async () => {
    const response = await request(server)
      .post('/partners/login')
      .send({ email: 'inexistente@test.coins-api.dev', password: 'qualquer-coisa' })
      .expect(401);
    expect((response.body as ErrorBody).code).toBe('INVALID_CREDENTIALS');
  });

  it('parceiro sem credencial provisionada (passwordHash nulo) retorna 401 INVALID_CREDENTIALS', async () => {
    const partner = await createPartnerFixture({ withPassword: false });

    const response = await request(server)
      .post('/partners/login')
      .send({ email: partner.email, password: 'qualquer-coisa' })
      .expect(401);
    expect((response.body as ErrorBody).code).toBe('INVALID_CREDENTIALS');
  });
});

describe('GET /partners/me', () => {
  it('devolve id/name/category e nunca cnpj/pixKey/takeRateBps/contactEmail/contactPhone', async () => {
    const partner = await createPartnerFixture();
    const loginRes = await request(server)
      .post('/partners/login')
      .send({ email: partner.email, password: partner.password })
      .expect(200);
    const { accessToken } = loginRes.body as TokenPairBody;

    const meRes = await request(server).get('/partners/me').set('Authorization', `Bearer ${accessToken}`).expect(200);

    const body = meRes.body as PartnerProfileBody;
    expect(body.id).toBe(partner.id);
    expect(Object.keys(meRes.body as object).sort()).toEqual(['category', 'id', 'name'].sort());
    expect(meRes.body).not.toHaveProperty('cnpj');
    expect(meRes.body).not.toHaveProperty('pixKey');
    expect(meRes.body).not.toHaveProperty('takeRateBps');
    expect(meRes.body).not.toHaveProperty('contactEmail');
    expect(meRes.body).not.toHaveProperty('contactPhone');
  });

  it('sem token retorna 401', async () => {
    await request(server).get('/partners/me').expect(401);
  });
});

describe('POST /partners/refresh e /partners/logout', () => {
  it('refresh rotaciona o par e o token antigo não pode ser reusado', async () => {
    const partner = await createPartnerFixture();
    const loginRes = await request(server)
      .post('/partners/login')
      .send({ email: partner.email, password: partner.password })
      .expect(200);
    const original = loginRes.body as TokenPairBody;

    const refreshRes = await request(server)
      .post('/partners/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(200);
    const rotated = refreshRes.body as TokenPairBody;
    expect(rotated.refreshToken).not.toBe(original.refreshToken);

    const reuseRes = await request(server)
      .post('/partners/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(401);
    expect((reuseRes.body as ErrorBody).code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('logout revoga o refresh token — reuso depois falha', async () => {
    const partner = await createPartnerFixture();
    const loginRes = await request(server)
      .post('/partners/login')
      .send({ email: partner.email, password: partner.password })
      .expect(200);
    const { refreshToken } = loginRes.body as TokenPairBody;

    await request(server).post('/partners/logout').send({ refreshToken }).expect(204);

    const reuseRes = await request(server).post('/partners/refresh').send({ refreshToken }).expect(401);
    expect((reuseRes.body as ErrorBody).code).toBe('INVALID_REFRESH_TOKEN');
  });
});
