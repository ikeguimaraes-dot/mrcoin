import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getUtcMonthRange } from '../../common/date/utc-month-range.util';
import { MembershipNotFoundException } from './exceptions/membership-not-found.exception';
import { FuturePeriodNotAllowedException } from './exceptions/future-period-not-allowed.exception';

const RANKING_TOP_SIZE = 10;

export interface RankingItem {
  position: number;
  name: string;
  coinsEarned: number;
}

export interface RankingResult {
  items: RankingItem[];
  currentUser: { position: number; coinsEarned: number };
  period: string;
}

interface RosterEntry {
  membershipId: string;
  userId: string;
  walletId: string;
  name: string;
  coinsEarned: number;
  lastEarnedAt: Date | null;
}

/**
 * "Ganho" aqui = CREDIT/DISTRIBUTION líquido de REVERSAL (mesmo par credit/reversal-credit já
 * usado em WalletsService.getLifetimeTotals e DashboardService) — uma distribuição corrigida
 * não deveria contar como ganho de verdade. A reversão abate no mês em que ELA acontece (não
 * retroage pro mês da distribuição original), consistente com a regra já fechada pro
 * dashboard.
 *
 * Desempate por "quem chegou no total primeiro" usa o createdAt do CREDIT mais recente que
 * compõe o total (não do REVERSAL) — o desempate é sobre a conquista, não sobre uma correção
 * posterior.
 */
@Injectable()
export class RankingService {
  constructor(private readonly prisma: PrismaService) {}

  async getRanking(userId: string, organizationId: string, period?: string): Promise<RankingResult> {
    const roster = await this.prisma.membership.findMany({
      where: { organizationId, status: 'ACTIVE' },
      include: { wallet: true, user: true },
    });

    const currentMembership = roster.find((m) => m.userId === userId);
    if (!currentMembership || !currentMembership.wallet) {
      throw new MembershipNotFoundException();
    }

    const reference = this.resolveReferenceDate(period);
    const { monthStart, monthEnd } = getUtcMonthRange(reference);

    const membersWithWallet = roster.filter((m): m is typeof m & { wallet: NonNullable<(typeof m)['wallet']> } => m.wallet !== null);
    const walletIds = membersWithWallet.map((m) => m.wallet.id);

    const [creditRows, reversalRows] = await Promise.all([
      this.prisma.ledgerEntry.groupBy({
        by: ['walletId'],
        where: {
          walletId: { in: walletIds },
          type: 'CREDIT',
          referenceType: 'DISTRIBUTION',
          createdAt: { gte: monthStart, lt: monthEnd },
        },
        _sum: { amount: true },
        _max: { createdAt: true },
      }),
      this.prisma.ledgerEntry.groupBy({
        by: ['walletId'],
        where: {
          walletId: { in: walletIds },
          type: 'REVERSAL',
          reversalOf: { type: 'CREDIT', referenceType: 'DISTRIBUTION' },
          createdAt: { gte: monthStart, lt: monthEnd },
        },
        _sum: { amount: true },
      }),
    ]);

    const creditByWallet = new Map(creditRows.map((row) => [row.walletId, row]));
    const reversalByWallet = new Map(reversalRows.map((row) => [row.walletId, row._sum.amount ?? 0]));

    const entries: RosterEntry[] = membersWithWallet.map((membership) => {
      const credit = creditByWallet.get(membership.wallet.id);
      const reversal = reversalByWallet.get(membership.wallet.id) ?? 0;

      return {
        membershipId: membership.id,
        userId: membership.userId,
        walletId: membership.wallet.id,
        name: membership.user.name,
        coinsEarned: (credit?._sum.amount ?? 0) - reversal,
        lastEarnedAt: credit?._max.createdAt ?? null,
      };
    });

    entries.sort((a, b) => {
      if (a.coinsEarned !== b.coinsEarned) {
        return b.coinsEarned - a.coinsEarned;
      }
      if (a.lastEarnedAt && b.lastEarnedAt) {
        return a.lastEarnedAt.getTime() - b.lastEarnedAt.getTime();
      }
      if (a.lastEarnedAt) {
        return -1;
      }
      if (b.lastEarnedAt) {
        return 1;
      }
      return a.membershipId.localeCompare(b.membershipId);
    });

    const items: RankingItem[] = entries.slice(0, RANKING_TOP_SIZE).map((entry, index) => ({
      position: index + 1,
      name: entry.name,
      coinsEarned: entry.coinsEarned,
    }));

    const currentUserIndex = entries.findIndex((entry) => entry.userId === userId);
    const currentUserEntry = entries[currentUserIndex] as RosterEntry;

    return {
      items,
      currentUser: { position: currentUserIndex + 1, coinsEarned: currentUserEntry.coinsEarned },
      period: `${monthStart.getUTCFullYear()}-${String(monthStart.getUTCMonth() + 1).padStart(2, '0')}`,
    };
  }

  private resolveReferenceDate(period?: string): Date {
    if (!period) {
      return new Date();
    }

    const [yearStr, monthStr] = period.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const reference = new Date(Date.UTC(year, month - 1, 1));

    const now = new Date();
    const currentMonthStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    if (reference.getTime() > currentMonthStart) {
      throw new FuturePeriodNotAllowedException();
    }

    return reference;
  }
}
