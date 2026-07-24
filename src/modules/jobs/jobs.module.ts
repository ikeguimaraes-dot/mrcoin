import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { JobRunRecorderService } from './job-run-recorder.service';
import { ReconciliationService } from './reconciliation.service';
import { HashChainVerificationService } from './hash-chain-verification.service';
import { ReconcileBalancesProcessor } from './reconcile-balances.processor';
import { VerifyHashChainProcessor } from './verify-hash-chain.processor';
import { JobsScheduler } from './jobs.scheduler';
import { QUEUE_RECONCILE_BALANCES, QUEUE_VERIFY_HASH_CHAIN } from './jobs.constants';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_RECONCILE_BALANCES },
      { name: QUEUE_VERIFY_HASH_CHAIN },
    ),
  ],
  providers: [
    JobRunRecorderService,
    ReconciliationService,
    HashChainVerificationService,
    ReconcileBalancesProcessor,
    VerifyHashChainProcessor,
    JobsScheduler,
  ],
})
export class JobsModule {}
