import { MembershipType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { SPIN_GRANT_MAX_QUANTITY } from '../spins.constants';

export const grantSpinsSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
  name: z.string().min(1),
  quantity: z.number().int().positive().max(SPIN_GRANT_MAX_QUANTITY),
  membershipType: z.nativeEnum(MembershipType),
  externalRef: z.string().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export type GrantSpinsInput = z.infer<typeof grantSpinsSchema>;
export class GrantSpinsDto extends createZodDto(grantSpinsSchema) {}
