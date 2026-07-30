import { MembershipType } from '@prisma/client';
import { z } from 'zod';

export const createDistributionSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
  name: z.string().min(1),
  amount: z.number().int().positive(),
  membershipType: z.nativeEnum(MembershipType),
  externalRef: z.string().optional(),
});

export type CreateDistributionInput = z.infer<typeof createDistributionSchema>;
