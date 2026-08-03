import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const walletQuerySchema = z.object({
  organizationId: z.string().min(1),
});

export type WalletQuery = z.infer<typeof walletQuerySchema>;
export class WalletQueryDto extends createZodDto(walletQuerySchema) {}
