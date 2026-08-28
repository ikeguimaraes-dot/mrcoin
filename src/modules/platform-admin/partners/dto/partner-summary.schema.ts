import { PartnerStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../../common/schemas/paginated-response.schema';

/** Mesmo shape pro item de GET /platform/partners e pro detalhe de
 * GET /platform/partners/:id — não há campo a mais no detalhe hoje. */
export const partnerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  cnpj: z.string(),
  category: z.string(),
  takeRateBps: z.number().int(),
  pixKey: z.string(),
  status: z.nativeEnum(PartnerStatus),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  offerCount: z.number().int(),
  confirmedRedemptionCount: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class PartnerSummaryDto extends createZodDto(partnerSummarySchema) {}

export const partnerListResponseSchema = paginatedResponseSchema(partnerSummarySchema);
export class PartnerListResponseDto extends createZodDto(partnerListResponseSchema) {}
