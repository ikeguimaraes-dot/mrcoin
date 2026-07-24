import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ReconciliationService } from './reconciliation.service';
import { QUEUE_RECONCILE_BALANCES } from './jobs.constants';

@Processor(QUEUE_RECONCILE_BALANCES)
export class ReconcileBalancesProcessor extends WorkerHost {
  constructor(private readonly reconciliation: ReconciliationService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.reconciliation.run();
  }
}
