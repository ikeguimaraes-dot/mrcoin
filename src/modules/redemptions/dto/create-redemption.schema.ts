import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createRedemptionSchema = z.object({
  offerId: z.string().min(1),
  organizationId: z.string().min(1),
});

export type CreateRedemptionInput = z.infer<typeof createRedemptionSchema>;
export class CreateRedemptionDto extends createZodDto(createRedemptionSchema) {}
