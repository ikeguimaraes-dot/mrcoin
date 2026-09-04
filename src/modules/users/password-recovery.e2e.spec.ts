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
import { hashPassword } from '../auth/password.util';

interface RequestOtpResponseBody {
  expiresAt: string;
}

interface ConfirmResponseBody {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
}

interface ErrorResponseBody {
  code: string;
}

const VALID_PASSWORD = 'Xk9$mQ2vL7correto';

const prisma = new PrismaService();
const rateLimitRedis = createRedisConnection(process.env.REDIS_URL as string);
const capturedEmails: SendEmailParams[] = [];
const fakeEmailPort: EmailPort = {
  send: (params) => {
    capturedEmails.push(params);
    return Promise.resolve();
  },
};

const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createUser(overrides: {
  status?: 'ACTIVE' | 'PENDING_CLAIM';
  email?: string | null;
  password?: string;
}): Promise<{ userId: string; cpf: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const email = overrides.email === null ? undefined : (overrides.email ?? `recovery-${suffix}@test.coins-api.dev`);
  const passwordHash = overrides.password ? await hashPassword(overrides.password) : undefined;
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Recovery Test User ${suffix}`,
      email,
      status: overrides.status ?? 'ACTIVE',
      passwordHash,
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

async function emailOf(cpf: string): Promise<string> {
  const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
  return user.email as string;
}

/** Mesmo guard (UserLoginRateLimitGuard) é reaproveitado no login e na recuperação — mesma
 * chave de IP, mesmo raciocínio de limpeza do login.e2e.spec.ts. */
async function clearRateLimit(): Promise<void> {
  const keys = await rateLimitRedis.keys('user-login-rl:ip:*');
  const ownKeys = keys.filter((key) => !key.includes('test-ip-'));
  if (ownKeys.length > 0) {
    await rateLimitRedis.del(...ownKeys);
  }
}

beforeEach(clearRateLimit);

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
  await clearRateLimit();
  rateLimitRedis.disconnect();
  await prisma.userRefreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  const users = await prisma.user.findMany({ where: { id: { in: createdUserIds } }, select: { cpfHash: true } });
  await prisma.userPasswordResetRequest.deleteMany({ where: { cpfHash: { in: users.map((u) => u.cpfHash) } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('POST /users/password/recovery', () => {
  it('conta ACTIVE com e-mail devolve expiresAt e manda o código', async () => {
    const { cpf } = await createUser({ password: VALID_PASSWORD });
    const email = await emailOf(cpf);

    const res = await request(server).post('/users/password/recovery').send({ cpf }).expect(200);
    expect((res.body as RequestOtpResponseBody).expiresAt).toBeDefined();
    expect(extractCode(email)).toMatch(/^\d{6}$/);
  });

  it('CPF inexistente e CPF PENDING_CLAIM devolvem o mesmo ACCOUNT_NOT_FOUND', async () => {
    const unknownRes = await request(server).post('/users/password/recovery').send({ cpf: randomCpf() }).expect(404);
    expect((unknownRes.body as ErrorResponseBody).code).toBe('ACCOUNT_NOT_FOUND');

    const { cpf: pendingCpf } = await createUser({ status: 'PENDING_CLAIM' });
    const pendingRes = await request(server).post('/users/password/recovery').send({ cpf: pendingCpf }).expect(404);
    expect((pendingRes.body as ErrorResponseBody).code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('conta ACTIVE sem e-mail cadastrado retorna NO_VERIFIED_CONTACT', async () => {
    const { cpf } = await createUser({ email: null });

    const res = await request(server).post('/users/password/recovery').send({ cpf }).expect(409);
    expect((res.body as ErrorResponseBody).code).toBe('NO_VERIFIED_CONTACT');
  });
});

describe('POST /users/password/recovery/confirm', () => {
  it('código certo + senha nova define passwordHash e já devolve sessão — a senha nova funciona no login em seguida', async () => {
    const { cpf } = await createUser({ password: 'senha-antiga-qualquer' });
    const email = await emailOf(cpf);

    await request(server).post('/users/password/recovery').send({ cpf }).expect(200);
    const code = extractCode(email);

    const confirmRes = await request(server)
      .post('/users/password/recovery/confirm')
      .send({ cpf, code, newPassword: VALID_PASSWORD })
      .expect(200);
    const body = confirmRes.body as ConfirmResponseBody;
    expect(body.accessToken).toBeTruthy();
    expect(body.tokenType).toBe('Bearer');

    await request(server).post('/users/login').send({ cpf, password: VALID_PASSWORD }).expect(200);
  });

  it('usuário legado sem senha nenhuma (passwordHash null) usa o MESMO endpoint, sem caso especial', async () => {
    const { cpf } = await createUser({}); // sem password — nunca teve senha
    const email = await emailOf(cpf);

    const before = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    expect(before.passwordHash).toBeNull();

    await request(server).post('/users/password/recovery').send({ cpf }).expect(200);
    const code = extractCode(email);

    await request(server)
      .post('/users/password/recovery/confirm')
      .send({ cpf, code, newPassword: VALID_PASSWORD })
      .expect(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    expect(after.passwordHash).not.toBeNull();

    await request(server).post('/users/login').send({ cpf, password: VALID_PASSWORD }).expect(200);
  });

  it('código errado incrementa attempts e falha com OTP_INVALID', async () => {
    const { cpf } = await createUser({ password: VALID_PASSWORD });
    await request(server).post('/users/password/recovery').send({ cpf }).expect(200);

    const res = await request(server)
      .post('/users/password/recovery/confirm')
      .send({ cpf, code: '000000', newPassword: VALID_PASSWORD })
      .expect(401);
    expect((res.body as ErrorResponseBody).code).toBe('OTP_INVALID');
  });

  it('5ª tentativa errada vira OTP_TOO_MANY_ATTEMPTS', async () => {
    const { cpf } = await createUser({ password: VALID_PASSWORD });
    await request(server).post('/users/password/recovery').send({ cpf }).expect(200);

    for (let i = 0; i < 4; i += 1) {
      await request(server)
        .post('/users/password/recovery/confirm')
        .send({ cpf, code: '000000', newPassword: VALID_PASSWORD })
        .expect(401);
    }

    const res = await request(server)
      .post('/users/password/recovery/confirm')
      .send({ cpf, code: '000000', newPassword: VALID_PASSWORD })
      .expect(429);
    expect((res.body as ErrorResponseBody).code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('código expirado retorna OTP_EXPIRED', async () => {
    const { cpf } = await createUser({ password: VALID_PASSWORD });
    const email = await emailOf(cpf);

    await request(server).post('/users/password/recovery').send({ cpf }).expect(200);
    const code = extractCode(email);

    await prisma.userPasswordResetRequest.updateMany({
      where: { cpfHash: hashCpf(cpf) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(server)
      .post('/users/password/recovery/confirm')
      .send({ cpf, code, newPassword: VALID_PASSWORD })
      .expect(400);
    expect((res.body as ErrorResponseBody).code).toBe('OTP_EXPIRED');
  });

  it('sem pedido de recuperação pendente retorna OTP_NOT_FOUND', async () => {
    const { cpf } = await createUser({ password: VALID_PASSWORD });

    const res = await request(server)
      .post('/users/password/recovery/confirm')
      .send({ cpf, code: '123456', newPassword: VALID_PASSWORD })
      .expect(404);
    expect((res.body as ErrorResponseBody).code).toBe('OTP_NOT_FOUND');
  });

  it('newPassword fraca, comum ou contendo o CPF retorna 400 — nenhuma altera o passwordHash', async () => {
    const { cpf } = await createUser({ password: 'senha-original-boa' });
    const email = await emailOf(cpf);
    const before = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });

    await request(server).post('/users/password/recovery').send({ cpf }).expect(200);
    const code = extractCode(email);

    await request(server).post('/users/password/recovery/confirm').send({ cpf, code, newPassword: 'curta1' }).expect(400);
    await request(server)
      .post('/users/password/recovery/confirm')
      .send({ cpf, code, newPassword: 'password123' })
      .expect(400);
    await request(server)
      .post('/users/password/recovery/confirm')
      .send({ cpf, code, newPassword: `senha-com-${cpf}-dentro` })
      .expect(400);

    const after = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    expect(after.passwordHash).toBe(before.passwordHash);
  });
});
