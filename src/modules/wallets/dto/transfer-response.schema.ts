import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const transferResponseSchema = z.object({
  id: z.string(),
  amount: z.number().int(),
  recipientMembershipId: z.string(),
  recipientName: z.string(),
  createdAt: z.string().datetime(),
});

export class TransferResponseDto extends createZodDto(transferResponseSchema) {}
