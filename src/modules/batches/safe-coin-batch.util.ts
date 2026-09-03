import { CoinBatch, Prisma } from '@prisma/client';

/** Shape de CoinBatch seguro pra sair em resposta HTTP — nunca pspChargeId (referência
 * interna do PSP), idempotencyKey (chave de replay), nem approvedByPlatformAdminId/
 * rejectedByPlatformAdminId (identidade de quem decidiu não é assunto da empresa). */
export const SAFE_COIN_BATCH_SELECT = {
  id: true,
  organizationId: true,
  totalCoins: true,
  remainingCoins: true,
  priceInCents: true,
  status: true,
  rejectionReason: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CoinBatchSelect;

export type SafeCoinBatch = Prisma.CoinBatchGetPayload<{ select: typeof SAFE_COIN_BATCH_SELECT }>;

/** Usado quando o CoinBatch já foi buscado por inteiro por outro motivo (ex: replay de
 * idempotência, que precisa de pspChargeId pra reconsultar o QR Code no PSP) — narrow só
 * na hora de montar a resposta, sem uma segunda query. */
export function toSafeCoinBatch(batch: CoinBatch): SafeCoinBatch {
  return {
    id: batch.id,
    organizationId: batch.organizationId,
    totalCoins: batch.totalCoins,
    remainingCoins: batch.remainingCoins,
    priceInCents: batch.priceInCents,
    status: batch.status,
    rejectionReason: batch.rejectionReason,
    expiresAt: batch.expiresAt,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
  };
}
