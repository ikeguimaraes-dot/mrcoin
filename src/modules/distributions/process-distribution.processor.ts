import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { DistributionsService } from './distributions.service';
import { QUEUE_PROCESS_DISTRIBUTION } from './distributions.constants';

interface ProcessDistributionJobData {
  distributionId: string;
}

@Processor(QUEUE_PROCESS_DISTRIBUTION)
export class ProcessDistributionProcessor extends WorkerHost {
  constructor(private readonly distributionsService: DistributionsService) {
    super();
  }

  async process(job: Job<ProcessDistributionJobData>): Promise<void> {
    await this.distributionsService.processBulkDistribution(job.data.distributionId);
  }
}
