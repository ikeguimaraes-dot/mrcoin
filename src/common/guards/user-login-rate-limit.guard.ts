import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import Redis from 'ioredis';
import { hashCpf } from '../crypto/cpf-crypto.util';
import { TooManyLoginAttemptsException } from '../exceptions/too-many-login-attempts.exception';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 5;

/**
 * 5 tentativas/min por IP e por CPF (chave = cpfHash) — mesmo padrão do SignupRateLimitGuard.
 * Sem isso, POST /users/login vira vetor de spam de e-mail (cada requisição dispara um OTP)
 * e de enumeração de CPF via timing/volume, mesmo o corpo da resposta já não vazando isso.
 */
@Injectable()
export class UserLoginRateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? 'unknown';
    const body: unknown = request.body;
    const rawCpf = typeof body === 'object' && body !== null ? (body as { cpf?: unknown }).cpf : undefined;

    await this.checkAndIncrement(`user-login-rl:ip:${ip}`);
    if (typeof rawCpf === 'string') {
      await this.checkAndIncrement(`user-login-rl:cpf:${hashCpf(rawCpf)}`);
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
