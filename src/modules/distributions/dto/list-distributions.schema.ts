import { z } from 'zod';

export const listDistributionsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListDistributionsQuery = z.infer<typeof listDistributionsQuerySchema>;
