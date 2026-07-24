import { Injectable, Logger } from '@nestjs/common';
import { JobRunStatus, Prisma } from '@prisma/client';
import { computeEntryHash, GENESIS_HASH } from '../ledger/hash.util';
import { PrismaService } from '../../prisma/prisma.service';
import { JobRunRecorderService } from './job-run-recorder.service';
import { LEDGER_ENTRY_PAGE_SIZE, MAX_ISSUES_PERSISTED, WALLET_PAGE_SIZE } from './jobs.constants';
import { HashChainIssue, JobRunDetails } from './job-run.types';

/**
 * Confere, wallet a wallet, a integridade da cadeia sha256 do ledger. Usa sempre o
 * `entry.hash` armazenado (não o recomputado) como `prevHash` esperado do próximo entry —
 * assim, um entry corrompido isolado gera só 1 HASH_MISMATCH, sem cascatear
 * PREV_HASH_MISMATCH falso nos entries seguintes.
 */
@Injectable()
export class HashChainVerificationService {
  private readonly logger = new Logger(HashChainVerificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jobRunRecorder: JobRunRecorderService,
  ) {}

  async run(): Promise<void> {
    const jobRun = await this.jobRunRecorder.start('VERIFY_HASH_CHAIN');
    const issues: HashChainIssue[] = [];
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
          issues.push(...(await this.verifyWalletChain(wallet.id)));
        }

        cursor = wallets[wallets.length - 1]?.id;
        if (wallets.length < WALLET_PAGE_SIZE) {
          break;
        }
      }

      await this.persist(jobRun.id, 'SUCCESS', walletsChecked, issues);
    } catch (error) {
      this.logger.error('verify-hash-chain falhou', error as Error);
      await this.persistBestEffort(jobRun.id, 'FAILED', walletsChecked, issues);
      throw error;
    }
  }

  private async verifyWalletChain(walletId: string): Promise<HashChainIssue[]> {
    const issues: HashChainIssue[] = [];
    let expectedPrevHash = GENESIS_HASH;
    let isFirstEntry = true;
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
        if (isFirstEntry && entry.prevHash !== GENESIS_HASH) {
          issues.push({
            type: 'GENESIS_MISMATCH',
            walletId,
            entryId: entry.id,
            expected: GENESIS_HASH,
            actual: entry.prevHash,
          });
        }
        isFirstEntry = false;

        if (entry.prevHash !== expectedPrevHash) {
          issues.push({
            type: 'PREV_HASH_MISMATCH',
            walletId,
            entryId: entry.id,
            expected: expectedPrevHash,
            actual: entry.prevHash,
          });
        }

        const recomputedHash = computeEntryHash(entry.prevHash, {
          walletId: entry.walletId,
          type: entry.type,
          amount: entry.amount,
          balanceAfter: entry.balanceAfter,
          referenceType: entry.referenceType,
          referenceId: entry.referenceId,
          idempotencyKey: entry.idempotencyKey,
          batchId: entry.batchId,
          createdAt: entry.createdAt,
        });

        if (recomputedHash !== entry.hash) {
          issues.push({
            type: 'HASH_MISMATCH',
            walletId,
            entryId: entry.id,
            expected: recomputedHash,
            actual: entry.hash,
          });
        }

        expectedPrevHash = entry.hash;
      }

      cursor = entries[entries.length - 1]?.id;
      if (entries.length < LEDGER_ENTRY_PAGE_SIZE) {
        break;
      }
    }

    return issues;
  }

  private async persist(
    jobRunId: string,
    status: JobRunStatus,
    walletsChecked: number,
    issues: HashChainIssue[],
  ): Promise<void> {
    if (issues.length > MAX_ISSUES_PERSISTED) {
      this.logger.error(
        `verify-hash-chain encontrou ${issues.length} problemas — persistindo só os primeiros ${MAX_ISSUES_PERSISTED}. Todos: ${JSON.stringify(issues)}`,
      );
    }

    const details: JobRunDetails<HashChainIssue> = {
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
    issues: HashChainIssue[],
  ): Promise<void> {
    try {
      await this.persist(jobRunId, status, walletsChecked, issues);
    } catch (persistError) {
      this.logger.error('Falha ao gravar JobRun de verify-hash-chain', persistError as Error);
    }
  }
}
