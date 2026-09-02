import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createRedemptionSchema = z.object({
  offerId: z.string().min(1),
  organizationId: z.string().min(1),
  transactionPin: z.string().regex(/^\d{4,6}$/, 'PIN deve conter de 4 a 6 dígitos numéricos.'),
});

export type CreateRedemptionInput = z.infer<typeof createRedemptionSchema>;
export class CreateRedemptionDto extends createZodDto(createRedemptionSchema) {}
