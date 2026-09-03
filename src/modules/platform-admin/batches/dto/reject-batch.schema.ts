import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const rejectBatchSchema = z.object({
  reason: z.string().min(1).optional(),
});

export type RejectBatchInput = z.infer<typeof rejectBatchSchema>;
export class RejectBatchDto extends createZodDto(rejectBatchSchema) {}
