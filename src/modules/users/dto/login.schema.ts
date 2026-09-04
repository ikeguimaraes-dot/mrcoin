import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Sem checagem de força aqui — login precisa aceitar qualquer senha que já esteja gravada
 * (inclusive uma legada), a checagem de força só faz sentido no momento em que a senha é
 * DEFINIDA (signup/recuperação). O limite de 128 é só higiene contra payload absurdo.
 */
export const loginSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;
export class LoginDto extends createZodDto(loginSchema) {}
