import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createCourseSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  coverImageUrl: z.string().url().optional(),
  displayOrder: z.number().int(),
});

export type CreateCourseInput = z.infer<typeof createCourseSchema>;
export class CreateCourseDto extends createZodDto(createCourseSchema) {}
