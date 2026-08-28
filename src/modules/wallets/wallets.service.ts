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
  totalEarned: number;
  totalSpent: number;
  expiring: ExpiringBatch[];
}

/**
 * "Coins a expirar" é um FIFO calculado só com os LedgerEntry da própria wallet — soma o
 * delta de cada entry (`balanceAfter_i - balanceAfter_{i-1}`, nunca pelo `type`, porque
 * REVERSAL não tem sinal fixo — mesma técnica do ReconciliationService da Sessão 4) agrupado
 * por `batchId`, mantendo só os lotes com saldo líquido positivo. Não depende do job
 * `expire-coins` (ainda não implementado) nem de `CoinBatch.remainingCoins` (que é agregado
 * por organização, não por wallet).
 *
 * totalEarned/totalSpent (pra home do app) são vitalícios e líquidos de estorno — mesma
 * lógica de "issued"/"redeemed" de dashboard.service.ts, por wallet em vez de organização e
 * sem janela de tempo. EXPIRE fica de fora dos dois de propósito: expirar não é "gastar" (não
 * houve resgate) e não retroage sobre "quanto entrou historicamente" — por isso
 * `totalEarned - totalSpent` pode ficar maior que `cachedBalance` depois de uma expiração;
 * a diferença é exatamente o total expirado, que não é exposto aqui (não foi pedido).
 */
@Injectable()
export class WalletsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  async getWallet(userId: string, organizationId: string): Promise<WalletSummary> {
    const { walletId } = await this.resolveWalletId(userId, organizationId);
    const [balance, expiring, lifetimeTotals] = await Promise.all([
      this.ledgerService.getBalance(walletId),
      this.getExpiringBatches(walletId),
      this.getLifetimeTotals(walletId),
    ]);

    return { walletId, cachedBalance: balance.cachedBalance, ...lifetimeTotals, expiring };
  }

  async getEntries(
    userId: string,
    organizationId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: SafeLedgerEntry[]; nextCursor: string | null }> {
    const { walletId } = await this.resolveWalletId(userId, organizationId);
    return this.ledgerService.getEntries(walletId, options);
  }

  /** Também usado por RedemptionsService — resolve a wallet certa (organização/membership)
   * pra debitar num resgate, mesma checagem de ACTIVE que já vale pro extrato/saldo. */
  async resolveWalletId(userId: string, organizationId: string): Promise<{ membershipId: string; walletId: string }> {
    const membership = await this.prisma.membership.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      include: { wallet: true },
    });

    if (!membership || membership.status !== 'ACTIVE' || !membership.wallet) {
      throw new MembershipNotFoundException();
    }

    return { membershipId: membership.id, walletId: membership.wallet.id };
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

  private async getLifetimeTotals(walletId: string): Promise<{ totalEarned: number; totalSpent: number }> {
    const [creditAgg, creditReversalAgg, redemptionDebitAgg, redemptionReversalAgg] = await Promise.all([
      this.prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { walletId, type: 'CREDIT' } }),
      this.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: { walletId, type: 'REVERSAL', reversalOf: { type: 'CREDIT' } },
      }),
      this.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: { walletId, type: 'DEBIT', referenceType: 'REDEMPTION' },
      }),
      this.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: { walletId, type: 'REVERSAL', reversalOf: { type: 'DEBIT', referenceType: 'REDEMPTION' } },
      }),
    ]);

    return {
      totalEarned: (creditAgg._sum.amount ?? 0) - (creditReversalAgg._sum.amount ?? 0),
      totalSpent: (redemptionDebitAgg._sum.amount ?? 0) - (redemptionReversalAgg._sum.amount ?? 0),
    };
  }
}
