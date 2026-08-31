import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Shape de exibição da taxa vigente — reusado tanto pelo self-service da organização
 * (GET /organizations/me) quanto pelo CRUD de platform admin. Edição (PATCH) é exclusiva de
 * platform admin, então o schema de escrita não mora aqui, mora em platform-admin/. */
export const conversionRateSummarySchema = z.object({
  coinsPerReal: z.number(),
  effectiveSince: z.string().datetime(),
});

export class ConversionRateSummaryDto extends createZodDto(conversionRateSummarySchema) {}
