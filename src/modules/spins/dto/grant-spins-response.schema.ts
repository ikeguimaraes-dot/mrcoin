import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const spinItemSchema = z.object({
  id: z.string(),
  expiresAt: z.string().datetime(),
});

export const grantSpinsResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  membershipId: z.string(),
  quantity: z.number().int(),
  reason: z.string().nullable(),
  createdAt: z.string().datetime(),
  spins: z.array(spinItemSchema),
});

export class GrantSpinsResponseDto extends createZodDto(grantSpinsResponseSchema) {}
