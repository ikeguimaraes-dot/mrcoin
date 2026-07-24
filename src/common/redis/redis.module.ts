import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../../config/env.schema';
import { createRedisConnection } from './redis-connection.factory';
import { RedisLifecycleService } from './redis-lifecycle.service';
import { BULLMQ_REDIS_CLIENT, REDIS_CLIENT } from './redis.constants';

export { BULLMQ_REDIS_CLIENT, REDIS_CLIENT } from './redis.constants';

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createRedisConnection(config.get('REDIS_URL', { infer: true })),
    },
    {
      provide: BULLMQ_REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createRedisConnection(config.get('REDIS_URL', { infer: true })),
    },
    RedisLifecycleService,
  ],
  exports: [REDIS_CLIENT, BULLMQ_REDIS_CLIENT],
})
export class RedisModule {}
