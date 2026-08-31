import { OrganizationPlan, OrganizationStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { conversionRateSchema } from './conversion-rate.schema';

export const createOrganizationResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  cnpj: z.string(),
  status: z.nativeEnum(OrganizationStatus),
  plan: z.nativeEnum(OrganizationPlan),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  invite: z.object({
    id: z.string(),
    expiresAt: z.string().datetime(),
    inviteLink: z.string(),
  }),
  conversionRate: conversionRateSchema,
});

export class CreateOrganizationResponseDto extends createZodDto(createOrganizationResponseSchema) {}
