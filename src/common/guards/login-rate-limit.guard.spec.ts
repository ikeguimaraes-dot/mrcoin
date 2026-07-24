import { randomUUID } from 'node:crypto';
import { ExecutionContext } from '@nestjs/common';
import { createRedisConnection } from '../redis/redis-connection.factory';
import { LoginRateLimitGuard } from './login-rate-limit.guard';
import { TooManyLoginAttemptsException } from '../exceptions/too-many-login-attempts.exception';

const redis = createRedisConnection(process.env.REDIS_URL as string);
const guard = new LoginRateLimitGuard(redis);

function buildContext(ip: string, email: string): ExecutionContext {
  const request = { ip, body: { email } };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

afterAll(() => {
  redis.disconnect();
});

describe('LoginRateLimitGuard', () => {
  it('permite até 5 tentativas por IP+conta em 1 minuto e bloqueia a 6ª', async () => {
    const ip = `test-ip-${randomUUID()}`;
    const email = `test-${randomUUID()}@test.dev`;

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(buildContext(ip, email))).resolves.toBe(true);
    }

    await expect(guard.canActivate(buildContext(ip, email))).rejects.toBeInstanceOf(
      TooManyLoginAttemptsException,
    );
  });

  it('mesmo IP em contas diferentes também estoura pelo lado do IP', async () => {
    const ip = `test-ip-${randomUUID()}`;
    const emailA = `test-a-${randomUUID()}@test.dev`;
    const emailB = `test-b-${randomUUID()}@test.dev`;

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(buildContext(ip, emailA))).resolves.toBe(true);
    }

    await expect(guard.canActivate(buildContext(ip, emailB))).rejects.toBeInstanceOf(
      TooManyLoginAttemptsException,
    );
  });

  it('mesma conta em IPs diferentes estoura pelo lado da conta', async () => {
    const email = `test-shared-${randomUUID()}@test.dev`;

    for (let i = 0; i < 5; i++) {
      await expect(
        guard.canActivate(buildContext(`test-ip-${randomUUID()}`, email)),
      ).resolves.toBe(true);
    }

    await expect(
      guard.canActivate(buildContext(`test-ip-${randomUUID()}`, email)),
    ).rejects.toBeInstanceOf(TooManyLoginAttemptsException);
  });
});
