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

/** Extrato do app (GET /wallet/entries): entrada do ledger + dados de reconhecimento, quando
 * a entrada é de uma distribuição com mensagem/valor. Só acrescenta campo — contrato antigo
 * continua válido. */
export const walletEntryItemSchema = ledgerEntryItemSchema.extend({
  recognition: z
    .object({
      message: z.string().nullable(),
      recognizedByName: z.string(),
      value: z.object({ id: z.string(), name: z.string() }).nullable(),
    })
    .nullable(),
});

export const walletEntryListResponseSchema = paginatedResponseSchema(walletEntryItemSchema);
export class WalletEntryListResponseDto extends createZodDto(walletEntryListResponseSchema) {}
