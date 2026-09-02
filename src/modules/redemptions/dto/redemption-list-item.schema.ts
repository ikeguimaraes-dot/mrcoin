import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Item de GET /redemptions — shape achatado (offerTitle/partnerName em vez de
 * offerId/partnerId cru) pro app não precisar de outra chamada só pra exibir a lista. */
export const redemptionListItemSchema = z.object({
  id: z.string(),
  status: z.enum(['CONFIRMED', 'DELIVERED']),
  pickupCode: z.string(),
  qrPayload: z.string(),
  amount: z.number().int(),
  createdAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
  offerTitle: z.string().nullable(),
  partnerName: z.string(),
});

export const redemptionListResponseSchema = z.object({
  items: z.array(redemptionListItemSchema),
  nextCursor: z.string().nullable(),
});

export class RedemptionListResponseDto extends createZodDto(redemptionListResponseSchema) {}
