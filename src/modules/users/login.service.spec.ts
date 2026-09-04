import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { createRedisConnection } from '../../common/redis/redis-connection.factory';
import * as passwordUtil from '../auth/password.util';
import { LoginService } from './login.service';
import { UserTokenService } from './user-token.service';
import { InvalidLoginCredentialsException } from './exceptions/invalid-login-credentials.exception';
import { LoginLockedException } from './exceptions/login-locked.exception';

const prisma = new PrismaService();
const redis = createRedisConnection(process.env.REDIS_URL as string);
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const userTokenService = new UserTokenService(jwtService, prisma);
const loginService = new LoginService(prisma, userTokenService, redis);

const VALID_PASSWORD = 'Xk9$mQ2vL7correto';

const createdUserIds: string[] = [];

function randomCpf(): string {
  return randomUUID().replace(/-/g, '').slice(0, 11);
}

async function createUser(password?: string): Promise<{ userId: string; cpf: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const passwordHash = password ? await passwordUtil.hashPassword(password) : undefined;
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Login Service Test User ${suffix}`,
      status: 'ACTIVE',
      passwordHash,
    },
  });
  createdUserIds.push(user.id);
  return { userId: user.id, cpf };
}

afterAll(async () => {
  const keys = await redis.keys('login-fail:*');
  if (keys.length > 0) {
    await redis.del(...keys);
  }
  redis.disconnect();
  await prisma.userRefreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('LoginService — tempo constante entre os ramos ambíguos', () => {
  it('CPF inexistente ainda chama verifyPassword (contra o hash-dummy) — não pula o argon2', async () => {
    const spy = jest.spyOn(passwordUtil, 'verifyPassword');
    spy.mockClear();

    await expect(loginService.login({ cpf: randomCpf(), password: 'qualquer-coisa' })).rejects.toBeInstanceOf(
      InvalidLoginCredentialsException,
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('CPF existente sem senha ainda chama verifyPassword (contra o hash-dummy)', async () => {
    const { cpf } = await createUser();
    const spy = jest.spyOn(passwordUtil, 'verifyPassword');
    spy.mockClear();

    await expect(loginService.login({ cpf, password: VALID_PASSWORD })).rejects.toBeInstanceOf(
      InvalidLoginCredentialsException,
    );

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('senha errada num CPF real chama verifyPassword exatamente uma vez', async () => {
    const { cpf } = await createUser(VALID_PASSWORD);
    const spy = jest.spyOn(passwordUtil, 'verifyPassword');
    spy.mockClear();

    await expect(loginService.login({ cpf, password: 'errada' })).rejects.toBeInstanceOf(InvalidLoginCredentialsException);

    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('LoginService — bloqueio fixo por CPF', () => {
  it('login com senha certa passa sem lançar', async () => {
    const { cpf, userId } = await createUser(VALID_PASSWORD);

    const result = await loginService.login({ cpf, password: VALID_PASSWORD });
    expect(result.accessToken).toBeTruthy();

    const stored = await prisma.userRefreshToken.findFirst({ where: { userId } });
    expect(stored).not.toBeNull();
  });

  it('5 erros seguidos bloqueiam — 6ª tentativa com senha certa ainda dá LoginLockedException', async () => {
    const { cpf } = await createUser(VALID_PASSWORD);

    for (let i = 0; i < 4; i += 1) {
      await expect(loginService.login({ cpf, password: 'errada' })).rejects.toBeInstanceOf(InvalidLoginCredentialsException);
    }
    await expect(loginService.login({ cpf, password: 'errada' })).rejects.toBeInstanceOf(LoginLockedException);
    await expect(loginService.login({ cpf, password: VALID_PASSWORD })).rejects.toBeInstanceOf(LoginLockedException);
  });

  it('o mesmo bloqueio se aplica a um CPF que nunca existiu', async () => {
    const cpf = randomCpf();

    for (let i = 0; i < 4; i += 1) {
      await expect(loginService.login({ cpf, password: 'qualquer-coisa' })).rejects.toBeInstanceOf(
        InvalidLoginCredentialsException,
      );
    }
    await expect(loginService.login({ cpf, password: 'qualquer-coisa' })).rejects.toBeInstanceOf(LoginLockedException);
  });

  it('login certo depois de alguns erros reseta o contador de falhas', async () => {
    const { cpf } = await createUser(VALID_PASSWORD);

    await expect(loginService.login({ cpf, password: 'errada' })).rejects.toBeInstanceOf(InvalidLoginCredentialsException);
    await expect(loginService.login({ cpf, password: 'errada' })).rejects.toBeInstanceOf(InvalidLoginCredentialsException);
    await expect(loginService.login({ cpf, password: VALID_PASSWORD })).resolves.toBeDefined();

    const remaining = await redis.get(`login-fail:${hashCpf(cpf)}`);
    expect(remaining).toBeNull();
  });
});
