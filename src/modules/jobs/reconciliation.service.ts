import { Injectable, Logger } from '@nestjs/common';
import { JobRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { JobRunRecorderService } from './job-run-recorder.service';
import { LEDGER_ENTRY_PAGE_SIZE, MAX_ISSUES_PERSISTED, WALLET_PAGE_SIZE } from './jobs.constants';
import { BalanceMismatchIssue, JobRunDetails } from './job-run.types';

/**
 * Confere, wallet a wallet, se a soma dos deltas do ledger bate com `cachedBalance`.
 * O delta de cada entry vem de `balanceAfter_i - balanceAfter_{i-1}` (não do `type`),
 * porque REVERSAL não tem sinal fixo — reverter um DEBIT tem efeito de crédito e vice-versa.
 */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobRunRecorder: JobRunRecorderService,
  ) {}

  async run(): Promise<void> {
    const jobRun = await this.jobRunRecorder.start('RECONCILE_BALANCES');
    const issues: BalanceMismatchIssue[] = [];
    let walletsChecked = 0;

    try {
      let cursor: string | undefined;

      for (;;) {
        const wallets = await this.prisma.wallet.findMany({
          orderBy: { id: 'asc' },
          take: WALLET_PAGE_SIZE,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });

        if (wallets.length === 0) {
          break;
        }

        for (const wallet of wallets) {
          walletsChecked += 1;
          const issue = await this.reconcileWallet(wallet.id, wallet.cachedBalance);
          if (issue) {
            issues.push(issue);
          }
        }

        cursor = wallets[wallets.length - 1]?.id;
        if (wallets.length < WALLET_PAGE_SIZE) {
          break;
        }
      }

      await this.persist(jobRun.id, 'SUCCESS', walletsChecked, issues);
    } catch (error) {
      this.logger.error('reconcile-balances falhou', error as Error);
      await this.persistBestEffort(jobRun.id, 'FAILED', walletsChecked, issues);
      throw error;
    }
  }

  private async reconcileWallet(
    walletId: string,
    cachedBalance: number,
  ): Promise<BalanceMismatchIssue | null> {
    let previousBalanceAfter = 0;
    let sumOfDeltas = 0;
    let lastBalanceAfter = 0;
    let cursor: string | undefined;

    for (;;) {
      const entries = await this.prisma.ledgerEntry.findMany({
        where: { walletId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: LEDGER_ENTRY_PAGE_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });

      if (entries.length === 0) {
        break;
      }

      for (const entry of entries) {
        sumOfDeltas += entry.balanceAfter - previousBalanceAfter;
        previousBalanceAfter = entry.balanceAfter;
        lastBalanceAfter = entry.balanceAfter;
      }

      cursor = entries[entries.length - 1]?.id;
      if (entries.length < LEDGER_ENTRY_PAGE_SIZE) {
        break;
      }
    }

    if (sumOfDeltas !== cachedBalance || lastBalanceAfter !== cachedBalance) {
      return {
        type: 'BALANCE_MISMATCH',
        walletId,
        sumOfDeltas,
        lastBalanceAfter,
        actualCachedBalance: cachedBalance,
      };
    }

    return null;
  }

  private async persist(
    jobRunId: string,
    status: JobRunStatus,
    walletsChecked: number,
    issues: BalanceMismatchIssue[],
  ): Promise<void> {
    if (issues.length > MAX_ISSUES_PERSISTED) {
      this.logger.error(
        `reconcile-balances encontrou ${issues.length} divergências — persistindo só as primeiras ${MAX_ISSUES_PERSISTED}. Todas: ${JSON.stringify(issues)}`,
      );
    }

    const details: JobRunDetails<BalanceMismatchIssue> = {
      walletsChecked,
      issues: issues.slice(0, MAX_ISSUES_PERSISTED),
    };

    await this.jobRunRecorder.finish(jobRunId, {
      status,
      issuesFound: issues.length,
      details: details as unknown as Prisma.InputJsonValue,
    });
  }

  private async persistBestEffort(
    jobRunId: string,
    status: JobRunStatus,
    walletsChecked: number,
    issues: BalanceMismatchIssue[],
  ): Promise<void> {
    try {
      await this.persist(jobRunId, status, walletsChecked, issues);
    } catch (persistError) {
      this.logger.error('Falha ao gravar JobRun de reconcile-balances', persistError as Error);
    }
  }
}
