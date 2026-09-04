import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const requestPasswordRecoverySchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
});

export type RequestPasswordRecoveryInput = z.infer<typeof requestPasswordRecoverySchema>;
export class RequestPasswordRecoveryDto extends createZodDto(requestPasswordRecoverySchema) {}
