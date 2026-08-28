import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOrganizationSchema = z.object({
  name: z.string().min(1),
  cnpj: z.string().regex(/^\d{14}$/, 'CNPJ deve ter 14 dígitos numéricos.'),
  ownerEmail: z.string().email(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export class CreateOrganizationDto extends createZodDto(createOrganizationSchema) {}
