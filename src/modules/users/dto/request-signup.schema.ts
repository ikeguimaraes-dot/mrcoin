import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Signup só existe como claim de um User PENDING_CLAIM já existente (prova o CPF; a
 * Membership já foi criada pela distribuição). organizationId/membershipType nunca vêm do
 * body — o backend descobre pelas memberships pendentes do CPF (ver SignupService).
 */
export const requestSignupSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(1).optional(),
});

export type RequestSignupInput = z.infer<typeof requestSignupSchema>;
export class RequestSignupDto extends createZodDto(requestSignupSchema) {}
