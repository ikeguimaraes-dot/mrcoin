import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const conversionRateSchema = z.object({
  coinsPerReal: z.number(),
  effectiveSince: z.string().datetime(),
});

export class ConversionRateDto extends createZodDto(conversionRateSchema) {}

export const updateConversionRateSchema = z.object({
  coinsPerReal: z.number().positive().max(1000),
});

export type UpdateConversionRateInput = z.infer<typeof updateConversionRateSchema>;
export class UpdateConversionRateDto extends createZodDto(updateConversionRateSchema) {}
