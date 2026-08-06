import { RedemptionStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Resposta de POST /redemptions/confirm pro portal do parceiro — shape deliberadamente
 * diferente do SafeRedemption que o app usa (redemption-response.schema.ts). O atendente
 * precisa ver "qual oferta, quanto, pra quem" (CLAUDE.md do coins-partner), mas NUNCA cpf,
 * e-mail, telefone ou sobrenome do cliente — só o suficiente pra conferir que é a pessoa
 * certa. customerFirstName é sempre só o primeiro nome (ver extractFirstName).
 *
 * PARTNER_REDEMPTION_CONFIRM_ALLOWED_FIELDS abaixo é a lista travada por teste
 * (redemptions.e2e.spec.ts) — qualquer campo novo aqui precisa passar por essa lista.
 */
export const partnerRedemptionConfirmResponseSchema = z.object({
  id: z.string(),
  amount: z.number().int(),
  status: z.nativeEnum(RedemptionStatus),
  confirmedAt: z.string().datetime().nullable(),
  offerTitle: z.string().nullable(),
  customerFirstName: z.string(),
});
export class PartnerRedemptionConfirmResponseDto extends createZodDto(partnerRedemptionConfirmResponseSchema) {}

export const PARTNER_REDEMPTION_CONFIRM_ALLOWED_FIELDS = Object.keys(
  partnerRedemptionConfirmResponseSchema.shape,
).sort();
