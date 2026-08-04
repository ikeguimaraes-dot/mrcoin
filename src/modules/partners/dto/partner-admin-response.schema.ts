import { PartnerStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';

export const partnerAdminItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  cnpj: z.string(),
  category: z.string(),
  status: z.nativeEnum(PartnerStatus),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export class PartnerAdminResponseDto extends createZodDto(partnerAdminItemSchema) {}

export const listPartnersAdminResponseSchema = paginatedResponseSchema(partnerAdminItemSchema);
export class ListPartnersAdminResponseDto extends createZodDto(listPartnersAdminResponseSchema) {}
