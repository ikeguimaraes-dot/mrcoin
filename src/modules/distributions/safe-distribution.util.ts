import { Prisma } from '@prisma/client';

/** Shape de Distribution seguro pra sair em resposta HTTP — nunca idempotencyKey (chave de
 * replay; só é lida internamente como filtro de busca, nunca a partir de um objeto já
 * buscado, então não há custo de reconsulta em narrow-la aqui). */
export const SAFE_DISTRIBUTION_SELECT = {
  id: true,
  organizationId: true,
  adminUserId: true,
  csvFileUrl: true,
  reason: true,
  totalItems: true,
  successItems: true,
  failedItems: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DistributionSelect;

export type SafeDistribution = Prisma.DistributionGetPayload<{ select: typeof SAFE_DISTRIBUTION_SELECT }>;
