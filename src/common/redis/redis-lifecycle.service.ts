import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';
import { BULLMQ_REDIS_CLIENT, REDIS_CLIENT } from './redis.constants';

@Injectable()
export class RedisLifecycleService implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(BULLMQ_REDIS_CLIENT) private readonly bullmqClient: Redis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await Promise.all([this.client.quit(), this.bullmqClient.quit()]);
  }
}
