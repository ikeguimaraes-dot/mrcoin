import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import Redis from 'ioredis';
import { hashCpf } from '../crypto/cpf-crypto.util';
import { TooManySignupAttemptsException } from '../exceptions/too-many-signup-attempts.exception';
import { REDIS_CLIENT } from '../redis/redis.constants';

const WINDOW_SECONDS = 60;
const MAX_ATTEMPTS = 5;

/**
 * 5 tentativas/min por IP e por CPF (chave = cpfHash, nunca o CPF em claro), sliding window
 * simples — mesmo padrão do LoginRateLimitGuard. Sem isso, o 409 MEMBERSHIP_ALREADY_EXISTS
 * (aceito como vazamento conhecido: CPF não é segredo) ficaria barato de explorar em massa, e
 * o endpoint viraria vetor de spam de e-mail (cada requisição dispara um OTP).
 */
@Injectable()
export class SignupRateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = request.ip ?? 'unknown';
    const body: unknown = request.body;
    const rawCpf = typeof body === 'object' && body !== null ? (body as { cpf?: unknown }).cpf : undefined;

    await this.checkAndIncrement(`signup-rl:ip:${ip}`);
    if (typeof rawCpf === 'string') {
      await this.checkAndIncrement(`signup-rl:cpf:${hashCpf(rawCpf)}`);
    }

    return true;
  }

  private async checkAndIncrement(key: string): Promise<void> {
    const count = await this.redis.incr(key);
    if (count === 1) {
      await this.redis.expire(key, WINDOW_SECONDS);
    }
    if (count > MAX_ATTEMPTS) {
      throw new TooManySignupAttemptsException();
    }
  }
}
