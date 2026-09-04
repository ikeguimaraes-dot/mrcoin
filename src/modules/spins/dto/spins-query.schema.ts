import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const spinsQuerySchema = z.object({
  organizationId: z.string().min(1),
});

export type SpinsQuery = z.infer<typeof spinsQuerySchema>;
export class SpinsQueryDto extends createZodDto(spinsQuerySchema) {}
