import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';
import { hashPassword, verifyPassword } from '../auth/password.util';
import { InvalidPinException } from './exceptions/invalid-pin.exception';
import { PinLockedException } from './exceptions/pin-locked.exception';
import { TransactionPinNotSetException } from './exceptions/transaction-pin-not-set.exception';

const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_WINDOW_SECONDS = 900;

/**
 * PIN de transação — hash com a mesma função de senha (argon2id, password.util.ts), já
 * que argon2id não se importa com o alfabeto/tamanho do segredo. Bloqueio fixo de 15min
 * após 5 erros seguidos (diferente da janela deslizante dos guards de rate limit
 * existentes — não tem precedente nesta base, ver plano da Sessão 21): a chave Redis
 * `pin-fail:{userId}` funciona tanto como contador quanto como o próprio lock — ao bater 5,
 * ela continua presente e com TTL correndo até os 15min completarem, travando qualquer
 * tentativa nesse meio-tempo sem nem olhar o PIN enviado.
 */
@Injectable()
export class TransactionPinService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async setPin(userId: string, pin: string): Promise<void> {
    const transactionPinHash = await hashPassword(pin);
    await this.prisma.user.update({ where: { id: userId }, data: { transactionPinHash } });
  }

  async verifyPin(userId: string, pin: string): Promise<void> {
    const lockKey = `pin-fail:${userId}`;

    const currentFailures = await this.redis.get(lockKey);
    if (currentFailures !== null && Number(currentFailures) >= PIN_MAX_ATTEMPTS) {
      throw new PinLockedException();
    }

    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { transactionPinHash: true },
    });
    if (!user.transactionPinHash) {
      throw new TransactionPinNotSetException();
    }

    const valid = await verifyPassword(user.transactionPinHash, pin);
    if (valid) {
      await this.redis.del(lockKey);
      return;
    }

    const newCount = await this.redis.incr(lockKey);
    if (newCount === 1) {
      await this.redis.expire(lockKey, PIN_LOCKOUT_WINDOW_SECONDS);
    }
    if (newCount >= PIN_MAX_ATTEMPTS) {
      throw new PinLockedException();
    }
    throw new InvalidPinException(PIN_MAX_ATTEMPTS - newCount);
  }
}
