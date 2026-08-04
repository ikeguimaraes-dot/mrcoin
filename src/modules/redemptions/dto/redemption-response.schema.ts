import { RedemptionStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const redemptionResponseSchema = z.object({
  id: z.string(),
  partnerId: z.string(),
  offerId: z.string().nullable(),
  amount: z.number().int(),
  code: z.string(),
  qrPayload: z.string(),
  status: z.nativeEnum(RedemptionStatus),
  expiresAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
});
export class RedemptionResponseDto extends createZodDto(redemptionResponseSchema) {}
