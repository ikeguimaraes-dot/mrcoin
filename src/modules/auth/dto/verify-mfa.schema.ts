import { z } from 'zod';

export const verifyMfaSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'código TOTP deve ter 6 dígitos'),
});

export type VerifyMfaInput = z.infer<typeof verifyMfaSchema>;
