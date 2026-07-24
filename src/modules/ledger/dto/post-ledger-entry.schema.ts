import { z } from 'zod';
import { LedgerReferenceType } from '@prisma/client';

export const postLedgerEntrySchema = z.object({
  walletId: z.string().min(1),
  type: z.enum(['CREDIT', 'DEBIT', 'EXPIRE']),
  amount: z.number().int().positive(),
  referenceType: z.nativeEnum(LedgerReferenceType),
  referenceId: z.string().min(1),
  description: z.string().min(1),
  batchId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(8),
});

export type PostLedgerEntryInput = z.infer<typeof postLedgerEntrySchema>;
