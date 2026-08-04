import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.enum(['ok', 'error']),
  db: z.enum(['ok', 'error']),
  timestamp: z.string().datetime(),
});
export class HealthResponseDto extends createZodDto(healthResponseSchema) {}
