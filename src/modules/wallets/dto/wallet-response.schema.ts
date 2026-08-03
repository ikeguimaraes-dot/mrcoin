import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const walletResponseSchema = z.object({
  walletId: z.string(),
  cachedBalance: z.number().int(),
  expiring: z.array(
    z.object({
      batchId: z.string(),
      amount: z.number().int(),
      expiresAt: z.string().datetime(),
    }),
  ),
});
export class WalletResponseDto extends createZodDto(walletResponseSchema) {}
