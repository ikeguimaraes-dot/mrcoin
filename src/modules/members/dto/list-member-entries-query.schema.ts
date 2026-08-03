import { z } from 'zod';

export const listMemberEntriesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListMemberEntriesQuery = z.infer<typeof listMemberEntriesQuerySchema>;
