import { z, ZodTypeAny } from 'zod';

/** Envelope de paginação por cursor — mesmo shape repetido em toda listagem do app
 * (`{items, nextCursor}`, ver LedgerService.getEntries e todo `list*` dos services).
 * Uma fábrica só, em vez de redeclarar o envelope em cada schema de resposta. */
export function paginatedResponseSchema<TItem extends ZodTypeAny>(itemSchema: TItem) {
  return z.object({
    items: z.array(itemSchema),
    nextCursor: z.string().nullable(),
  });
}
