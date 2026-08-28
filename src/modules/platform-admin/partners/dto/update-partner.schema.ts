import { PartnerStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updatePlatformPartnerBaseSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.nativeEnum(PartnerStatus).optional(),
});

export const updatePlatformPartnerSchema = updatePlatformPartnerBaseSchema.refine(
  (data) => data.name !== undefined || data.status !== undefined,
  { message: 'Informe ao menos um campo (name ou status).' },
);

export type UpdatePlatformPartnerInput = z.infer<typeof updatePlatformPartnerSchema>;
// Dto usa o schema base (sem .refine) — createZodDto precisa de um ZodObject pra introspecção
// do Swagger; a validação de "ao menos um campo" continua garantida pelo ZodValidationPipe,
// que valida contra updatePlatformPartnerSchema (com refine), não contra este Dto.
export class UpdatePlatformPartnerDto extends createZodDto(updatePlatformPartnerBaseSchema) {}
