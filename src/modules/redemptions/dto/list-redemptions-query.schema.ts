import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listRedemptionsQuerySchema = z.object({
  organizationId: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListRedemptionsQuery = z.infer<typeof listRedemptionsQuerySchema>;
export class ListRedemptionsQueryDto extends createZodDto(listRedemptionsQuerySchema) {}
