import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { CreditCourseCompletionsService } from './credit-course-completions.service';
import { QUEUE_CREDIT_COURSE_COMPLETIONS } from './jobs.constants';

@Processor(QUEUE_CREDIT_COURSE_COMPLETIONS)
export class CreditCourseCompletionsProcessor extends WorkerHost {
  constructor(private readonly creditCourseCompletions: CreditCourseCompletionsService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    await this.creditCourseCompletions.run();
  }
}
