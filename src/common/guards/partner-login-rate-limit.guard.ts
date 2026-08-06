import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import Redis from 'ioredis';
import { TooManyLoginAttemptsException } from '../exceptions/too-many-login-attempts.exception';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 5;

/** 5 tentativas/min por IP e por e-mail (chaves Redis separadas), mesmo padrão do
 * LoginRateLimitGuard de admin — sliding window simples via Redis INCR/EXPIRE. */
@Injectable()
export class PartnerLoginRateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? 'unknown';
    const body: unknown = request.body;
    const rawEmail =
      typeof body === 'object' && body !== null ? (body as { email?: unknown }).email : undefined;
    const email = typeof rawEmail === 'string' ? rawEmail.toLowerCase() : undefined;

    await this.checkAndIncrement(`partner-login-rl:ip:${ip}`);
    if (email) {
      await this.checkAndIncrement(`partner-login-rl:account:${email}`);
    }

    return true;
  }

  private async checkAndIncrement(key: string): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
    if (count > MAX_ATTEMPTS) {
      throw new TooManyLoginAttemptsException();
    }
  }
}
