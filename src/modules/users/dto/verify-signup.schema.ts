import { z } from 'zod';

export const verifySignupSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
  organizationId: z.string().min(1),
  code: z.string().regex(/^\d{6}$/, 'Código deve conter 6 dígitos numéricos.'),
});

export type VerifySignupInput = z.infer<typeof verifySignupSchema>;
