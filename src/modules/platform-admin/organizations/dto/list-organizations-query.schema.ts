import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listOrganizationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListOrganizationsQuery = z.infer<typeof listOrganizationsQuerySchema>;
export class ListOrganizationsQueryDto extends createZodDto(listOrganizationsQuerySchema) {}
