import { Injectable } from '@nestjs/common';
import { JobName, JobRun, JobRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

interface FinishInput {
  status: JobRunStatus;
  issuesFound: number;
  details: Prisma.InputJsonValue;
}

/** Grava o histórico de execução dos jobs agendados (JobRun) — usado por todo job novo. */
@Injectable()
export class JobRunRecorderService {
  constructor(private readonly prisma: PrismaService) {}

  start(jobName: JobName): Promise<JobRun> {
    return this.prisma.jobRun.create({ data: { jobName, status: 'RUNNING' } });
  }

  finish(id: string, result: FinishInput): Promise<JobRun> {
    return this.prisma.jobRun.update({
      where: { id },
      data: {
        status: result.status,
        issuesFound: result.issuesFound,
        details: result.details,
        finishedAt: new Date(),
      },
    });
  }
}
