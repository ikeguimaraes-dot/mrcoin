import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { SAFE_LEDGER_ENTRY_SELECT, SafeLedgerEntry } from '../ledger/safe-ledger-entry.util';
import { MembershipNotFoundException } from './exceptions/membership-not-found.exception';

export interface ExpiringBatch {
  batchId: string;
  amount: number;
  expiresAt: Date;
}

const DEFAULT_ENTRIES_PAGE_SIZE = 20;

/** Reconhecimento de uma entrada de distribuição — só o nome de quem reconheceu (nunca
 * e-mail/id do AdminUser). */
export interface EntryRecognition {
  message: string | null;
  recognizedByName: string;
  value: { id: string; name: string } | null;
}

export type WalletEntry = SafeLedgerEntry & { recognition: EntryRecognition | null };

/** Um select aninhado só, resolvido pelo Prisma com uma query `WHERE id IN (...)` por nível
 * de relação pra página inteira — número de queries constante, independente do tamanho da
 * página (sem N+1). */
const WALLET_ENTRY_SELECT = {
  ...SAFE_LEDGER_ENTRY_SELECT,
  distributionItem: {
    select: {
      distribution: {
        select: {
          message: true,
          adminUser: { select: { name: true } },
          organizationValue: { select: { id: true, name: true } },
        },
      },
    },
  },
} satisfies Prisma.LedgerEntrySelect;

type WalletEntryRow = Prisma.LedgerEntryGetPayload<{ select: typeof WALLET_ENTRY_SELECT }>;

/** Distribuição sem message nem valor (anterior ao reconhecimento, ou feita sem eles) não é
 * reconhecimento — `recognition: null`, igual a qualquer entrada que não é distribuição. */
function toWalletEntry(row: WalletEntryRow): WalletEntry {
  const { distributionItem, ...entry } = row;
  const distribution = distributionItem?.distribution;
  const isRecognition = distribution && (distribution.message !== null || distribution.organizationValue !== null);

  return {
    ...entry,
    recognition: isRecognition
      ? {
          message: distribution.message,
          recognizedByName: distribution.adminUser.name,
          value: distribution.organizationValue,
        }
      : null,
  };
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
 *
 * TRANSFER (enviada ou recebida) também fica de fora dos dois — os dois campos medem o
 * relacionamento do usuário com a empresa (quanto ela distribuiu, quanto ele resgatou nos
 * parceiros), não o movimento entre colegas da mesma organização.
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
  ): Promise<{ items: WalletEntry[]; nextCursor: string | null }> {
    const { walletId } = await this.resolveWalletId(userId, organizationId);
    const limit = options?.limit ?? DEFAULT_ENTRIES_PAGE_SIZE;

    // Mesma paginação de LedgerService.getEntries; query própria aqui pra o ledger não
    // precisar saber de reconhecimento (o extrato do admin continua usando o do ledger).
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: WALLET_ENTRY_SELECT,
      ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    });

    const hasMore = rows.length > limit;
    const page = (hasMore ? rows.slice(0, limit) : rows).map(toWalletEntry);
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
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
      this.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: { walletId, type: 'CREDIT', referenceType: { not: 'TRANSFER' } },
      }),
      this.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: { walletId, type: 'REVERSAL', reversalOf: { type: 'CREDIT', referenceType: { not: 'TRANSFER' } } },
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
