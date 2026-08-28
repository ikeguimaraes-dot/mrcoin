import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const resetPartnerPasswordResponseSchema = z.object({
  credential: z.object({
    password: z.string(),
  }),
});

export class ResetPartnerPasswordResponseDto extends createZodDto(resetPartnerPasswordResponseSchema) {}
