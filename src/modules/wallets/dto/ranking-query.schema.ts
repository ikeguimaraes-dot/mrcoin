import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const rankingQuerySchema = z.object({
  organizationId: z.string().min(1),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'period deve ser YYYY-MM').optional(),
});

export type RankingQuery = z.infer<typeof rankingQuerySchema>;
export class RankingQueryDto extends createZodDto(rankingQuerySchema) {}
