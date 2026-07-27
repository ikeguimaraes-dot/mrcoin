import { randomInt, randomUUID } from 'node:crypto';
import { ExecutionContext } from '@nestjs/common';
import { createRedisConnection } from '../redis/redis-connection.factory';
import { SignupRateLimitGuard } from './signup-rate-limit.guard';
import { TooManySignupAttemptsException } from '../exceptions/too-many-signup-attempts.exception';

const redis = createRedisConnection(process.env.REDIS_URL as string);
const guard = new SignupRateLimitGuard(redis);

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

function buildContext(ip: string, cpf: string): ExecutionContext {
  const request = { ip, body: { cpf } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

afterAll(() => {
  redis.disconnect();
});

describe('SignupRateLimitGuard', () => {
  it('permite até 5 tentativas por IP+CPF em 1 minuto e bloqueia a 6ª', async () => {
    const ip = `test-ip-${randomUUID()}`;
    const cpf = randomCpf();

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(buildContext(ip, cpf))).resolves.toBe(true);
    }

    await expect(guard.canActivate(buildContext(ip, cpf))).rejects.toBeInstanceOf(
      TooManySignupAttemptsException,
    );
  });

  it('mesmo IP com CPFs diferentes também estoura pelo lado do IP', async () => {
    const ip = `test-ip-${randomUUID()}`;
    const cpfA = randomCpf();
    const cpfB = randomCpf();

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(buildContext(ip, cpfA))).resolves.toBe(true);
    }

    await expect(guard.canActivate(buildContext(ip, cpfB))).rejects.toBeInstanceOf(
      TooManySignupAttemptsException,
    );
  });

  it('mesmo CPF em IPs diferentes estoura pelo lado do CPF', async () => {
    const cpf = randomCpf();

    for (let i = 0; i < 5; i++) {
      await expect(
        guard.canActivate(buildContext(`test-ip-${randomUUID()}`, cpf)),
      ).resolves.toBe(true);
    }

    await expect(
      guard.canActivate(buildContext(`test-ip-${randomUUID()}`, cpf)),
    ).rejects.toBeInstanceOf(TooManySignupAttemptsException);
  });
});
