import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptCpf, encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EMAIL_PORT, EmailPort, SendEmailParams } from '../../common/email/email.port';
import { createRedisConnection } from '../../common/redis/redis-connection.factory';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { SignupService } from './signup.service';

interface RequestOtpResponseBody {
  expiresAt: string;
}

interface VerifyResponseBody {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

interface ErrorResponseBody {
  code: string;
}

interface WalletResponseBody {
  cachedBalance: number;
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
    data: { name: `Signup Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

/** Cria o estado que uma distribuição deixaria pra trás: User PENDING_CLAIM + Membership
 * (sem contato verificado nenhum) — é o único jeito de um CPF chegar elegível pro claim. */
async function createPendingClaim(
  organizationId: string,
  overrides: Partial<{ membershipType: 'CUSTOMER' | 'EMPLOYEE'; externalRef: string; walletBalance: number }> = {},
): Promise<{ cpf: string; userId: string; membershipId: string; walletId: string }> {
  const cpf = randomCpf();
  const cpfHash = hashCpf(cpf);
  const suffix = randomUUID();

  const pendingUser = await prisma.user.create({
    data: { cpfEncrypted: encryptCpf(cpf), cpfHash, name: `Criado por Distribuição ${suffix}`, status: 'PENDING_CLAIM' },
  });
  createdUserIds.push(pendingUser.id);

  const membership = await prisma.membership.create({
    data: {
      userId: pendingUser.id,
      organizationId,
      type: overrides.membershipType ?? 'CUSTOMER',
      externalRef: overrides.externalRef,
    },
  });
  const wallet = await prisma.wallet.create({
    data: { membershipId: membership.id, cachedBalance: overrides.walletBalance ?? 0 },
  });

  return { cpf, userId: pendingUser.id, membershipId: membership.id, walletId: wallet.id };
}

function extractCode(email: string): string {
  const sent = [...capturedEmails].reverse().find((entry) => entry.to === email);
  const match = sent?.text.match(/\d{6}/);
  if (!match) {
    throw new Error(`Nenhum código OTP capturado pra ${email}`);
  }
  return match[0];
}

/**
 * Todos os POST /users/signup deste arquivo saem do mesmo IP de loopback (supertest
 * in-process) — sem isso, o SignupRateLimitGuard real (Redis) bloquearia os testes depois
 * do 5º signup no arquivo. Os testes aqui validam a lógica de signup, não o rate limit em
 * si (isso é coberto isoladamente em signup-rate-limit.guard.spec.ts).
 *
 * Importante: só limpa a chave de IP (nunca `signup-rl:cpf:*`, que não precisa — cada teste
 * usa um CPF aleatório próprio) e exclui explicitamente qualquer chave com `test-ip-`, o
 * prefixo sintético usado por `signup-rate-limit.guard.spec.ts`. Sem essa exclusão, como os
 * arquivos de teste rodam em processos paralelos do Jest contra o mesmo Redis real, um
 * `beforeEach` aqui rodando no meio do loop de tentativas daquele outro arquivo apagaria os
 * contadores dele e quebraria a asserção de rate limit — não é hipotético, já aconteceu.
 */
async function clearSignupRateLimit(): Promise<void> {
  const keys = await rateLimitRedis.keys('signup-rl:ip:*');
  const ownKeys = keys.filter((key) => !key.includes('test-ip-'));
  if (ownKeys.length > 0) {
    await rateLimitRedis.del(...ownKeys);
  }
}

beforeEach(clearSignupRateLimit);

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
  await clearSignupRateLimit();
  rateLimitRedis.disconnect();
  await prisma.device.deleteMany({ where: { userId: { in: createdUserIds } } });
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const walletIds = (
    await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } })
  ).map((w) => w.id);
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  const cpfHashes = createdUserIds.length > 0 ? await cpfHashesOf(createdUserIds) : [];
  await prisma.userSignupRequest.deleteMany({ where: { cpfHash: { in: cpfHashes } } });
  await prisma.userRefreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

async function cpfHashesOf(userIds: string[]): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { cpfHash: true } });
  return users.map((u) => u.cpfHash);
}

describe('Fluxo completo de signup (claim)', () => {
  it('request OTP -> verify promove PENDING_CLAIM pra ACTIVE e retorna sessão válida em GET /wallet', async () => {
    const org = await createOrg();
    const { cpf, membershipId } = await createPendingClaim(org.id);
    const email = `signup-${randomUUID()}@test.coins-api.dev`;

    const requestRes = await request(server)
      .post('/users/signup')
      .send({ cpf, name: 'Fulano de Tal', email })
      .expect(200);

    expect((requestRes.body as RequestOtpResponseBody).expiresAt).toBeDefined();

    const code = extractCode(email);

    const verifyRes = await request(server).post('/users/signup/verify').send({ cpf, code, password: VALID_PASSWORD }).expect(200);

    const verifyBody = verifyRes.body as VerifyResponseBody;
    expect(verifyBody.accessToken).toBeTruthy();
    expect(verifyBody.refreshToken).toBeTruthy();
    expect(verifyBody.tokenType).toBe('Bearer');

    const user = await prisma.user.findUniqueOrThrow({ where: { cpfHash: hashCpf(cpf) } });
    expect(decryptCpf(user.cpfEncrypted)).toBe(cpf);
    expect(user.email).toBe(email);
    expect(user.status).toBe('ACTIVE');

    const membership = await prisma.membership.findUniqueOrThrow({ where: { id: membershipId } });
    expect(membership.type).toBe('CUSTOMER');

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { membershipId: membership.id } });
    expect(wallet.cachedBalance).toBe(0);

    const walletRes = await request(server)
      .get('/wallet')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${verifyBody.accessToken}`)
      .expect(200);

    expect((walletRes.body as WalletResponseBody).cachedBalance).toBe(0);
  });
});

describe('Claim de conta PENDING_CLAIM (criada por distribuição, sem contato verificado)', () => {
  it('reivindica com o próprio e-mail, promove pra ACTIVE e preserva Membership/Wallet/saldo já creditado', async () => {
    const org = await createOrg();
    const { cpf, userId, membershipId, walletId } = await createPendingClaim(org.id, {
      membershipType: 'EMPLOYEE',
      externalRef: 'EMP-1',
      walletBalance: 300,
    });

    const claimEmail = `claim-${randomUUID()}@test.coins-api.dev`;
    const emailsBefore = capturedEmails.length;

    await request(server)
      .post('/users/signup')
      .send({ cpf, name: 'Nome Escolhido No Claim', email: claimEmail })
      .expect(200);

    const sentAfterRequest = capturedEmails.slice(emailsBefore);
    expect(sentAfterRequest.some((e) => e.to === claimEmail)).toBe(true);

    const code = extractCode(claimEmail);
    const verifyRes = await request(server).post('/users/signup/verify').send({ cpf, code, password: VALID_PASSWORD }).expect(200);

    const verifyBody = verifyRes.body as VerifyResponseBody;
    expect(verifyBody.accessToken).toBeTruthy();

    const promotedUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(promotedUser.status).toBe('ACTIVE');
    expect(promotedUser.email).toBe(claimEmail);

    // Membership/Wallet são reaproveitados (mesmo id), não duplicados — e o membershipType
    // definido na distribuição original não é sobrescrito pelo que a pessoa mandar no claim.
    const membershipsAfter = await prisma.membership.findMany({ where: { userId, organizationId: org.id } });
    expect(membershipsAfter).toHaveLength(1);
    expect(membershipsAfter[0]?.id).toBe(membershipId);
    expect(membershipsAfter[0]?.type).toBe('EMPLOYEE');

    const walletAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    expect(walletAfter.cachedBalance).toBe(300);

    const walletRes = await request(server)
      .get('/wallet')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${verifyBody.accessToken}`)
      .expect(200);
    expect((walletRes.body as WalletResponseBody).cachedBalance).toBe(300);
  });

  it('reivindica sem nenhuma organização no body — a pessoa só prova o CPF', async () => {
    const org = await createOrg();
    const { cpf, userId } = await createPendingClaim(org.id, { membershipType: 'EMPLOYEE', walletBalance: 50 });

    const claimEmail = `claim-no-org-${randomUUID()}@test.coins-api.dev`;

    await request(server)
      .post('/users/signup')
      .send({ cpf, name: 'Nome Escolhido No Claim', email: claimEmail })
      .expect(200);

    const code = extractCode(claimEmail);
    const verifyRes = await request(server).post('/users/signup/verify').send({ cpf, code, password: VALID_PASSWORD }).expect(200);

    const verifyBody = verifyRes.body as VerifyResponseBody;
    expect(verifyBody.accessToken).toBeTruthy();

    const promotedUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(promotedUser.status).toBe('ACTIVE');
  });

  it('CPF com PENDING_CLAIM em mais de uma organização ativa TODAS as memberships numa única verify', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const cpf = randomCpf();
    const cpfHash = hashCpf(cpf);

    const pendingUser = await prisma.user.create({
      data: { cpfEncrypted: encryptCpf(cpf), cpfHash, name: 'Duas Distribuições', status: 'PENDING_CLAIM' },
    });
    createdUserIds.push(pendingUser.id);

    const membershipA = await prisma.membership.create({
      data: { userId: pendingUser.id, organizationId: orgA.id, type: 'EMPLOYEE' },
    });
    const walletA = await prisma.wallet.create({ data: { membershipId: membershipA.id, cachedBalance: 100 } });

    const membershipB = await prisma.membership.create({
      data: { userId: pendingUser.id, organizationId: orgB.id, type: 'CUSTOMER' },
    });
    const walletB = await prisma.wallet.create({ data: { membershipId: membershipB.id, cachedBalance: 200 } });

    const claimEmail = `claim-multi-org-${randomUUID()}@test.coins-api.dev`;

    await request(server)
      .post('/users/signup')
      .send({ cpf, name: 'Reivindicando Duas Carteiras', email: claimEmail })
      .expect(200);

    const code = extractCode(claimEmail);
    const verifyRes = await request(server).post('/users/signup/verify').send({ cpf, code, password: VALID_PASSWORD }).expect(200);
    const verifyBody = verifyRes.body as VerifyResponseBody;

    const promotedUser = await prisma.user.findUniqueOrThrow({ where: { id: pendingUser.id } });
    expect(promotedUser.status).toBe('ACTIVE');

    // As duas memberships continuam existindo (não duplicadas) e as duas wallets/saldos
    // seguem intactos — o claim não escolheu uma organização, ativou a conta inteira.
    const membershipsAfter = await prisma.membership.findMany({ where: { userId: pendingUser.id } });
    expect(membershipsAfter).toHaveLength(2);

    const walletAfterA = await prisma.wallet.findUniqueOrThrow({ where: { id: walletA.id } });
    const walletAfterB = await prisma.wallet.findUniqueOrThrow({ where: { id: walletB.id } });
    expect(walletAfterA.cachedBalance).toBe(100);
    expect(walletAfterB.cachedBalance).toBe(200);

    const membershipsRes = await request(server)
      .get('/memberships')
      .set('Authorization', `Bearer ${verifyBody.accessToken}`)
      .expect(200);
    const membershipsBody = membershipsRes.body as { organizationId: string; walletBalance: number }[];
    expect(membershipsBody).toHaveLength(2);
    expect(membershipsBody.find((m) => m.organizationId === orgA.id)?.walletBalance).toBe(100);
    expect(membershipsBody.find((m) => m.organizationId === orgB.id)?.walletBalance).toBe(200);
  });

  it('falha ao garantir a Wallet da 2ª membership reverte tudo — nenhuma é promovida (rollback atômico)', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    const cpf = randomCpf();
    const cpfHash = hashCpf(cpf);

    const pendingUser = await prisma.user.create({
      data: { cpfEncrypted: encryptCpf(cpf), cpfHash, name: 'Falha No Meio', status: 'PENDING_CLAIM' },
    });
    createdUserIds.push(pendingUser.id);

    // Nenhuma das duas já tem Wallet — as duas passam pelo ensureWalletForMembership de
    // verdade (não é um no-op como no teste de sucesso acima), o que deixa espaço pra
    // simular a falha exatamente na 2ª chamada.
    const membershipA = await prisma.membership.create({
      data: { userId: pendingUser.id, organizationId: orgA.id, type: 'EMPLOYEE' },
    });
    const membershipB = await prisma.membership.create({
      data: { userId: pendingUser.id, organizationId: orgB.id, type: 'CUSTOMER' },
    });

    const claimEmail = `claim-rollback-${randomUUID()}@test.coins-api.dev`;

    await request(server)
      .post('/users/signup')
      .send({ cpf, name: 'Reivindicando Com Falha', email: claimEmail })
      .expect(200);

    const ensureWalletSpy = jest
      .spyOn(SignupService.prototype as unknown as { ensureWalletForMembership: (...args: unknown[]) => unknown }, 'ensureWalletForMembership')
      .mockImplementationOnce(async (...args: unknown[]) => {
        const [tx, membershipId] = args as [Prisma.TransactionClient, string];
        await tx.wallet.create({ data: { membershipId } });
      })
      .mockImplementationOnce(() => {
        throw new Error('Falha simulada ao garantir a Wallet da 2ª membership');
      });

    const code = extractCode(claimEmail);
    try {
      await request(server).post('/users/signup/verify').send({ cpf, code, password: VALID_PASSWORD }).expect(500);
    } finally {
      ensureWalletSpy.mockRestore();
    }

    // Nada do que a transação fez pode ter sobrevivido — nem a promoção do User pra ACTIVE,
    // nem a Wallet da 1ª membership que "tinha dado certo" antes da falha na 2ª.
    const userAfter = await prisma.user.findUniqueOrThrow({ where: { id: pendingUser.id } });
    expect(userAfter.status).toBe('PENDING_CLAIM');

    const walletA = await prisma.wallet.findUnique({ where: { membershipId: membershipA.id } });
    const walletB = await prisma.wallet.findUnique({ where: { membershipId: membershipB.id } });
    expect(walletA).toBeNull();
    expect(walletB).toBeNull();

    // O pedido de OTP não pode ter sido consumido por uma verificação que falhou — outra
    // tentativa com o MESMO código ainda deve funcionar.
    const retryRes = await request(server).post('/users/signup/verify').send({ cpf, code, password: VALID_PASSWORD }).expect(200);
    const retryBody = retryRes.body as VerifyResponseBody;
    expect(retryBody.accessToken).toBeTruthy();

    const userAfterRetry = await prisma.user.findUniqueOrThrow({ where: { id: pendingUser.id } });
    expect(userAfterRetry.status).toBe('ACTIVE');
    expect(await prisma.wallet.findUnique({ where: { membershipId: membershipA.id } })).not.toBeNull();
    expect(await prisma.wallet.findUnique({ where: { membershipId: membershipB.id } })).not.toBeNull();
  });
});

describe('Signup sem PENDING_CLAIM — CPF precisa ter sido convidado', () => {
  it('CPF nunca visto retorna 404 CPF_NOT_INVITED (não 500)', async () => {
    const cpf = randomCpf();
    const email = `never-seen-${randomUUID()}@test.coins-api.dev`;

    const response = await request(server).post('/users/signup').send({ cpf, name: 'X', email }).expect(404);

    expect((response.body as ErrorResponseBody).code).toBe('CPF_NOT_INVITED');
  });

  it('anti-enumeração: CPF nunca visto e CPF já ACTIVE (sem PENDING_CLAIM) devolvem a MESMA resposta', async () => {
    const activeCpf = randomCpf();
    const activeUser = await prisma.user.create({
      data: {
        cpfEncrypted: encryptCpf(activeCpf),
        cpfHash: hashCpf(activeCpf),
        name: 'Já Ativo',
        email: `already-active-e2e-${randomUUID()}@test.coins-api.dev`,
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(activeUser.id);

    const responseForNewCpf = await request(server)
      .post('/users/signup')
      .send({ cpf: randomCpf(), name: 'X', email: `new-e2e-${randomUUID()}@test.coins-api.dev` })
      .expect(404);

    const responseForActiveCpf = await request(server)
      .post('/users/signup')
      .send({ cpf: activeCpf, name: 'X', email: `ignored-e2e-${randomUUID()}@test.coins-api.dev` })
      .expect(404);

    // Não pode dar pra distinguir, pela resposta HTTP, "esse CPF nunca existiu" de "esse CPF
    // já é uma conta ACTIVE" — os dois viram exatamente o mesmo corpo de erro.
    expect(responseForNewCpf.body).toEqual(responseForActiveCpf.body);
    expect((responseForNewCpf.body as ErrorResponseBody).code).toBe('CPF_NOT_INVITED');
  });
});

describe('Verificação de OTP — casos de erro', () => {
  it('código errado incrementa attempts e falha com OTP_INVALID', async () => {
    const org = await createOrg();
    const { cpf } = await createPendingClaim(org.id);
    const email = `wrong-${randomUUID()}@test.coins-api.dev`;

    await request(server).post('/users/signup').send({ cpf, name: 'X', email }).expect(200);

    const response = await request(server)
      .post('/users/signup/verify')
      .send({ cpf, code: '000000', password: VALID_PASSWORD })
      .expect(401);

    expect((response.body as ErrorResponseBody).code).toBe('OTP_INVALID');
  });

  it('5ª tentativa errada vira OTP_TOO_MANY_ATTEMPTS', async () => {
    const org = await createOrg();
    const { cpf } = await createPendingClaim(org.id);
    const email = `bruteforce-${randomUUID()}@test.coins-api.dev`;

    await request(server).post('/users/signup').send({ cpf, name: 'X', email }).expect(200);

    for (let i = 0; i < 4; i += 1) {
      await request(server).post('/users/signup/verify').send({ cpf, code: '000000', password: VALID_PASSWORD }).expect(401);
    }

    const response = await request(server)
      .post('/users/signup/verify')
      .send({ cpf, code: '000000', password: VALID_PASSWORD })
      .expect(429);

    expect((response.body as ErrorResponseBody).code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  it('código expirado retorna OTP_EXPIRED', async () => {
    const org = await createOrg();
    const { cpf } = await createPendingClaim(org.id);
    const email = `expired-${randomUUID()}@test.coins-api.dev`;

    await request(server).post('/users/signup').send({ cpf, name: 'X', email }).expect(200);
    const code = extractCode(email);

    await prisma.userSignupRequest.updateMany({
      where: { cpfHash: hashCpf(cpf) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await request(server).post('/users/signup/verify').send({ cpf, code, password: VALID_PASSWORD }).expect(400);

    expect((response.body as ErrorResponseBody).code).toBe('OTP_EXPIRED');
  });
});

describe('Senha definida no cadastro', () => {
  it('senha fraca, comum ou contendo o CPF retorna 400 — User continua PENDING_CLAIM (rollback)', async () => {
    const org = await createOrg();
    const { cpf, userId } = await createPendingClaim(org.id);
    const email = `weak-password-${randomUUID()}@test.coins-api.dev`;

    await request(server).post('/users/signup').send({ cpf, name: 'X', email }).expect(200);
    const code = extractCode(email);

    await request(server).post('/users/signup/verify').send({ cpf, code, password: 'curta1' }).expect(400);
    await request(server).post('/users/signup/verify').send({ cpf, code, password: 'password123' }).expect(400);
    await request(server)
      .post('/users/signup/verify')
      .send({ cpf, code, password: `senha-com-${cpf}-dentro` })
      .expect(400);

    const userAfter = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(userAfter.status).toBe('PENDING_CLAIM');
    expect(userAfter.passwordHash).toBeNull();
  });

  it('a senha definida no cadastro já funciona logo em seguida em POST /users/login', async () => {
    const org = await createOrg();
    const { cpf } = await createPendingClaim(org.id);
    const email = `login-after-signup-${randomUUID()}@test.coins-api.dev`;

    await request(server).post('/users/signup').send({ cpf, name: 'X', email }).expect(200);
    const code = extractCode(email);
    await request(server).post('/users/signup/verify').send({ cpf, code, password: VALID_PASSWORD }).expect(200);

    await request(server).post('/users/login').send({ cpf, password: VALID_PASSWORD }).expect(200);
  });
});

describe('Segurança — CPF nunca em claro em log', () => {
  it('nenhuma escrita em stdout/stderr durante o fluxo completo contém o CPF em claro', async () => {
    const org = await createOrg();
    const { cpf } = await createPendingClaim(org.id);
    const email = `nolog-${randomUUID()}@test.coins-api.dev`;

    const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
      await request(server).post('/users/signup').send({ cpf, name: 'Sem Log', email }).expect(200);

      await request(server).post('/users/signup/verify').send({ cpf, code: '000000', password: VALID_PASSWORD }).expect(401);

      const code = extractCode(email);
      await request(server).post('/users/signup/verify').send({ cpf, code, password: VALID_PASSWORD }).expect(200);
    } finally {
      const allOutput = [...stdoutSpy.mock.calls, ...stderrSpy.mock.calls]
        .map((call) => String(call[0]))
        .join('\n');
      stdoutSpy.mockRestore();
      stderrSpy.mockRestore();

      expect(allOutput).not.toContain(cpf);
    }
  });
});
