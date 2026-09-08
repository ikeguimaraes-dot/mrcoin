import { CourseStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateCourseBaseSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  // null explícito remove a capa; campo ausente não mexe no valor atual.
  coverImageUrl: z.string().url().nullable().optional(),
  displayOrder: z.number().int().optional(),
  status: z.nativeEnum(CourseStatus).optional(),
});

export const updateCourseSchema = updateCourseBaseSchema.refine(
  (data) =>
    data.title !== undefined ||
    data.description !== undefined ||
    data.coverImageUrl !== undefined ||
    data.displayOrder !== undefined ||
    data.status !== undefined,
  { message: 'Informe ao menos um campo (title, description, coverImageUrl, displayOrder ou status).' },
);

export type UpdateCourseInput = z.infer<typeof updateCourseSchema>;
export class UpdateCourseDto extends createZodDto(updateCourseBaseSchema) {}
