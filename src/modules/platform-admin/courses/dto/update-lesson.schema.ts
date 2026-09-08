import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateLessonBaseSchema = z.object({
  title: z.string().min(1).optional(),
  // null explícito remove a miniatura; campo ausente não mexe no valor atual.
  thumbnailUrl: z.string().url().nullable().optional(),
  videoUrl: z.string().url().optional(),
  durationSeconds: z.number().int().positive().optional(),
  displayOrder: z.number().int().optional(),
});

export const updateLessonSchema = updateLessonBaseSchema.refine(
  (data) =>
    data.title !== undefined ||
    data.thumbnailUrl !== undefined ||
    data.videoUrl !== undefined ||
    data.durationSeconds !== undefined ||
    data.displayOrder !== undefined,
  {
    message: 'Informe ao menos um campo (title, thumbnailUrl, videoUrl, durationSeconds ou displayOrder).',
  },
);

export type UpdateLessonInput = z.infer<typeof updateLessonSchema>;
export class UpdateLessonDto extends createZodDto(updateLessonBaseSchema) {}
