import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listMembersQuerySchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.').optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
export class ListMembersQueryDto extends createZodDto(listMembersQuerySchema) {}
