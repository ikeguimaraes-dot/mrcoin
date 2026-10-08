import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { CoursesModule } from '../courses/courses.module';
import { JobRunRecorderService } from './job-run-recorder.service';
import { ReconciliationService } from './reconciliation.service';
import { HashChainVerificationService } from './hash-chain-verification.service';
import { CreditCourseCompletionsService } from './credit-course-completions.service';
import { ReconcileBalancesProcessor } from './reconcile-balances.processor';
import { VerifyHashChainProcessor } from './verify-hash-chain.processor';
import { CreditCourseCompletionsProcessor } from './credit-course-completions.processor';
import { JobsScheduler } from './jobs.scheduler';
import {
  QUEUE_CREDIT_COURSE_COMPLETIONS,
  QUEUE_RECONCILE_BALANCES,
  QUEUE_VERIFY_HASH_CHAIN,
} from './jobs.constants';

// E2E importa o AppModule completo. Subir workers nesse contexto faz a suíte consumir jobs
// pendentes do Redis em paralelo e permite que continuem usando o Prisma durante o teardown.
// Os processors continuam cobertos diretamente nos specs dos jobs; só o runtime automático é
// desligado em NODE_ENV=test.
const runtimeProviders =
  process.env.NODE_ENV === 'test'
    ? []
    : [
        ReconcileBalancesProcessor,
        VerifyHashChainProcessor,
        CreditCourseCompletionsProcessor,
        JobsScheduler,
      ];

@Module({
  imports: [
    CoursesModule,
    BullModule.registerQueue(
      { name: QUEUE_RECONCILE_BALANCES },
      { name: QUEUE_VERIFY_HASH_CHAIN },
      { name: QUEUE_CREDIT_COURSE_COMPLETIONS },
    ),
  ],
  providers: [
    JobRunRecorderService,
    ReconciliationService,
    HashChainVerificationService,
    CreditCourseCompletionsService,
    ...runtimeProviders,
  ],
})
export class JobsModule {}
