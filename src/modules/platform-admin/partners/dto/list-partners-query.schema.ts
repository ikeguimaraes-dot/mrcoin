import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listPlatformPartnersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListPlatformPartnersQuery = z.infer<typeof listPlatformPartnersQuerySchema>;
export class ListPlatformPartnersQueryDto extends createZodDto(listPlatformPartnersQuerySchema) {}
