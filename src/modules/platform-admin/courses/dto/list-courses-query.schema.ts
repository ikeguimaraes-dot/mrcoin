import { CourseStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listPlatformCoursesQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  status: z.nativeEnum(CourseStatus).optional(),
});

export type ListPlatformCoursesQuery = z.infer<typeof listPlatformCoursesQuerySchema>;
export class ListPlatformCoursesQueryDto extends createZodDto(listPlatformCoursesQuerySchema) {}
