import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOfferBaseSchema = z.object({
  partnerId: z.string(),
  title: z.string().min(1),
  description: z.string().min(1),
  category: z.string().min(1),
  costInCoins: z.number().int().positive(),
  originalCost: z.number().int().positive().nullable().optional(),
  featured: z.boolean().optional(),
  imageUrl: z.string().url().optional(),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  perUserLimit: z.number().int().positive().optional(),
});

export const createOfferSchema = createOfferBaseSchema.refine(
  (data) => data.originalCost == null || data.originalCost > data.costInCoins,
  { message: 'originalCost deve ser maior que costInCoins.', path: ['originalCost'] },
);

export type CreateOfferInput = z.infer<typeof createOfferSchema>;
export class CreateOfferDto extends createZodDto(createOfferBaseSchema) {}
