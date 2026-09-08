import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const optionSchema = z.object({
  text: z.string().min(1),
  isCorrect: z.boolean(),
  displayOrder: z.number().int(),
});

/** Exatamente uma alternativa correta por questão — múltipla escolha de resposta única. */
function exactlyOneCorrect(options: z.infer<typeof optionSchema>[]): boolean {
  return options.filter((o) => o.isCorrect).length === 1;
}

export const quizQuestionSchema = z
  .object({
    prompt: z.string().min(1),
    displayOrder: z.number().int(),
    options: z.array(optionSchema).min(2),
  })
  .refine((data) => exactlyOneCorrect(data.options), {
    message: 'Exatamente uma alternativa deve ser marcada como correta.',
    path: ['options'],
  });

export type QuizQuestionInput = z.infer<typeof quizQuestionSchema>;
export class QuizQuestionDto extends createZodDto(
  z.object({ prompt: z.string().min(1), displayOrder: z.number().int(), options: z.array(optionSchema).min(2) }),
) {}
