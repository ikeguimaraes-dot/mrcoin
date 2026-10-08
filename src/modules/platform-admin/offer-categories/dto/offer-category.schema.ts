import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const slugSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use letras minúsculas, números e hífens.');

export const createOfferCategorySchema = z.object({
  name: z.string().trim().min(1),
  slug: slugSchema,
});
export type CreateOfferCategoryInput = z.infer<typeof createOfferCategorySchema>;
export class CreateOfferCategoryDto extends createZodDto(createOfferCategorySchema) {}

export const updateOfferCategorySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    slug: slugSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((value) => value !== undefined), {
    message: 'Informe ao menos um campo para atualizar.',
  });
export type UpdateOfferCategoryInput = z.infer<typeof updateOfferCategorySchema>;

export const updateOfferCategoryBaseSchema = z.object({
  name: z.string().trim().min(1).optional(),
  slug: slugSchema.optional(),
  active: z.boolean().optional(),
});
export class UpdateOfferCategoryDto extends createZodDto(updateOfferCategoryBaseSchema) {}

export const offerCategoryResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  active: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export class OfferCategoryResponseDto extends createZodDto(offerCategoryResponseSchema) {}

export const offerCategoryListResponseSchema = z.object({
  items: z.array(offerCategoryResponseSchema),
});
export class OfferCategoryListResponseDto extends createZodDto(offerCategoryListResponseSchema) {}

export const listOfferCategoriesQuerySchema = z.object({
  includeInactive: z.enum(['true', 'false']).optional(),
});
export type ListOfferCategoriesQuery = z.infer<typeof listOfferCategoriesQuerySchema>;
export class ListOfferCategoriesQueryDto extends createZodDto(listOfferCategoriesQuerySchema) {}
