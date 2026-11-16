import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../common/redis/redis.constants';

@Injectable()
export class AccountDeletionRateLimitGuard implements CanActivate {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const key = `account-deletion:${request.user?.sub}`;
    const count = await this.redis.incr(key);
    if (count === 1) await this.redis.expire(key, 900);
    if (count > 5) {
      throw new HttpException(
        {
          code: 'TOO_MANY_DELETION_ATTEMPTS',
          message: 'Aguarde 15 minutos antes de tentar novamente.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
