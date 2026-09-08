import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** videoUrl é genérico de propósito — só valida formato de URL, nunca assume provedor. */
export const createLessonSchema = z.object({
  title: z.string().min(1),
  videoUrl: z.string().url(),
  durationSeconds: z.number().int().positive(),
  displayOrder: z.number().int(),
});

export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export class CreateLessonDto extends createZodDto(createLessonSchema) {}
