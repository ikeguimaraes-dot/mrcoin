import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createTransferSchema = z.object({
  organizationId: z.string().min(1),
  recipientMembershipId: z.string().min(1),
  amount: z.number().int().positive(),
  transactionPin: z.string().regex(/^\d{4,6}$/, 'PIN deve conter de 4 a 6 dígitos numéricos.'),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export class CreateTransferDto extends createZodDto(createTransferSchema) {}
