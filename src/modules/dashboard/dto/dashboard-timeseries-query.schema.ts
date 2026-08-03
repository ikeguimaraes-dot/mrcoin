import { z } from 'zod';

export const dashboardTimeseriesQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).optional(),
});

export type DashboardTimeseriesQuery = z.infer<typeof dashboardTimeseriesQuerySchema>;
