import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listPlatformOffersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  partnerId: z.string().optional(),
});

export type ListPlatformOffersQuery = z.infer<typeof listPlatformOffersQuerySchema>;
export class ListPlatformOffersQueryDto extends createZodDto(listPlatformOffersQuerySchema) {}
