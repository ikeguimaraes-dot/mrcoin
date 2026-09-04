import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const redeemSpinResponseSchema = z.object({
  sectorIndex: z.number().int(),
  coinsAwarded: z.number().int(),
});

export class RedeemSpinResponseDto extends createZodDto(redeemSpinResponseSchema) {}
