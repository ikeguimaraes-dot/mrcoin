import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const tokenPairSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
});
export class TokenPairDto extends createZodDto(tokenPairSchema) {}
