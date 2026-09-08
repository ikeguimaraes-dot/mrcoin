import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Sem isCorrect de propósito — nunca sai pro app (ver plano da feature). */
export const quizOptionPublicSchema = z.object({
  id: z.string(),
  text: z.string(),
  displayOrder: z.number().int(),
});

export const quizQuestionPublicSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  displayOrder: z.number().int(),
  options: z.array(quizOptionPublicSchema),
});

export const quizResponseSchema = z.object({
  questions: z.array(quizQuestionPublicSchema),
});

export class QuizResponseDto extends createZodDto(quizResponseSchema) {}
