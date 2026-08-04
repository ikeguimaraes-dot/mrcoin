import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const requestOtpResponseSchema = z.object({
  expiresAt: z.string().datetime(),
});
export class RequestOtpResponseDto extends createZodDto(requestOtpResponseSchema) {}

export const userTokenPairResponseSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number(),
});
export class UserTokenPairResponseDto extends createZodDto(userTokenPairResponseSchema) {}
