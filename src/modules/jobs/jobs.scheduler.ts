import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  CRON_RECONCILE_BALANCES,
  CRON_VERIFY_HASH_CHAIN,
  QUEUE_RECONCILE_BALANCES,
  QUEUE_VERIFY_HASH_CHAIN,
  SCHEDULER_ID_RECONCILE_BALANCES,
  SCHEDULER_ID_VERIFY_HASH_CHAIN,
} from './jobs.constants';

/** Registra os agendamentos repetíveis no Redis — upsert idempotente a cada boot da API. */
@Injectable()
export class JobsScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(QUEUE_RECONCILE_BALANCES) private readonly reconcileQueue: Queue,
    @InjectQueue(QUEUE_VERIFY_HASH_CHAIN) private readonly verifyQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.reconcileQueue.upsertJobScheduler(
      SCHEDULER_ID_RECONCILE_BALANCES,
      { pattern: CRON_RECONCILE_BALANCES },
      { name: QUEUE_RECONCILE_BALANCES },
    );

    await this.verifyQueue.upsertJobScheduler(
      SCHEDULER_ID_VERIFY_HASH_CHAIN,
      { pattern: CRON_VERIFY_HASH_CHAIN },
      { name: QUEUE_VERIFY_HASH_CHAIN },
    );
  }
}
