import { BatchStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listPlatformBatchesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.nativeEnum(BatchStatus).optional(),
});

export type ListPlatformBatchesQuery = z.infer<typeof listPlatformBatchesQuerySchema>;
export class ListPlatformBatchesQueryDto extends createZodDto(listPlatformBatchesQuerySchema) {}
