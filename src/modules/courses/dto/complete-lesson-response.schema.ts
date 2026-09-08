import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const completeLessonResponseSchema = z.object({
  completed: z.literal(true),
});

export class CompleteLessonResponseDto extends createZodDto(completeLessonResponseSchema) {}
