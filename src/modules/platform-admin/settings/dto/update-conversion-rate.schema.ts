import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateConversionRateSchema = z.object({
  coinsPerReal: z.number().positive().max(1000),
});

export type UpdateConversionRateInput = z.infer<typeof updateConversionRateSchema>;
export class UpdateConversionRateDto extends createZodDto(updateConversionRateSchema) {}
