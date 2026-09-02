import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Exatamente um dos três — o platform admin pode ter só o id (veio do dashboard), só o
 * código que o cliente mostrou, ou o QR. */
export const deliverRedemptionSchema = z
  .object({
    redemptionId: z.string().min(1).optional(),
    pickupCode: z
      .string()
      .regex(/^\d{6}$/, 'Código de retirada inválido.')
      .optional(),
    qrPayload: z.string().min(1).optional(),
  })
  .refine((data) => [data.redemptionId, data.pickupCode, data.qrPayload].filter(Boolean).length === 1, {
    message: 'Informe exatamente um entre redemptionId, pickupCode e qrPayload.',
  });

export type DeliverRedemptionInput = z.infer<typeof deliverRedemptionSchema>;
export class DeliverRedemptionDto extends createZodDto(deliverRedemptionSchema) {}
