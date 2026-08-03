import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const requestLoginSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
});

export type RequestLoginInput = z.infer<typeof requestLoginSchema>;
export class RequestLoginDto extends createZodDto(requestLoginSchema) {}
