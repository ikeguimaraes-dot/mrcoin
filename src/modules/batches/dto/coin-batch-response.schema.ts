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
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const pixInfoSchema = z.object({
  qrCodeImage: z.string(),
  copyPasteCode: z.string(),
  expirationDate: z.string(),
});

export const createBatchResponseSchema = z.object({
  batch: coinBatchItemSchema,
  pix: pixInfoSchema.nullable(),
});
export class CreateBatchResponseDto extends createZodDto(createBatchResponseSchema) {}

export const listBatchesResponseSchema = paginatedResponseSchema(coinBatchItemSchema);
export class ListBatchesResponseDto extends createZodDto(listBatchesResponseSchema) {}
