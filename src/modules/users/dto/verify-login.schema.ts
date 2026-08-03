import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const verifyLoginSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
  code: z.string().regex(/^\d{6}$/, 'Código deve conter 6 dígitos numéricos.'),
});

export type VerifyLoginInput = z.infer<typeof verifyLoginSchema>;
export class VerifyLoginDto extends createZodDto(verifyLoginSchema) {}
