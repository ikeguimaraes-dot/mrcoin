import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listOffersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  partnerId: z.string().optional(),
});

export type ListOffersQuery = z.infer<typeof listOffersQuerySchema>;
export class ListOffersQueryDto extends createZodDto(listOffersQuerySchema) {}
