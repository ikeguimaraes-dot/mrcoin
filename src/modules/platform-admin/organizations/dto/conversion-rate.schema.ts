import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { conversionRateSummarySchema, ConversionRateSummaryDto } from '../../../settings/dto/conversion-rate-summary.schema';

export { conversionRateSummarySchema as conversionRateSchema, ConversionRateSummaryDto as ConversionRateDto };

export const updateConversionRateSchema = z.object({
  coinsPerReal: z.number().positive().max(1000),
});

export type UpdateConversionRateInput = z.infer<typeof updateConversionRateSchema>;
export class UpdateConversionRateDto extends createZodDto(updateConversionRateSchema) {}
