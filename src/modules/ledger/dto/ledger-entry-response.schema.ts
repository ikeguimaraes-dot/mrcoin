import { LedgerEntryType, LedgerReferenceType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';

export const ledgerEntryItemSchema = z.object({
  id: z.string(),
  walletId: z.string(),
  type: z.nativeEnum(LedgerEntryType),
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  referenceType: z.nativeEnum(LedgerReferenceType),
  referenceId: z.string(),
  batchId: z.string().nullable(),
  distributionItemId: z.string().nullable(),
  description: z.string(),
  reversalOfId: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const ledgerEntryListResponseSchema = paginatedResponseSchema(ledgerEntryItemSchema);
export class LedgerEntryListResponseDto extends createZodDto(ledgerEntryListResponseSchema) {}
