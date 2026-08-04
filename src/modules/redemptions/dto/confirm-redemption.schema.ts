import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Exatamente um dos dois — cobre tanto o fluxo de digitar/ler em voz alta o código de 6
 * dígitos quanto o de escanear o QR, pelo mesmo endpoint. */
export const confirmRedemptionSchema = z
  .object({
    code: z.string().regex(/^\d{6}$/, 'Código deve conter 6 dígitos numéricos.').optional(),
    qrPayload: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.code) !== Boolean(data.qrPayload), {
    message: 'Informe code OU qrPayload — nunca os dois, nunca nenhum.',
  });

export type ConfirmRedemptionInput = z.infer<typeof confirmRedemptionSchema>;
export class ConfirmRedemptionDto extends createZodDto(confirmRedemptionSchema) {}
