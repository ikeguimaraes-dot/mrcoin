import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const partnerTokenPairResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number(),
});
export class PartnerTokenPairResponseDto extends createZodDto(partnerTokenPairResponseSchema) {}
