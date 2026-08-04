import { Prisma } from '@prisma/client';

/** Shape de Redemption seguro pra sair em resposta HTTP (app ou parceiro) — nunca
 * membershipId/walletId/ledgerEntryId, referências internas sem valor pra nenhum dos dois
 * públicos. */
export const SAFE_REDEMPTION_SELECT = {
  id: true,
  partnerId: true,
  offerId: true,
  amount: true,
  code: true,
  qrPayload: true,
  status: true,
  expiresAt: true,
  confirmedAt: true,
} satisfies Prisma.RedemptionSelect;

export type SafeRedemption = Prisma.RedemptionGetPayload<{ select: typeof SAFE_REDEMPTION_SELECT }>;
