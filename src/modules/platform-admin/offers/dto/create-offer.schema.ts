import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOfferSchema = z.object({
  partnerId: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  costInCoins: z.number().int().positive(),
  imageUrl: z.string().url().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
  perUserLimit: z.number().int().positive().optional(),
});

export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export class CreateOfferDto extends createZodDto(createOfferSchema) {}
