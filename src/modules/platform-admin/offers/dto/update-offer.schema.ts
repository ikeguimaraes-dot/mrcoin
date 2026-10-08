import { OfferStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updatePlatformOfferBaseSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  costInCoins: z.number().int().positive().optional(),
  originalCost: z.number().int().positive().nullable().optional(),
  featured: z.boolean().optional(),
  // null explícito remove a imagem; campo ausente não mexe no valor atual.
  imageUrl: z.string().url().nullable().optional(),
  validUntil: z.string().datetime().nullable().optional(),
  status: z.nativeEnum(OfferStatus).optional(),
});

export const updatePlatformOfferSchema = updatePlatformOfferBaseSchema.refine(
  (data) =>
    data.title !== undefined ||
    data.description !== undefined ||
    data.category !== undefined ||
    data.costInCoins !== undefined ||
    data.originalCost !== undefined ||
    data.featured !== undefined ||
    data.imageUrl !== undefined ||
    data.validUntil !== undefined ||
    data.status !== undefined,
  { message: 'Informe ao menos um campo para atualizar.' },
);

export type UpdatePlatformOfferInput = z.infer<typeof updatePlatformOfferSchema>;
// Dto usa o schema base (sem .refine) — createZodDto precisa de um ZodObject pra introspecção
// do Swagger; a validação de "ao menos um campo" continua garantida pelo ZodValidationPipe,
// que valida contra updatePlatformOfferSchema (com refine), não contra este Dto.
export class UpdatePlatformOfferDto extends createZodDto(updatePlatformOfferBaseSchema) {}
