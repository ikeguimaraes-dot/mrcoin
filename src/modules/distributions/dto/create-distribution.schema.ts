import { MembershipType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createDistributionSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
  name: z.string().min(1),
  amount: z.number().int().positive(),
  membershipType: z.nativeEnum(MembershipType),
  externalRef: z.string().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

export type CreateDistributionInput = z.infer<typeof createDistributionSchema>;
export class CreateDistributionDto extends createZodDto(createDistributionSchema) {}
