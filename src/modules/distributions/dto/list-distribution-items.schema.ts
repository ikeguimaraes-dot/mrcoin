import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listDistributionItemsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListDistributionItemsQuery = z.infer<typeof listDistributionItemsQuerySchema>;
export class ListDistributionItemsQueryDto extends createZodDto(listDistributionItemsQuerySchema) {}
