import { z } from 'zod';

export const walletEntriesQuerySchema = z.object({
  organizationId: z.string().min(1),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type WalletEntriesQuery = z.infer<typeof walletEntriesQuerySchema>;
