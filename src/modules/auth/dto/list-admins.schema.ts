import { z } from 'zod';

export const listAdminsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListAdminsQuery = z.infer<typeof listAdminsQuerySchema>;
