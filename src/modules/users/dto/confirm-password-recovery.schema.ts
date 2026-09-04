import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isTrivialPassword, passwordContainsCpf, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../password-rules.util';

export const confirmPasswordRecoverySchema = z
  .object({
    cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
    code: z.string().regex(/^\d{6}$/, 'Código deve conter 6 dígitos numéricos.'),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `Senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`)
      .max(PASSWORD_MAX_LENGTH, `Senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`),
  })
  .superRefine((data, ctx) => {
    if (isTrivialPassword(data.newPassword)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newPassword'], message: 'Senha muito comum ou previsível.' });
    }
    if (passwordContainsCpf(data.newPassword, data.cpf)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['newPassword'], message: 'Senha não pode conter o CPF.' });
    }
  });

export type ConfirmPasswordRecoveryInput = z.infer<typeof confirmPasswordRecoverySchema>;
export class ConfirmPasswordRecoveryDto extends createZodDto(confirmPasswordRecoverySchema) {}
