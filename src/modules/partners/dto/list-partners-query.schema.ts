import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listPartnersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListPartnersQuery = z.infer<typeof listPartnersQuerySchema>;
export class ListPartnersQueryDto extends createZodDto(listPartnersQuerySchema) {}
