import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EMAIL_PORT, EmailPort, SendEmailParams } from '../../common/email/email.port';
import { createRedisConnection } from '../../common/redis/redis-connection.factory';

interface RequestOtpResponseBody {
  expiresAt: string;
}

interface VerifyResponseBody {
  accessToken: string;
  expiresIn: number;
}

interface ErrorResponseBody {
  code: string;
}

interface WalletResponseBody {
  cachedBalance: number;
}

const prisma = new PrismaService();
const rateLimitRedis = createRedisConnection(process.env.REDIS_URL as string);
const capturedEmails: SendEmailParams[] = [];
const fakeEmailPort: EmailPort = {
  send: (params) => {
    capturedEmails.push(params);
    return Promise.resolve();
  },
};

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
  return organization;
}

async function createActiveUser(email: string | null): Promise<{ userId: string; cpf: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Login Test User ${suffix}`,
      email: email ?? undefined,
      status: 'ACTIVE',
    },
  });
  createdUserIds.push(user.id);
  return { userId: user.id, cpf };
}

function extractCode(email: string): string {
  const sent = [...capturedEmails].reverse().find((entry) => entry.to === email);
  const match = sent?.text.match(/\d{6}/);
  if (!match) {
    throw new Error(`Nenhum código OTP capturado pra ${email}`);
  }
  return match[0];
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

beforeEach(clearLoginRateLimit);

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_PORT)
    .useValue(fakeEmailPort)
    .compile();
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
  await prisma.userLoginRequest.deleteMany({
    where: { cpfHash: { in: createdUserIds.length > 0 ? await cpfHashesOf(createdUserIds) : [] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

async function cpfHashesOf(userIds: string[]): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { cpfHash: true } });
  return users.map((u) => u.cpfHash);
}

describe('Fluxo completo de login', () => {
  it('request OTP -> verify devolve sessão válida em GET /wallet, sem organizationId no fluxo', async () => {
    const org = await createOrg();
    const email = `login-${randomUUID()}@test.coins-api.dev`;
    const { cpf } = await createActiveUser(email);

    const requestRes = await request(server).post('/users/login').send({ cpf }).expect(200);
    expect((requestRes.body as RequestOtpResponseBody).expiresAt).toBeDefined();

    const code = extractCode(email);
    const verifyRes = await request(server).post('/users/login/verify').send({ cpf, code }).expect(200);

    const verifyBody = verifyRes.body as VerifyResponseBody;
    expect(verifyBody.accessToken).toBeTruthy();

    // Sessão emitida por login serve pro mesmo /wallet que a de signup — mesmo type:user.
    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    const membership = await prisma.membership.create({
      data: { userId: user.id, organizationId: org.id, type: 'CUSTOMER' },
    });
    await prisma.wallet.create({ data: { membershipId: membership.id, cachedBalance: 77 } });

    const walletRes = await request(server)
      .get('/wallet')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${verifyBody.accessToken}`)
      .expect(200);
    expect((walletRes.body as WalletResponseBody).cachedBalance).toBe(77);
  });

  it('CPF sem conta e CPF PENDING_CLAIM devolvem o MESMO erro ACCOUNT_NOT_FOUND — não vaza se o CPF existe', async () => {
    const unknownCpf = randomCpf();
    const unknownResponse = await request(server).post('/users/login').send({ cpf: unknownCpf }).expect(404);
    expect((unknownResponse.body as ErrorResponseBody).code).toBe('ACCOUNT_NOT_FOUND');

    const pendingCpf = randomCpf();
    const pendingUser = await prisma.user.create({
      data: {
        cpfEncrypted: encryptCpf(pendingCpf),
        cpfHash: hashCpf(pendingCpf),
        name: 'Pendente de Claim',
        status: 'PENDING_CLAIM',
      },
    });
    createdUserIds.push(pendingUser.id);

    const pendingResponse = await request(server).post('/users/login').send({ cpf: pendingCpf }).expect(404);
    expect((pendingResponse.body as ErrorResponseBody).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('conta ACTIVE sem e-mail cadastrado retorna NO_VERIFIED_CONTACT', async () => {
    const { cpf } = await createActiveUser(null);

    const response = await request(server).post('/users/login').send({ cpf }).expect(409);
    expect((response.body as ErrorResponseBody).code).toBe('NO_VERIFIED_CONTACT');
  });
});

describe('Verificação de OTP de login — casos de erro', () => {
  it('código errado incrementa attempts e falha com OTP_INVALID', async () => {
    const email = `wrong-login-${randomUUID()}@test.coins-api.dev`;
    const { cpf } = await createActiveUser(email);

    await request(server).post('/users/login').send({ cpf }).expect(200);

    const response = await request(server).post('/users/login/verify').send({ cpf, code: '000000' }).expect(401);
    expect((response.body as ErrorResponseBody).code).toBe('OTP_INVALID');
  });

  it('5ª tentativa errada vira OTP_TOO_MANY_ATTEMPTS', async () => {
    const email = `bruteforce-login-${randomUUID()}@test.coins-api.dev`;
    const { cpf } = await createActiveUser(email);

    await request(server).post('/users/login').send({ cpf }).expect(200);

    for (let i = 0; i < 4; i += 1) {
      await request(server).post('/users/login/verify').send({ cpf, code: '000000' }).expect(401);
    }

    const response = await request(server).post('/users/login/verify').send({ cpf, code: '000000' }).expect(429);
    expect((response.body as ErrorResponseBody).code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('código expirado retorna OTP_EXPIRED', async () => {
    const email = `expired-login-${randomUUID()}@test.coins-api.dev`;
    const { cpf } = await createActiveUser(email);

    await request(server).post('/users/login').send({ cpf }).expect(200);
    const code = extractCode(email);

    await prisma.userLoginRequest.updateMany({
      where: { cpfHash: hashCpf(cpf) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await request(server).post('/users/login/verify').send({ cpf, code }).expect(400);
    expect((response.body as ErrorResponseBody).code).toBe('OTP_EXPIRED');
  });

  it('sem pedido de OTP pendente retorna OTP_NOT_FOUND', async () => {
    const { cpf } = await createActiveUser(`no-request-${randomUUID()}@test.coins-api.dev`);

    const response = await request(server)
      .post('/users/login/verify')
      .send({ cpf, code: '123456' })
      .expect(404);
    expect((response.body as ErrorResponseBody).code).toBe('OTP_NOT_FOUND');
  });
});
