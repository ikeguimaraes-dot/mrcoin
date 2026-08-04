import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import Redis from 'ioredis';
import { TooManyRedemptionConfirmAttemptsException } from '../exceptions/too-many-redemption-confirm-attempts.exception';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 20;

/**
 * 20 tentativas/min por parceiro e por IP (chaves Redis separadas, mesmo padrão de
 * LoginRateLimitGuard/SignupRateLimitGuard) — limite mais generoso que login/signup porque um
 * parceiro real confirma bastante coisa por minuto. Existe pra inviabilizar brute-force do
 * código de 6 dígitos: mesmo sem isso a janela de validade (5min) e a base pequena de códigos
 * PENDING vivos ao mesmo tempo já limitam o dano, mas rate limit fecha a porta por completo.
 * Roda DEPOIS do PartnerJwtGuard no @UseGuards() — depende de request.partner já setado.
 */
@Injectable()
export class RedemptionConfirmRateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? 'unknown';
    const partnerId = request.partner?.sub;

    await this.checkAndIncrement(`redemption-confirm-rl:ip:${ip}`);
    if (partnerId) {
      await this.checkAndIncrement(`redemption-confirm-rl:partner:${partnerId}`);
    }

    return true;
  }

  private async checkAndIncrement(key: string): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
    if (count > MAX_ATTEMPTS) {
      throw new TooManyRedemptionConfirmAttemptsException();
    }
  }
}
