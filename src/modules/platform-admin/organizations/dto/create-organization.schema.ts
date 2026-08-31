import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(1),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos numéricos.'),
  ownerEmail: z.string().email(),
  // Opcional — sem isso a organização nasce com a taxa padrão da plataforma (1,25 coins/real).
  coinsPerReal: z.number().positive().max(1000).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}
