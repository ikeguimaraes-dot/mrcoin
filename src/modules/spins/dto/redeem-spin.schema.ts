import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const redeemSpinSchema = z.object({
  organizationId: z.string().min(1),
});

export type RedeemSpinInput = z.infer<typeof redeemSpinSchema>;
export class RedeemSpinDto extends createZodDto(redeemSpinSchema) {}
