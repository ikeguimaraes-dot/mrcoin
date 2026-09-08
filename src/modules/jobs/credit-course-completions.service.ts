import { Injectable, Logger } from '@nestjs/common';
import { JobRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseCreditService } from '../courses/course-credit.service';
import { COURSE_COMPLETION_CREDIT_BATCH_SIZE } from '../courses/courses.constants';
import { JobRunRecorderService } from './job-run-recorder.service';

interface CreditCourseCompletionsDetails {
  credited: number;
  stillPending: number;
}

/**
 * Varre CourseCompletion PENDING (mais antiga primeiro, entre TODAS as organizações — justo,
 * não prioriza nenhuma) e tenta creditar cada uma via CourseCreditService.tryCredit — mesmo
 * método que POST /courses/:id/quiz/submit chama na hora da aprovação. Uma organização sem
 * estoque não trava as outras: cada linha é tentada independente, sem sucesso só segue pra
 * próxima (fica PENDING pro próximo run). Roda a cada 15min (mais frequente que os jobs
 * diários existentes — aqui tem gente esperando um crédito de verdade, não só uma varredura
 * diagnóstica).
 */
@Injectable()
export class CreditCourseCompletionsService {
  private readonly logger = new Logger(CreditCourseCompletionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobRunRecorder: JobRunRecorderService,
    private readonly courseCreditService: CourseCreditService,
  ) {}

  async run(): Promise<void> {
    const jobRun = await this.jobRunRecorder.start('CREDIT_COURSE_COMPLETIONS');
    let credited = 0;
    let stillPending = 0;

    try {
      let cursor: string | undefined;

      for (;;) {
        const pending = await this.prisma.courseCompletion.findMany({
          where: { creditStatus: 'PENDING' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: COURSE_COMPLETION_CREDIT_BATCH_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        if (pending.length === 0) {
          break;
        }

        for (const completion of pending) {
          const success = await this.courseCreditService.tryCredit(completion.id);
          if (success) {
            credited += 1;
          } else {
            stillPending += 1;
          }
        }

        cursor = pending[pending.length - 1]?.id;
        if (pending.length < COURSE_COMPLETION_CREDIT_BATCH_SIZE) {
          break;
        }
      }

      await this.persist(jobRun.id, 'SUCCESS', { credited, stillPending });
    } catch (error) {
      this.logger.error('credit-course-completions falhou', error as Error);
      await this.persistBestEffort(jobRun.id, 'FAILED', { credited, stillPending });
      throw error;
    }
  }

  private async persist(jobRunId: string, status: JobRunStatus, details: CreditCourseCompletionsDetails): Promise<void> {
    await this.jobRunRecorder.finish(jobRunId, {
      status,
      issuesFound: details.stillPending,
      details: details as unknown as Prisma.InputJsonValue,
    });
  }

  private async persistBestEffort(
    jobRunId: string,
    status: JobRunStatus,
    details: CreditCourseCompletionsDetails,
  ): Promise<void> {
    try {
      await this.persist(jobRunId, status, details);
    } catch (persistError) {
      this.logger.error('Falha ao gravar JobRun de credit-course-completions', persistError as Error);
    }
  }
}
