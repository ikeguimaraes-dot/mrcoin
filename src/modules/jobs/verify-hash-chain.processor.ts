import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { HashChainVerificationService } from './hash-chain-verification.service';
import { QUEUE_VERIFY_HASH_CHAIN } from './jobs.constants';

@Processor(QUEUE_VERIFY_HASH_CHAIN)
export class VerifyHashChainProcessor extends WorkerHost {
  constructor(private readonly hashChainVerification: HashChainVerificationService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.hashChainVerification.run();
  }
}
