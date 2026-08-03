import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listBatchesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListBatchesQuery = z.infer<typeof listBatchesQuerySchema>;
export class ListBatchesQueryDto extends createZodDto(listBatchesQuerySchema) {}
