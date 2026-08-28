import { OrganizationPlan, OrganizationStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

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
});

export class CreateOrganizationResponseDto extends createZodDto(createOrganizationResponseSchema) {}
