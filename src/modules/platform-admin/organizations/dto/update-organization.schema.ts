import { OrganizationStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updatePlatformOrganizationBaseSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.nativeEnum(OrganizationStatus).optional(),
});

export const updatePlatformOrganizationSchema = updatePlatformOrganizationBaseSchema.refine(
  (data) => data.name !== undefined || data.status !== undefined,
  { message: 'Informe ao menos um campo (name ou status).' },
);

export type UpdatePlatformOrganizationInput = z.infer<typeof updatePlatformOrganizationSchema>;
// Dto usa o schema base (sem .refine) — createZodDto precisa de um ZodObject pra introspecção
// do Swagger; a validação de "ao menos um campo" continua garantida pelo ZodValidationPipe,
// que valida contra updatePlatformOrganizationSchema (com refine), não contra este Dto.
export class UpdatePlatformOrganizationDto extends createZodDto(updatePlatformOrganizationBaseSchema) {}
