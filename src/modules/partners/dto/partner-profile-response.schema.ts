import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Perfil do parceiro autenticado (GET /partners/me) — mesmo cuidado de minimização do
 * SAFE_PARTNER_CATALOG_SELECT: nunca pixKey/takeRateBps/cnpj/contactEmail/contactPhone. */
export const partnerProfileResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.string(),
});
export class PartnerProfileResponseDto extends createZodDto(partnerProfileResponseSchema) {}
