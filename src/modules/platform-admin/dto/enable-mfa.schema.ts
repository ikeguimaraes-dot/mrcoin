import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const enableMfaSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'código TOTP deve ter 6 dígitos'),
});

export type EnableMfaInput = z.infer<typeof enableMfaSchema>;
export class EnableMfaDto extends createZodDto(enableMfaSchema) {}
