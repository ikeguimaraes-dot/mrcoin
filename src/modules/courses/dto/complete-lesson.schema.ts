import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const completeLessonSchema = z.object({
  organizationId: z.string().min(1),
});

export type CompleteLessonInput = z.infer<typeof completeLessonSchema>;
export class CompleteLessonDto extends createZodDto(completeLessonSchema) {}
