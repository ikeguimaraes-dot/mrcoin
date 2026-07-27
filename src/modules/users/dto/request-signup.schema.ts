import { MembershipType } from '@prisma/client';
import { z } from 'zod';

export const requestSignupSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
  organizationId: z.string().min(1),
  membershipType: z.nativeEnum(MembershipType),
  externalRef: z.string().min(1).optional(),
});

export type RequestSignupInput = z.infer<typeof requestSignupSchema>;
