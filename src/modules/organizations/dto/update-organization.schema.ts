import { OrganizationPlan } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateOrganizationBaseSchema = z.object({
  name: z.string().min(1).optional(),
  plan: z.nativeEnum(OrganizationPlan).optional(),
});

export const updateOrganizationSchema = updateOrganizationBaseSchema.refine(
  (data) => data.name !== undefined || data.plan !== undefined,
  { message: 'Informe ao menos um campo (name ou plan).' },
);

export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
// Dto usa o schema base (sem .refine) — createZodDto precisa de um ZodObject pra introspecção
// do Swagger; a validação de "ao menos um campo" continua garantida pelo ZodValidationPipe,
// que valida contra updateOrganizationSchema (com refine), não contra este Dto.
export class UpdateOrganizationDto extends createZodDto(updateOrganizationBaseSchema) {}
