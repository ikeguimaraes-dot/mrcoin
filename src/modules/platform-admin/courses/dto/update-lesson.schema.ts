import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateLessonBaseSchema = z.object({
  title: z.string().min(1).optional(),
  videoUrl: z.string().url().optional(),
  durationSeconds: z.number().int().positive().optional(),
  displayOrder: z.number().int().optional(),
});

export const updateLessonSchema = updateLessonBaseSchema.refine(
  (data) =>
    data.title !== undefined ||
    data.videoUrl !== undefined ||
    data.durationSeconds !== undefined ||
    data.displayOrder !== undefined,
  { message: 'Informe ao menos um campo (title, videoUrl, durationSeconds ou displayOrder).' },
);

export type UpdateLessonInput = z.infer<typeof updateLessonSchema>;
export class UpdateLessonDto extends createZodDto(updateLessonBaseSchema) {}
