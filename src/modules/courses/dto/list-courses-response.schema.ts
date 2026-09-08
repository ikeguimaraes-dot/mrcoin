import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const courseProgressSchema = z.enum(['NOT_STARTED', 'IN_PROGRESS', 'COMPLETED']);

export const courseListItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  coverImageUrl: z.string().nullable(),
  displayOrder: z.number().int(),
  progress: courseProgressSchema,
});

export const listCoursesResponseSchema = z.object({
  items: z.array(courseListItemSchema),
});

export class ListCoursesResponseDto extends createZodDto(listCoursesResponseSchema) {}
