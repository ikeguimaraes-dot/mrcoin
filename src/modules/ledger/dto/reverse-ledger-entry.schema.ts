import { z } from 'zod';

export const reverseLedgerEntrySchema = z.object({
  entryId: z.string().min(1),
  reason: z.string().min(1),
  idempotencyKey: z.string().min(8),
});

export type ReverseLedgerEntryInput = z.infer<typeof reverseLedgerEntrySchema>;
