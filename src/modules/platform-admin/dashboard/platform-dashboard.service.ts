import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { getUtcMonthRange } from '../../../common/date/utc-month-range.util';

const RANKING_LIMIT = 10;
const RECENT_ACTIVITY_LIMIT = 10;
const TIMESERIES_MONTHS = 12;

interface CoinBatchMonthlyRow {
  month: Date;
  coins_issued: number;
  revenue_in_cents: number;
}

interface LedgerMonthlyRow {
  month: Date;
  coins_redeemed: number;
}

export interface PlatformDashboard {
  cards: {
    organizations: { total: number; active: number; suspended: number; canceled: number };
    partners: { total: number; activeOffers: number };
    coinsInCirculation: number;
    coinsIssuedTotal: number;
    coinsRedeemedTotal: number;
    coinsExpiredTotal: number;
    revenue: { totalInCents: number; currentMonthInCents: number };
  };
  timeseries: {
    months: number;
    points: Array<{ month: string; coinsIssued: number; revenueInCents: number; coinsRedeemed: number }>;
  };
  rankings: {
    topOrganizationsByCoinsIssued: Array<{ organizationId: string; name: string; coinsIssued: number }>;
    topPartnersByConfirmedRedemptions: Array<{
      partnerId: string;
      name: string;
      confirmedRedemptions: number;
      coinsRedeemed: number;
    }>;
  };
  recentActivity: {
    latestBatches: Array<{
      id: string;
      organizationName: string;
      totalCoins: number;
      priceInCents: number;
      status: string;
      createdAt: string;
    }>;
    latestConfirmedRedemptions: Array<{
      id: string;
      partnerName: string;
      offerTitle: string | null;
      amount: number;
      confirmedAt: string;
    }>;
  };
}

/**
 * Visão consolidada da plataforma inteira (todas as organizações) pra platform admin —
 * diferente de DashboardService (src/modules/dashboard/), que é escopado por organizationId
 * do chamador. Leitura pura via Prisma direto, sem estado, sem dependência de outro módulo.
 */
@Injectable()
export class PlatformDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboard(): Promise<PlatformDashboard> {
    const { monthStart, monthEnd } = getUtcMonthRange();

    const [
      organizationsByStatus,
      partnerTotal,
      activeOfferTotal,
      walletAgg,
      issuedAgg,
      redeemedAgg,
      redeemedReversalAgg,
      expiredAgg,
      revenueTotalAgg,
      revenueMonthAgg,
      coinBatchMonthlyRows,
      ledgerMonthlyRows,
      topOrganizationsRaw,
      topPartnersRaw,
      latestBatchesRaw,
      latestConfirmedRedemptionsRaw,
    ] = await Promise.all([
      this.prisma.organization.groupBy({ by: ['status'], _count: true }),
      this.prisma.partner.count(),
      this.prisma.offer.count({ where: { status: 'ACTIVE' } }),
      this.prisma.wallet.aggregate({ _sum: { cachedBalance: true } }),
      this.prisma.coinBatch.aggregate({ _sum: { totalCoins: true }, where: { status: 'PAID' } }),
      this.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: { type: 'DEBIT', referenceType: 'REDEMPTION' },
      }),
      this.prisma.ledgerEntry.aggregate({
        _sum: { amount: true },
        where: { type: 'REVERSAL', reversalOf: { type: 'DEBIT', referenceType: 'REDEMPTION' } },
      }),
      this.prisma.ledgerEntry.aggregate({ _sum: { amount: true }, where: { type: 'EXPIRE' } }),
      this.prisma.coinBatch.aggregate({ _sum: { priceInCents: true }, where: { status: 'PAID' } }),
      this.prisma.coinBatch.aggregate({
        _sum: { priceInCents: true },
        where: { status: 'PAID', updatedAt: { gte: monthStart, lt: monthEnd } },
      }),
      this.prisma.$queryRaw<CoinBatchMonthlyRow[]>`
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', CURRENT_DATE) - (${TIMESERIES_MONTHS - 1}::int) * INTERVAL '1 month',
            date_trunc('month', CURRENT_DATE),
            INTERVAL '1 month'
          )::date AS month
        )
        SELECT
          months.month AS month,
          COALESCE(SUM(cb."totalCoins"), 0)::int AS coins_issued,
          COALESCE(SUM(cb."priceInCents"), 0)::int AS revenue_in_cents
        FROM months
        LEFT JOIN "CoinBatch" cb
          ON date_trunc('month', cb."updatedAt") = months.month
          AND cb.status = 'PAID'
        GROUP BY months.month
        ORDER BY months.month ASC;
      `,
      this.prisma.$queryRaw<LedgerMonthlyRow[]>`
        WITH months AS (
          SELECT generate_series(
            date_trunc('month', CURRENT_DATE) - (${TIMESERIES_MONTHS - 1}::int) * INTERVAL '1 month',
            date_trunc('month', CURRENT_DATE),
            INTERVAL '1 month'
          )::date AS month
        ),
        scoped_entries AS (
          SELECT
            le."type" AS type,
            le."referenceType" AS "referenceType",
            le."amount" AS amount,
            date_trunc('month', le."createdAt")::date AS entry_month,
            ro."type" AS reversal_of_type,
            ro."referenceType" AS reversal_of_reference_type
          FROM "LedgerEntry" le
          LEFT JOIN "LedgerEntry" ro ON ro.id = le."reversalOfId"
          WHERE le."createdAt" >= date_trunc('month', CURRENT_DATE) - (${TIMESERIES_MONTHS - 1}::int) * INTERVAL '1 month'
        )
        SELECT
          months.month AS month,
          (COALESCE(SUM(CASE WHEN se.type = 'DEBIT' AND se."referenceType" = 'REDEMPTION' THEN se.amount END), 0)
            - COALESCE(SUM(CASE WHEN se.type = 'REVERSAL' AND se.reversal_of_type = 'DEBIT' AND se.reversal_of_reference_type = 'REDEMPTION' THEN se.amount END), 0))::int AS coins_redeemed
        FROM months
        LEFT JOIN scoped_entries se ON se.entry_month = months.month
        GROUP BY months.month
        ORDER BY months.month ASC;
      `,
      this.prisma.coinBatch.groupBy({
        by: ['organizationId'],
        _sum: { totalCoins: true },
        where: { status: 'PAID' },
        orderBy: { _sum: { totalCoins: 'desc' } },
        take: RANKING_LIMIT,
      }),
      this.prisma.redemption.groupBy({
        by: ['partnerId'],
        _count: { partnerId: true },
        _sum: { amount: true },
        // DELIVERED é só uma continuação temporal de um CONFIRMED (já debitado) — conta
        // igual pro ranking, nunca desfaz o que o CONFIRMED significou.
        where: { status: { in: ['CONFIRMED', 'DELIVERED'] } },
        orderBy: { _count: { partnerId: 'desc' } },
        take: RANKING_LIMIT,
      }),
      this.prisma.coinBatch.findMany({
        orderBy: { createdAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
        select: {
          id: true,
          totalCoins: true,
          priceInCents: true,
          status: true,
          createdAt: true,
          organization: { select: { name: true } },
        },
      }),
      this.prisma.redemption.findMany({
        where: { status: { in: ['CONFIRMED', 'DELIVERED'] } },
        orderBy: { confirmedAt: 'desc' },
        take: RECENT_ACTIVITY_LIMIT,
        select: {
          id: true,
          amount: true,
          confirmedAt: true,
          partner: { select: { name: true } },
          offer: { select: { title: true } },
        },
      }),
    ]);

    const organizationCounts = { total: 0, active: 0, suspended: 0, canceled: 0 };
    for (const row of organizationsByStatus) {
      organizationCounts.total += row._count;
      if (row.status === 'ACTIVE') organizationCounts.active = row._count;
      if (row.status === 'SUSPENDED') organizationCounts.suspended = row._count;
      if (row.status === 'CANCELED') organizationCounts.canceled = row._count;
    }

    const [topOrganizationNames, topPartnerNames] = await Promise.all([
      this.prisma.organization.findMany({
        where: { id: { in: topOrganizationsRaw.map((row) => row.organizationId) } },
        select: { id: true, name: true },
      }),
      this.prisma.partner.findMany({
        where: { id: { in: topPartnersRaw.map((row) => row.partnerId) } },
        select: { id: true, name: true },
      }),
    ]);
    const organizationNameById = new Map(topOrganizationNames.map((org) => [org.id, org.name]));
    const partnerNameById = new Map(topPartnerNames.map((partner) => [partner.id, partner.name]));

    const coinBatchByMonth = new Map(
      coinBatchMonthlyRows.map((row) => [formatMonth(row.month), row]),
    );
    const ledgerByMonth = new Map(ledgerMonthlyRows.map((row) => [formatMonth(row.month), row]));
    const months = [...coinBatchByMonth.keys()];

    return {
      cards: {
        organizations: organizationCounts,
        partners: { total: partnerTotal, activeOffers: activeOfferTotal },
        coinsInCirculation: walletAgg._sum.cachedBalance ?? 0,
        coinsIssuedTotal: issuedAgg._sum.totalCoins ?? 0,
        coinsRedeemedTotal: (redeemedAgg._sum.amount ?? 0) - (redeemedReversalAgg._sum.amount ?? 0),
        coinsExpiredTotal: expiredAgg._sum.amount ?? 0,
        revenue: {
          totalInCents: revenueTotalAgg._sum.priceInCents ?? 0,
          currentMonthInCents: revenueMonthAgg._sum.priceInCents ?? 0,
        },
      },
      timeseries: {
        months: TIMESERIES_MONTHS,
        points: months.map((month) => ({
          month,
          coinsIssued: coinBatchByMonth.get(month)?.coins_issued ?? 0,
          revenueInCents: coinBatchByMonth.get(month)?.revenue_in_cents ?? 0,
          coinsRedeemed: ledgerByMonth.get(month)?.coins_redeemed ?? 0,
        })),
      },
      rankings: {
        topOrganizationsByCoinsIssued: topOrganizationsRaw.map((row) => ({
          organizationId: row.organizationId,
          name: organizationNameById.get(row.organizationId) ?? '(organização removida)',
          coinsIssued: row._sum.totalCoins ?? 0,
        })),
        topPartnersByConfirmedRedemptions: topPartnersRaw.map((row) => ({
          partnerId: row.partnerId,
          name: partnerNameById.get(row.partnerId) ?? '(parceiro removido)',
          confirmedRedemptions: row._count.partnerId,
          coinsRedeemed: row._sum.amount ?? 0,
        })),
      },
      recentActivity: {
        latestBatches: latestBatchesRaw.map((batch) => ({
          id: batch.id,
          organizationName: batch.organization.name,
          totalCoins: batch.totalCoins,
          priceInCents: batch.priceInCents,
          status: batch.status,
          createdAt: batch.createdAt.toISOString(),
        })),
        latestConfirmedRedemptions: latestConfirmedRedemptionsRaw.map((redemption) => ({
          id: redemption.id,
          partnerName: redemption.partner.name,
          offerTitle: redemption.offer?.title ?? null,
          amount: redemption.amount,
          // confirmedAt sempre é setado junto com status CONFIRMED (RedemptionsService) —
          // a query já filtra status: 'CONFIRMED', então nunca é null aqui.
          confirmedAt: redemption.confirmedAt!.toISOString(),
        })),
      },
    };
  }
}

function formatMonth(month: Date): string {
  return month.toISOString().slice(0, 7);
}
