import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import {
  organizationValueDescriptionSchema,
  organizationValueNameSchema,
} from './create-organization-value.schema';

export const updateOrganizationValueBaseSchema = z.object({
  name: organizationValueNameSchema.optional(),
  // null explícito remove a descrição; campo ausente não mexe no valor atual.
  description: organizationValueDescriptionSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export const updateOrganizationValueSchema = updateOrganizationValueBaseSchema.refine(
  (data) => Object.values(data).some((field) => field !== undefined),
  { message: 'Informe ao menos um campo (name, description, sortOrder ou isActive).' },
);

export type UpdateOrganizationValueInput = z.infer<typeof updateOrganizationValueSchema>;
export class UpdateOrganizationValueDto extends createZodDto(updateOrganizationValueBaseSchema) {}
