import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DEFAULT_BATCH_VALIDITY_MONTHS } from '../batches.constants';

export const createBatchSchema = z.object({
  priceInCents: z.number().int().positive(),
  validityMonths: z.number().int().positive().max(60).default(DEFAULT_BATCH_VALIDITY_MONTHS),
});

export type CreateBatchInput = z.infer<typeof createBatchSchema>;
export class CreateBatchDto extends createZodDto(createBatchSchema) {}
