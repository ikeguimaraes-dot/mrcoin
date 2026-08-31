import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/** Shape de exibição da taxa vigente — reusado tanto pelo self-service da organização
 * (GET /organizations/me) quanto pelo CRUD de platform admin. Edição (PATCH) é exclusiva de
 * platform admin, então o schema de escrita não mora aqui, mora em platform-admin/.
 *
 * coinsPerReal é pra exibição amigável; coinsPerRealScaled é o Int cru gravado no banco
 * (ex: 125 pra 1,25) — o frontend deve usar ESSE campo pra replicar o cálculo de
 * priceInCents, nunca reconstruir a partir de coinsPerReal (coinsPerReal * 100 é float não
 * arredondado — divide por um valor "quase certo" em vez do inteiro exato, o que pode
 * divergir 1 centavo do backend numa fração x.5 de arredondamento). coinsPerRealScaled
 * elimina esse risco: ambos os lados dividem pelo mesmo inteiro, resultado bit a bit igual. */
export const conversionRateSummarySchema = z.object({
  coinsPerReal: z.number(),
  coinsPerRealScaled: z.number().int(),
  effectiveSince: z.string().datetime(),
});

// Sem `z.infer` exportado de propósito: o shape de wire (`effectiveSince` como string ISO)
// difere do shape usado dentro dos services (`effectiveSince: Date`, serializado pelo Nest
// na resposta HTTP) — cada service já declara sua própria interface local com Date, mesmo
// padrão do restante do módulo (ver OrganizationSummary em platform-organizations.service.ts).
export class ConversionRateSummaryDto extends createZodDto(conversionRateSummarySchema) {}
