import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Status restrito aos dois estados vivos da máquina de estados nova (o enum do Prisma
 * ainda carrega PENDING/EXPIRED por razões de migração — ver schema.prisma — mas a
 * aplicação nunca mais produz nenhum dos dois, e o contrato público não deve prometê-los). */
export const redemptionResponseSchema = z.object({
  id: z.string(),
  partnerId: z.string(),
  offerId: z.string().nullable(),
  amount: z.number().int(),
  pickupCode: z.string(),
  qrPayload: z.string(),
  status: z.enum(['CONFIRMED', 'DELIVERED']),
  confirmedAt: z.string().datetime().nullable(),
  deliveredAt: z.string().datetime().nullable(),
});
export class RedemptionResponseDto extends createZodDto(redemptionResponseSchema) {}
