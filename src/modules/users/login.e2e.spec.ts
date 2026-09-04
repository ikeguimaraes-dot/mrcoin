import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { createRedisConnection } from '../../common/redis/redis-connection.factory';
import { hashPassword } from '../auth/password.util';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';

interface LoginResponseBody {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

interface ErrorResponseBody {
  code: string;
  message: string;
}

interface WalletResponseBody {
  cachedBalance: number;
}

const VALID_PASSWORD = 'Xk9$mQ2vL7correto';

const prisma = new PrismaService();
const rateLimitRedis = createRedisConnection(process.env.REDIS_URL as string);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Login Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

async function createUser(overrides: {
  status?: 'ACTIVE' | 'PENDING_CLAIM';
  password?: string;
}): Promise<{ userId: string; cpf: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const passwordHash = overrides.password ? await hashPassword(overrides.password) : undefined;
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Login Test User ${suffix}`,
      email: `login-${suffix}@test.coins-api.dev`,
      status: overrides.status ?? 'ACTIVE',
      passwordHash,
    },
  });
  createdUserIds.push(user.id);
  return { userId: user.id, cpf };
}

/** Mesmo raciocínio de signup.e2e.spec.ts — só limpa a própria chave de IP, nunca as
 * sintéticas (`test-ip-`) usadas por specs de guard isolados rodando em paralelo. */
async function clearLoginRateLimit(): Promise<void> {
  const keys = await rateLimitRedis.keys('user-login-rl:ip:*');
  const ownKeys = keys.filter((key) => !key.includes('test-ip-'));
  if (ownKeys.length > 0) {
    await rateLimitRedis.del(...ownKeys);
  }
}

/** Zera só a janela deslizante do guard (rajada, 60s/5) pra isolar o teste do bloqueio fixo
 * do LoginService (15min/5) — os dois têm o mesmo limite de 5, então sem isso o guard
 * intercepta a 6ª chamada antes de exercitar o lock do service. */
async function clearGuardCpfKey(cpf: string): Promise<void> {
  await rateLimitRedis.del(`user-login-rl:cpf:${hashCpf(cpf)}`);
}

async function clearServiceLock(cpf: string): Promise<void> {
  await rateLimitRedis.del(`login-fail:${hashCpf(cpf)}`);
}

beforeEach(clearLoginRateLimit);

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
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const walletIds = (
    await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } })
  ).map((w) => w.id);
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.userRefreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('POST /users/login', () => {
  it('CPF + senha certos devolvem sessão válida em GET /wallet', async () => {
    const org = await createOrg();
    const { cpf } = await createUser({ password: VALID_PASSWORD });

    const res = await request(server).post('/users/login').send({ cpf, password: VALID_PASSWORD }).expect(200);
    const body = res.body as LoginResponseBody;
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeTruthy();
    expect(body.tokenType).toBe('Bearer');

    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    const membership = await prisma.membership.create({
      data: { userId: user.id, organizationId: org.id, type: 'CUSTOMER' },
    });
    await prisma.wallet.create({ data: { membershipId: membership.id, cachedBalance: 77 } });

    const walletRes = await request(server)
      .get('/wallet')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);
    expect((walletRes.body as WalletResponseBody).cachedBalance).toBe(77);
  });

  it('CPF inexistente, CPF sem senha e senha errada devolvem a MESMA resposta — não vaza o motivo', async () => {
    const { cpf: cpfWithPassword } = await createUser({ password: VALID_PASSWORD });
    const { cpf: cpfNoPassword } = await createUser({});
    const unknownCpf = randomCpf();

    const wrongPassword = await request(server)
      .post('/users/login')
      .send({ cpf: cpfWithPassword, password: 'senha-completamente-errada' })
      .expect(401);
    const noPassword = await request(server)
      .post('/users/login')
      .send({ cpf: cpfNoPassword, password: VALID_PASSWORD })
      .expect(401);
    const unknown = await request(server).post('/users/login').send({ cpf: unknownCpf, password: VALID_PASSWORD }).expect(401);

    const expected = { code: 'INVALID_CREDENTIALS', message: 'CPF ou senha inválidos.' };
    expect(wrongPassword.body).toEqual(expected);
    expect(noPassword.body).toEqual(expected);
    expect(unknown.body).toEqual(expected);
  });

  it('conta PENDING_CLAIM devolve o mesmo INVALID_CREDENTIALS — claim se prova pelo cadastro, não pelo login', async () => {
    const { cpf } = await createUser({ status: 'PENDING_CLAIM', password: VALID_PASSWORD });

    const res = await request(server).post('/users/login').send({ cpf, password: VALID_PASSWORD }).expect(401);
    expect((res.body as ErrorResponseBody).code).toBe('INVALID_CREDENTIALS');
  });

  it('5 tentativas erradas travam a conta por 15min — nem a senha certa passa depois', async () => {
    const { cpf } = await createUser({ password: VALID_PASSWORD });

    for (let i = 0; i < 4; i += 1) {
      const res = await request(server).post('/users/login').send({ cpf, password: 'errada' }).expect(401);
      expect((res.body as ErrorResponseBody).code).toBe('INVALID_CREDENTIALS');
    }

    const fifth = await request(server).post('/users/login').send({ cpf, password: 'errada' }).expect(429);
    expect((fifth.body as ErrorResponseBody).code).toBe('LOGIN_LOCKED');

    // O guard conta por IP e por CPF — limpa as duas janelas pra isolar só o lock fixo do
    // service (senão o guard bloqueia a 6ª chamada primeiro, mascarando o que queremos testar).
    await clearGuardCpfKey(cpf);
    await clearLoginRateLimit();
    const sixth = await request(server).post('/users/login').send({ cpf, password: VALID_PASSWORD }).expect(429);
    expect((sixth.body as ErrorResponseBody).code).toBe('LOGIN_LOCKED');

    await clearServiceLock(cpf);
  });

  it('o mesmo bloqueio de 5 tentativas se aplica a um CPF totalmente inventado', async () => {
    const unknownCpf = randomCpf();

    for (let i = 0; i < 4; i += 1) {
      await request(server).post('/users/login').send({ cpf: unknownCpf, password: 'qualquer-coisa' }).expect(401);
    }

    const fifth = await request(server).post('/users/login').send({ cpf: unknownCpf, password: 'qualquer-coisa' }).expect(429);
    expect((fifth.body as ErrorResponseBody).code).toBe('LOGIN_LOCKED');

    await clearServiceLock(unknownCpf);
  });

  it('login bem-sucedido reseta o contador de falhas', async () => {
    const { cpf } = await createUser({ password: VALID_PASSWORD });

    await request(server).post('/users/login').send({ cpf, password: 'errada' }).expect(401);
    await request(server).post('/users/login').send({ cpf, password: 'errada' }).expect(401);
    await request(server).post('/users/login').send({ cpf, password: VALID_PASSWORD }).expect(200);

    const remaining = await rateLimitRedis.get(`login-fail:${hashCpf(cpf)}`);
    expect(remaining).toBeNull();
  });

  it('POST /users/login/verify não existe mais', async () => {
    await request(server).post('/users/login/verify').send({ cpf: randomCpf(), code: '123456' }).expect(404);
  });
});
