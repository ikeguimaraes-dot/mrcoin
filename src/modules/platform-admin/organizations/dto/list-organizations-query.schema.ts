import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listOrganizationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  /** Busca parcial no nome, case-insensitive. Sem isto, comportamento inalterado. */
  q: z.string().min(1).optional(),
});

export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;
export class ListOrganizationsQueryDto extends createZodDto(listOrganizationsQuerySchema) {}
