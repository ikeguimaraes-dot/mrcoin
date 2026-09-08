import { CourseStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../../common/schemas/paginated-response.schema';

export const courseSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  coverImageUrl: z.string().nullable(),
  displayOrder: z.number().int(),
  status: z.nativeEnum(CourseStatus),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export class CourseSummaryDto extends createZodDto(courseSummarySchema) {}

export const courseListResponseSchema = paginatedResponseSchema(courseSummarySchema);
export class CourseListResponseDto extends createZodDto(courseListResponseSchema) {}

export const lessonAdminSchema = z.object({
  id: z.string(),
  title: z.string(),
  videoUrl: z.string(),
  durationSeconds: z.number().int(),
  displayOrder: z.number().int(),
});

/** Visão de admin — inclui isCorrect (nunca sai pro app do funcionário, ver módulo courses). */
export const quizOptionAdminSchema = z.object({
  id: z.string(),
  text: z.string(),
  isCorrect: z.boolean(),
  displayOrder: z.number().int(),
});

export const quizQuestionAdminSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  displayOrder: z.number().int(),
  options: z.array(quizOptionAdminSchema),
});

export const courseDetailAdminSchema = courseSummarySchema.extend({
  lessons: z.array(lessonAdminSchema),
  quiz: z.object({ id: z.string(), questions: z.array(quizQuestionAdminSchema) }).nullable(),
});
export class CourseDetailAdminDto extends createZodDto(courseDetailAdminSchema) {}
