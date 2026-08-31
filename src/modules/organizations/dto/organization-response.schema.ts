import { OrganizationPlan, OrganizationStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { conversionRateSummarySchema } from '../../settings/dto/conversion-rate-summary.schema';

export const organizationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  cnpj: z.string(),
  status: z.nativeEnum(OrganizationStatus),
  plan: z.nativeEnum(OrganizationPlan),
  conversionRate: conversionRateSummarySchema,
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export class OrganizationResponseDto extends createZodDto(organizationResponseSchema) {}
