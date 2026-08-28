import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import Redis from 'ioredis';
import { TooManyLoginAttemptsException } from '../../../common/exceptions/too-many-login-attempts.exception';
import { REDIS_CLIENT } from '../../../common/redis/redis.constants';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 5;

/**
 * Rate limit por IP + ator (platformMfaSetupId/platformMfaChallengeId, já anexados pelo
 * guard de MFA que roda antes deste na cadeia de @UseGuards). Fecha uma lacuna que existe
 * hoje no fluxo de AdminUser — lá, mfa/verify e mfa/enable não têm rate limit — deliberado
 * aqui por ser a camada mais sensível.
 */
@Injectable()
export class PlatformAdminMfaRateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? 'unknown';
    const actorId = request.platformMfaSetupId ?? request.platformMfaChallengeId;

    await this.checkAndIncrement(`platform-admin-mfa-rl:ip:${ip}`);
    if (actorId) {
      await this.checkAndIncrement(`platform-admin-mfa-rl:actor:${actorId}`);
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
