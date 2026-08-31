import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const conversionRateResponseSchema = z.object({
  coinsPerReal: z.number(),
  effectiveSince: z.string().datetime(),
});

export class ConversionRateResponseDto extends createZodDto(conversionRateResponseSchema) {}
