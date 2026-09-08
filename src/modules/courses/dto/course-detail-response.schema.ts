import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const quizStateSchema = z.enum(['LESSONS_PENDING', 'AVAILABLE', 'LOCKED', 'APPROVED']);

export const courseLessonSchema = z.object({
  id: z.string(),
  title: z.string(),
  thumbnailUrl: z.string().nullable(),
  videoUrl: z.string(),
  durationSeconds: z.number().int(),
  displayOrder: z.number().int(),
  completed: z.boolean(),
});

export const courseQuizStateSchema = z.object({
  state: quizStateSchema,
  pendingLessons: z.number().int().nullable(),
  lockedUntil: z.string().datetime().nullable(),
  approvedAt: z.string().datetime().nullable(),
  scorePercent: z.number().int().nullable(),
});

export const courseDetailResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  coverImageUrl: z.string().nullable(),
  lessons: z.array(courseLessonSchema),
  quiz: courseQuizStateSchema.nullable(),
});

export class CourseDetailResponseDto extends createZodDto(courseDetailResponseSchema) {}
