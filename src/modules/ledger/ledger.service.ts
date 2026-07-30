import { Injectable } from '@nestjs/common';
import { LedgerEntry, LedgerEntryType, LedgerReferenceType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PostLedgerEntryInput, postLedgerEntrySchema } from './dto/post-ledger-entry.schema';
import {
  ReverseLedgerEntryInput,
  reverseLedgerEntrySchema,
} from './dto/reverse-ledger-entry.schema';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { InsufficientBalanceException } from './exceptions/insufficient-balance.exception';
import { InvalidReversalException } from './exceptions/invalid-reversal.exception';
import { LedgerConcurrencyException } from './exceptions/ledger-concurrency.exception';
import { computeEntryHash, GENESIS_HASH } from './hash.util';

type TransactionClient = Prisma.TransactionClient;

const MAX_RETRIES = 3;
const PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

interface EntryCoreInput {
  walletId: string;
  type: LedgerEntryType;
  delta: number;
  amount: number;
  referenceType: LedgerReferenceType;
  referenceId: string;
  description: string;
  batchId: string | null;
  distributionItemId: string | null;
  idempotencyKey: string;
  reversalOfId: string | null;
}

/** Sinaliza conflito de optimistic lock para o loop de retry. Nunca escapa do service. */
class LedgerVersionConflictError extends Error {
  constructor() {
    super('Conflito de optimistic lock na wallet');
  }
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Único ponto autorizado a mover coins (regra 1 do CLAUDE.md). `type` não inclui
   * REVERSAL de propósito — reversões só se criam via `reverse()`, que sabe calcular
   * a direção correta a partir do entry original.
   */
  async post(rawInput: PostLedgerEntryInput, tx?: TransactionClient): Promise<LedgerEntry> {
    const input = postLedgerEntrySchema.parse(rawInput);
    const delta = input.type === 'CREDIT' ? input.amount : -input.amount;

    return this.execute(
      {
        walletId: input.walletId,
        type: input.type,
        delta,
        amount: input.amount,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        description: input.description,
        batchId: input.batchId ?? null,
        distributionItemId: input.distributionItemId ?? null,
        idempotencyKey: input.idempotencyKey,
        reversalOfId: null,
      },
      tx,
    );
  }

  /** Cria um entry REVERSAL. Nunca edita o entry original (regra 5 do CLAUDE.md). */
  async reverse(rawInput: ReverseLedgerEntryInput, tx?: TransactionClient): Promise<LedgerEntry> {
    const input = reverseLedgerEntrySchema.parse(rawInput);
    const client = tx ?? this.prisma;
    const original = await client.ledgerEntry.findUniqueOrThrow({
      where: { id: input.entryId },
    });

    if (original.type === 'REVERSAL') {
      throw new InvalidReversalException(original.id);
    }

    const delta = original.type === 'CREDIT' ? -original.amount : original.amount;

    return this.execute(
      {
        walletId: original.walletId,
        type: 'REVERSAL',
        delta,
        amount: original.amount,
        referenceType: 'REVERSAL',
        referenceId: original.id,
        description: input.reason,
        batchId: original.batchId,
        distributionItemId: original.distributionItemId,
        idempotencyKey: input.idempotencyKey,
        reversalOfId: original.id,
      },
      tx,
    );
  }

  async getBalance(
    walletId: string,
  ): Promise<{ walletId: string; cachedBalance: number; version: number }> {
    const wallet = await this.prisma.wallet.findUniqueOrThrow({ where: { id: walletId } });
    return { walletId: wallet.id, cachedBalance: wallet.cachedBalance, version: wallet.version };
  }

  async getEntries(
    walletId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: LedgerEntry[]; nextCursor: string | null }> {
    const limit = options?.limit ?? 20;
    const items = await this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }

  private async execute(input: EntryCoreInput, tx?: TransactionClient): Promise<LedgerEntry> {
    const existing = await (tx ?? this.prisma).ledgerEntry.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });

    if (existing) {
      this.assertIdempotentReplayMatches(existing, input);
      return existing;
    }

    if (tx) {
      return this.executeEntry(tx, input);
    }

    return this.executeWithRetry(input, 1);
  }

  private async executeWithRetry(input: EntryCoreInput, attempt: number): Promise<LedgerEntry> {
    try {
      return await this.prisma.$transaction((txClient) => this.executeEntry(txClient, input));
    } catch (error) {
      if (error instanceof LedgerVersionConflictError) {
        if (attempt >= MAX_RETRIES) {
          throw new LedgerConcurrencyException(input.walletId, attempt);
        }
        return this.executeWithRetry(input, attempt + 1);
      }

      if (this.isIdempotencyKeyUniqueViolation(error)) {
        const existing = await this.prisma.ledgerEntry.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        this.assertIdempotentReplayMatches(existing, input);
        return existing;
      }

      throw error;
    }
  }

  private async executeEntry(tx: TransactionClient, input: EntryCoreInput): Promise<LedgerEntry> {
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: input.walletId } });
    const balanceAfter = wallet.cachedBalance + input.delta;

    if (balanceAfter < 0) {
      throw new InsufficientBalanceException(input.walletId, -input.delta, wallet.cachedBalance);
    }

    const updateResult = await tx.wallet.updateMany({
      where: { id: wallet.id, version: wallet.version },
      data: { cachedBalance: balanceAfter, version: { increment: 1 } },
    });

    if (updateResult.count === 0) {
      throw new LedgerVersionConflictError();
    }

    const previousEntry = await tx.ledgerEntry.findFirst({
      where: { walletId: input.walletId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    const prevHash = previousEntry?.hash ?? GENESIS_HASH;
    const createdAt = new Date();

    const hash = computeEntryHash(prevHash, {
      walletId: input.walletId,
      type: input.type,
      amount: input.amount,
      balanceAfter,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      idempotencyKey: input.idempotencyKey,
      batchId: input.batchId,
      createdAt,
    });

    return tx.ledgerEntry.create({
      data: {
        walletId: input.walletId,
        type: input.type,
        amount: input.amount,
        balanceAfter,
        idempotencyKey: input.idempotencyKey,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        batchId: input.batchId ?? undefined,
        distributionItemId: input.distributionItemId ?? undefined,
        description: input.description,
        prevHash,
        hash,
        reversalOfId: input.reversalOfId ?? undefined,
        createdAt,
      },
    });
  }

  private assertIdempotentReplayMatches(existing: LedgerEntry, input: EntryCoreInput): void {
    const matches =
      existing.walletId === input.walletId &&
      existing.type === input.type &&
      existing.amount === input.amount &&
      existing.referenceType === input.referenceType &&
      existing.referenceId === input.referenceId;

    if (!matches) {
      throw new IdempotencyConflictException(input.idempotencyKey, {
        existingEntryId: existing.id,
      });
    }
  }

  private isIdempotencyKeyUniqueViolation(error: unknown): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
      return false;
    }

    const target = error.meta?.target;
    return error.code === PRISMA_UNIQUE_CONSTRAINT_ERROR_CODE && Array.isArray(target)
      ? target.includes('idempotencyKey')
      : false;
  }
}
