import { BatchStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';

export const coinBatchItemSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  totalCoins: z.number().int(),
  remainingCoins: z.number().int(),
  priceInCents: z.number().int(),
  status: z.nativeEnum(BatchStatus),
  rejectionReason: z.string().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

/** ASAAS = QR dinâmico gerado pelo PSP (fluxo legado, ASAAS_ENABLED=true). MANUAL = chave
 * Pix fixa da mrcoin + valor exato (fluxo padrão — a empresa paga por fora, um platform
 * admin aprova depois). `method` discrimina qual dos dois o client recebeu. */
export const asaasPixInfoSchema = z.object({
  method: z.literal('ASAAS'),
  qrCodeImage: z.string(),
  copyPasteCode: z.string(),
  expirationDate: z.string(),
});

export const manualPixInfoSchema = z.object({
  method: z.literal('MANUAL'),
  pixKey: z.string(),
  amountInCents: z.number().int(),
});

export const pixInfoSchema = z.discriminatedUnion('method', [asaasPixInfoSchema, manualPixInfoSchema]);

export const createBatchResponseSchema = z.object({
  batch: coinBatchItemSchema,
  pix: pixInfoSchema.nullable(),
});
export class CreateBatchResponseDto extends createZodDto(createBatchResponseSchema) {}

export const listBatchesResponseSchema = paginatedResponseSchema(coinBatchItemSchema);
export class ListBatchesResponseDto extends createZodDto(listBatchesResponseSchema) {}
