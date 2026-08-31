import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const cardsSchema = z.object({
  organizations: z.object({
    total: z.number().int(),
    active: z.number().int(),
    suspended: z.number().int(),
    canceled: z.number().int(),
  }),
  partners: z.object({
    total: z.number().int(),
    activeOffers: z.number().int(),
  }),
  coinsInCirculation: z.number().int(),
  coinsIssuedTotal: z.number().int(),
  coinsRedeemedTotal: z.number().int(),
  coinsExpiredTotal: z.number().int(),
  revenue: z.object({
    totalInCents: z.number().int(),
    currentMonthInCents: z.number().int(),
  }),
});

const timeseriesPointSchema = z.object({
  month: z.string(), // 'YYYY-MM'
  coinsIssued: z.number().int(),
  revenueInCents: z.number().int(),
  coinsRedeemed: z.number().int(),
});

const timeseriesSchema = z.object({
  months: z.number().int(),
  points: z.array(timeseriesPointSchema),
});

const topOrganizationSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  coinsIssued: z.number().int(),
});

const topPartnerSchema = z.object({
  partnerId: z.string(),
  name: z.string(),
  confirmedRedemptions: z.number().int(),
  coinsRedeemed: z.number().int(),
});

const rankingsSchema = z.object({
  topOrganizationsByCoinsIssued: z.array(topOrganizationSchema),
  topPartnersByConfirmedRedemptions: z.array(topPartnerSchema),
});

const latestBatchSchema = z.object({
  id: z.string(),
  organizationName: z.string(),
  totalCoins: z.number().int(),
  priceInCents: z.number().int(),
  status: z.string(),
  createdAt: z.string().datetime(),
});

const latestConfirmedRedemptionSchema = z.object({
  id: z.string(),
  partnerName: z.string(),
  offerTitle: z.string().nullable(),
  amount: z.number().int(),
  confirmedAt: z.string().datetime(),
});

const recentActivitySchema = z.object({
  latestBatches: z.array(latestBatchSchema),
  latestConfirmedRedemptions: z.array(latestConfirmedRedemptionSchema),
});

export const platformDashboardResponseSchema = z.object({
  cards: cardsSchema,
  timeseries: timeseriesSchema,
  rankings: rankingsSchema,
  recentActivity: recentActivitySchema,
});

export class PlatformDashboardResponseDto extends createZodDto(platformDashboardResponseSchema) {}
