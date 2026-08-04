import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const dashboardSummaryResponseSchema = z.object({
  availableBalance: z.number().int(),
  circulatingBalance: z.number().int(),
  redeemedThisMonth: z.number().int(),
});
export class DashboardSummaryResponseDto extends createZodDto(dashboardSummaryResponseSchema) {}

export const dashboardTimeseriesResponseSchema = z.object({
  days: z.number().int(),
  points: z.array(
    z.object({
      date: z.string(),
      issued: z.number().int(),
      redeemed: z.number().int(),
    }),
  ),
});
export class DashboardTimeseriesResponseDto extends createZodDto(dashboardTimeseriesResponseSchema) {}
