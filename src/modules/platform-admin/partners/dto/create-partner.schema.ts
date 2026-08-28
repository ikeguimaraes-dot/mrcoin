import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createPartnerSchema = z.object({
  name: z.string().min(1),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos numéricos.'),
  category: z.string().min(1),
  takeRateBps: z.number().int().min(0).max(10000),
  pixKey: z.string().min(1),
  contactEmail: z.string().email(),
  contactPhone: z.string().min(1).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export type CreatePartnerInput = z.infer<typeof createPartnerSchema>;
export class CreatePartnerDto extends createZodDto(createPartnerSchema) {}
