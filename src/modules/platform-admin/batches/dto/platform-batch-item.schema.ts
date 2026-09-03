import { BatchStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../../common/schemas/paginated-response.schema';

export const platformBatchItemSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  totalCoins: z.number().int(),
  priceInCents: z.number().int(),
  status: z.nativeEnum(BatchStatus),
  rejectionReason: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const platformBatchListResponseSchema = paginatedResponseSchema(platformBatchItemSchema);
export class PlatformBatchListResponseDto extends createZodDto(platformBatchListResponseSchema) {}
export class PlatformBatchItemDto extends createZodDto(platformBatchItemSchema) {}
