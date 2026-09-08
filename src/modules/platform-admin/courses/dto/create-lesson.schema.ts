import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** videoUrl/thumbnailUrl são genéricos de propósito — só validam formato de URL, nunca
 * assumem provedor/CDN. */
export const createLessonSchema = z.object({
  title: z.string().min(1),
  thumbnailUrl: z.string().url().optional(),
  videoUrl: z.string().url(),
  durationSeconds: z.number().int().positive(),
  displayOrder: z.number().int(),
});

export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export class CreateLessonDto extends createZodDto(createLessonSchema) {}
