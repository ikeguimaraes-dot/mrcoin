import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  ORGANIZATION_VALUE_DESCRIPTION_MAX_LENGTH,
  ORGANIZATION_VALUE_NAME_MAX_LENGTH,
} from '../organization-values.constants';

export const organizationValueNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_VALUE_NAME_MAX_LENGTH);
export const organizationValueDescriptionSchema = z
  .string()
  .trim()
  .min(1)
  .max(ORGANIZATION_VALUE_DESCRIPTION_MAX_LENGTH);

export const createOrganizationValueSchema = z.object({
  name: organizationValueNameSchema,
  description: organizationValueDescriptionSchema.optional(),
  // Ausente = entra no fim da lista (maior sortOrder da organização + 1).
  sortOrder: z.number().int().min(0).optional(),
});

export type CreateOrganizationValueInput = z.infer<typeof createOrganizationValueSchema>;
export class CreateOrganizationValueDto extends createZodDto(createOrganizationValueSchema) {}
