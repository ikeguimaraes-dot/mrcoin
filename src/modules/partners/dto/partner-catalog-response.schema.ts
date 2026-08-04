import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';

export const partnerCatalogItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export class PartnerCatalogResponseDto extends createZodDto(partnerCatalogItemSchema) {}

export const listPartnersCatalogResponseSchema = paginatedResponseSchema(partnerCatalogItemSchema);
export class ListPartnersCatalogResponseDto extends createZodDto(listPartnersCatalogResponseSchema) {}
