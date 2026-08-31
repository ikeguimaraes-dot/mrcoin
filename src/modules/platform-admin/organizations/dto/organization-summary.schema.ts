import { OrganizationPlan, OrganizationStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../../common/schemas/paginated-response.schema';
import { conversionRateSchema } from './conversion-rate.schema';

/** Mesmo shape pro item de GET /platform/organizations e pro detalhe de
 * GET /platform/organizations/:id — não há campo a mais no detalhe hoje. */
export const organizationSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  cnpj: z.string(),
  status: z.nativeEnum(OrganizationStatus),
  plan: z.nativeEnum(OrganizationPlan),
  adminUserCount: z.number().int(),
  memberCount: z.number().int(),
  circulatingBalance: z.number().int(),
  // null só numa organização criada fora do caminho normal (nunca em produção) — a
  // listagem tolera isso em vez de quebrar a página inteira por causa de uma linha ruim.
  conversionRate: conversionRateSchema.nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class OrganizationSummaryDto extends createZodDto(organizationSummarySchema) {}

export const organizationListResponseSchema = paginatedResponseSchema(organizationSummarySchema);
export class OrganizationListResponseDto extends createZodDto(organizationListResponseSchema) {}
