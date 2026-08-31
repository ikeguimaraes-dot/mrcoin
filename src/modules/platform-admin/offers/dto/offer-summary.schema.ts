import { OfferStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../../common/schemas/paginated-response.schema';

/** Mesmo shape pro item de GET /platform/offers e pro detalhe de
 * GET /platform/offers/:id — não há campo a mais no detalhe hoje. */
export const offerSummarySchema = z.object({
  id: z.string(),
  partnerId: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  costInCoins: z.number().int(),
  imageUrl: z.string().nullable(),
  validFrom: z.string().datetime().nullable(),
  validUntil: z.string().datetime().nullable(),
  perUserLimit: z.number().int().nullable(),
  status: z.nativeEnum(OfferStatus),
  partner: z.object({ id: z.string(), name: z.string() }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class OfferSummaryDto extends createZodDto(offerSummarySchema) {}

export const offerListResponseSchema = paginatedResponseSchema(offerSummarySchema);
export class OfferListResponseDto extends createZodDto(offerListResponseSchema) {}
