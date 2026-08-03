import { Prisma } from '@prisma/client';

/**
 * Shape de DistributionItem seguro pra sair em resposta HTTP — nunca cpfHash/cpfEncrypted.
 * Esses dois só sobrevivem em linhas FAILED (o caminho OK já zera os dois ao concluir, ver
 * distributions.service.ts) e são exatamente o CPF cifrado + hash de busca — dado pessoal
 * que não tem por quê estar inspecionável no painel admin.
 */
export const SAFE_DISTRIBUTION_ITEM_SELECT = {
  id: true,
  distributionId: true,
  membershipId: true,
  amount: true,
  status: true,
  errorReason: true,
  name: true,
  membershipType: true,
  externalRef: true,
  createdAt: true,
} satisfies Prisma.DistributionItemSelect;

export type SafeDistributionItem = Prisma.DistributionItemGetPayload<{
  select: typeof SAFE_DISTRIBUTION_ITEM_SELECT;
}>;
