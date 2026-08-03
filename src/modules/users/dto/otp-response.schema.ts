import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const requestOtpResponseSchema = z.object({
  expiresAt: z.string().datetime(),
});
export class RequestOtpResponseDto extends createZodDto(requestOtpResponseSchema) {}

export const signupSessionResponseSchema = z.object({
  accessToken: z.string(),
  expiresIn: z.number(),
});
export class SignupSessionResponseDto extends createZodDto(signupSessionResponseSchema) {}
