import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { isTrivialPin } from '../transaction-pin.util';

export const setTransactionPinSchema = z.object({
  pin: z
    .string()
    .regex(/^\d{4,6}$/, 'PIN deve conter de 4 a 6 dígitos numéricos.')
    .refine((pin) => !isTrivialPin(pin), 'PIN muito simples — evite dígitos repetidos ou sequências.'),
});

export type SetTransactionPinInput = z.infer<typeof setTransactionPinSchema>;
export class SetTransactionPinDto extends createZodDto(setTransactionPinSchema) {}
