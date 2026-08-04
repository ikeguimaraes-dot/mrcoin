import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';

const offerPartnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
});

export const offerCatalogItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  costInCoins: z.number().int(),
  validFrom: z.string().datetime().nullable(),
  validUntil: z.string().datetime().nullable(),
  perUserLimit: z.number().int().nullable(),
  partner: offerPartnerSchema,
});
export class OfferCatalogResponseDto extends createZodDto(offerCatalogItemSchema) {}

export const listOffersCatalogResponseSchema = paginatedResponseSchema(offerCatalogItemSchema);
export class ListOffersCatalogResponseDto extends createZodDto(listOffersCatalogResponseSchema) {}
