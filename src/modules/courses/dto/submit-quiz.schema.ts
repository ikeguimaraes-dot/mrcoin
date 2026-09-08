import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const submitQuizSchema = z.object({
  organizationId: z.string().min(1),
  answers: z
    .array(
      z.object({
        questionId: z.string().min(1),
        selectedOptionId: z.string().min(1),
      }),
    )
    .min(1),
});

export type SubmitQuizInput = z.infer<typeof submitQuizSchema>;
export class SubmitQuizDto extends createZodDto(submitQuizSchema) {}
