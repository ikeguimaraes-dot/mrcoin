import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const submitQuizResponseSchema = z.object({
  scorePercent: z.number().int(),
  passed: z.boolean(),
  retryAvailableAt: z.string().datetime().nullable(),
  courseCompletion: z
    .object({
      creditStatus: z.enum(['PENDING', 'CREDITED']),
      coinsAwarded: z.number().int(),
    })
    .nullable(),
});

export class SubmitQuizResponseDto extends createZodDto(submitQuizResponseSchema) {}
