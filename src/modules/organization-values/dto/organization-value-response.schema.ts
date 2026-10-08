import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listOrganizationValuesQuerySchema = z.object({
  // Sem .transform(): com ele o nestjs-zod publica o parâmetro como obrigatório no Swagger
  // (usa o tipo de saída). A conversão pra boolean fica no service.
  includeInactive: z.enum(['true', 'false']).optional(),
});

export type ListOrganizationValuesQuery = z.infer<typeof listOrganizationValuesQuerySchema>;
export class ListOrganizationValuesQueryDto extends createZodDto(
  listOrganizationValuesQuerySchema,
) {}

export const organizationValueResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class OrganizationValueResponseDto extends createZodDto(organizationValueResponseSchema) {}

export const organizationValueListResponseSchema = z.object({
  items: z.array(organizationValueResponseSchema),
});
export class OrganizationValueListResponseDto extends createZodDto(
  organizationValueListResponseSchema,
) {}
