import { Prisma } from '@prisma/client';

/** Shape de Redemption seguro pra sair em resposta HTTP (app ou parceiro) — nunca
 * membershipId/walletId/ledgerEntryId, referências internas sem valor pra nenhum dos dois
 * públicos. deliveredByType/deliveredById também ficam de fora (identidade de quem entregou
 * não é assunto do cliente nem do parceiro que não foi ele mesmo). */
export const SAFE_REDEMPTION_SELECT = {
  id: true,
  partnerId: true,
  offerId: true,
  amount: true,
  pickupCode: true,
  qrPayload: true,
  status: true,
  confirmedAt: true,
  deliveredAt: true,
} satisfies Prisma.RedemptionSelect;

export type SafeRedemption = Prisma.RedemptionGetPayload<{ select: typeof SAFE_REDEMPTION_SELECT }>;
