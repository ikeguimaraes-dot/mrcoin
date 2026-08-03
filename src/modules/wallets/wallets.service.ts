import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SafeLedgerEntry } from '../ledger/safe-ledger-entry.util';
import { MembershipNotFoundException } from './exceptions/membership-not-found.exception';

export interface ExpiringBatch {
  batchId: string;
  amount: number;
  expiresAt: Date;
}

export interface WalletSummary {
  walletId: string;
  cachedBalance: number;
  expiring: ExpiringBatch[];
}

/**
 * "Coins a expirar" é um FIFO calculado só com os LedgerEntry da própria wallet — soma o
 * delta de cada entry (`balanceAfter_i - balanceAfter_{i-1}`, nunca pelo `type`, porque
 * REVERSAL não tem sinal fixo — mesma técnica do ReconciliationService da Sessão 4) agrupado
 * por `batchId`, mantendo só os lotes com saldo líquido positivo. Não depende do job
 * `expire-coins` (ainda não implementado) nem de `CoinBatch.remainingCoins` (que é agregado
 * por organização, não por wallet).
 */
@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  async getWallet(userId: string, organizationId: string): Promise<WalletSummary> {
    const walletId = await this.resolveWalletId(userId, organizationId);
    const [balance, expiring] = await Promise.all([
      this.ledgerService.getBalance(walletId),
      this.getExpiringBatches(walletId),
    ]);

    return { walletId, cachedBalance: balance.cachedBalance, expiring };
  }

  async getEntries(
    userId: string,
    organizationId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: SafeLedgerEntry[]; nextCursor: string | null }> {
    const walletId = await this.resolveWalletId(userId, organizationId);
    return this.ledgerService.getEntries(walletId, options);
  }

  private async resolveWalletId(userId: string, organizationId: string): Promise<string> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { wallet: true },
    });

    if (!membership || membership.status !== 'ACTIVE' || !membership.wallet) {
      throw new MembershipNotFoundException();
    }

    return membership.wallet.id;
  }

  private async getExpiringBatches(walletId: string): Promise<ExpiringBatch[]> {
    const entries = await this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { balanceAfter: true, batchId: true },
    });

    const deltaByBatch = new Map<string, number>();
    let previousBalance = 0;

    for (const entry of entries) {
      const delta = entry.balanceAfter - previousBalance;
      previousBalance = entry.balanceAfter;

      if (entry.batchId) {
        deltaByBatch.set(entry.batchId, (deltaByBatch.get(entry.batchId) ?? 0) + delta);
      }
    }

    const positiveBatchIds = Array.from(deltaByBatch.entries())
      .filter(([, amount]) => amount > 0)
      .map(([batchId]) => batchId);

    if (positiveBatchIds.length === 0) {
      return [];
    }

    const batches = await this.prisma.coinBatch.findMany({ where: { id: { in: positiveBatchIds } } });

    return batches
      .map((batch) => ({
        batchId: batch.id,
        amount: deltaByBatch.get(batch.id) as number,
        expiresAt: batch.expiresAt,
      }))
      .sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime());
  }
}
