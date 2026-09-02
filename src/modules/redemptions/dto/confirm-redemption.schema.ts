import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Exatamente um dos dois — cobre tanto o fluxo de digitar/ler em voz alta o código de
 * retirada quanto o de escanear o QR, pelo mesmo endpoint (marcar entregue). */
export const confirmRedemptionSchema = z
  .object({
    pickupCode: z
      .string()
      .regex(/^\d{6}$/, 'Código de retirada inválido.')
      .optional(),
    qrPayload: z.string().min(1).optional(),
  })
  .refine((data) => Boolean(data.pickupCode) !== Boolean(data.qrPayload), {
    message: 'Informe pickupCode OU qrPayload — nunca os dois, nunca nenhum.',
  });

export type ConfirmRedemptionInput = z.infer<typeof confirmRedemptionSchema>;
export class ConfirmRedemptionDto extends createZodDto(confirmRedemptionSchema) {}
