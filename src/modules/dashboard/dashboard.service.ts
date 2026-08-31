import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getUtcMonthRange } from '../../common/date/utc-month-range.util';

export interface DashboardSummary {
  availableBalance: number;
  circulatingBalance: number;
  redeemedThisMonth: number;
}

export interface DashboardTimeseriesPoint {
  date: string;
  issued: number;
  redeemed: number;
}

export interface DashboardTimeseries {
  days: number;
  points: DashboardTimeseriesPoint[];
}

interface TimeseriesRow {
  day: Date;
  issued: number | bigint;
  redeemed: number | bigint;
}

/**
 * "Saldo disponível" e "coins em circulação" seguem as definições fechadas com o produto
 * (Sessão 12): remainingCoins dos lotes PAID vs. cachedBalance das wallets da org.
 * "Resgatado" (summary e série) é líquido de estorno — soma DEBIT/REDEMPTION menos REVERSAL
 * cujo original é DEBIT/REDEMPTION, cada lado pela própria createdAt (a reversão abate no
 * mês/dia em que ELA acontece, não retroage pro mês do resgate original — confirmado com o
 * produto). Mesma lógica net-de-reversão aplicada em "issued" (CREDIT) na série temporal, por
 * simetria. Não existe módulo `redemptions` ainda (só o model Prisma) — `redeemedThisMonth` e
 * a série `redeemed` sempre voltam 0 na prática até ele existir; a query já fica correta pra
 * quando existir, sem precisar mudar nada aqui.
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(organizationId: string): Promise<DashboardSummary> {
    const { monthStart, monthEnd } = getUtcMonthRange();

    const [batchAgg, walletAgg, debitAgg, reversalAgg] = await Promise.all([
      this.prisma.coinBatch.aggregate({
        _sum: { remainingCoins: true },
        where: { organizationId, status: 'PAID' },
      }),
      this.prisma.wallet.aggregate({
        _sum: { cachedBalance: true },
        where: { membership: { organizationId } },
      }),
      this.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: {
          type: 'DEBIT',
          referenceType: 'REDEMPTION',
          createdAt: { gte: monthStart, lt: monthEnd },
          wallet: { membership: { organizationId } },
        },
      }),
      this.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: {
          type: 'REVERSAL',
          reversalOf: { type: 'DEBIT', referenceType: 'REDEMPTION' },
          createdAt: { gte: monthStart, lt: monthEnd },
          wallet: { membership: { organizationId } },
        },
      }),
    ]);

    return {
      availableBalance: batchAgg._sum.remainingCoins ?? 0,
      circulatingBalance: walletAgg._sum.cachedBalance ?? 0,
      redeemedThisMonth: (debitAgg._sum.amount ?? 0) - (reversalAgg._sum.amount ?? 0),
    };
  }

  async getTimeseries(organizationId: string, days: number): Promise<DashboardTimeseries> {
    const rows = await this.prisma.$queryRaw<TimeseriesRow[]>`
      WITH days AS (
        SELECT generate_series(
          (CURRENT_DATE - (${days}::int - 1) * INTERVAL '1 day')::date,
          CURRENT_DATE::date,
          INTERVAL '1 day'
        )::date AS day
      ),
      scoped_entries AS (
        SELECT
          le."type" AS type,
          le."referenceType" AS "referenceType",
          le."amount" AS amount,
          le."createdAt"::date AS entry_day,
          ro."type" AS reversal_of_type,
          ro."referenceType" AS reversal_of_reference_type
        FROM "LedgerEntry" le
        INNER JOIN "Wallet" w ON w.id = le."walletId"
        INNER JOIN "Membership" m ON m.id = w."membershipId"
        LEFT JOIN "LedgerEntry" ro ON ro.id = le."reversalOfId"
        WHERE m."organizationId" = ${organizationId}
          AND le."createdAt" >= (CURRENT_DATE - (${days}::int - 1) * INTERVAL '1 day')
      )
      SELECT
        days.day AS day,
        (COALESCE(SUM(CASE WHEN se.type = 'CREDIT' THEN se.amount END), 0)
          - COALESCE(SUM(CASE WHEN se.type = 'REVERSAL' AND se.reversal_of_type = 'CREDIT' THEN se.amount END), 0))::int AS issued,
        (COALESCE(SUM(CASE WHEN se.type = 'DEBIT' AND se."referenceType" = 'REDEMPTION' THEN se.amount END), 0)
          - COALESCE(SUM(CASE WHEN se.type = 'REVERSAL' AND se.reversal_of_type = 'DEBIT' AND se.reversal_of_reference_type = 'REDEMPTION' THEN se.amount END), 0))::int AS redeemed
      FROM days
      LEFT JOIN scoped_entries se ON se.entry_day = days.day
      GROUP BY days.day
      ORDER BY days.day ASC;
    `;

    return {
      days,
      points: rows.map((row) => ({
        date: row.day.toISOString().slice(0, 10),
        issued: Number(row.issued),
        redeemed: Number(row.redeemed),
      })),
    };
  }
}
