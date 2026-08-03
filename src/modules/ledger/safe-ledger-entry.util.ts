import { LedgerEntry, Prisma } from '@prisma/client';

/**
 * Shape de LedgerEntry seguro pra sair em resposta HTTP — nunca idempotencyKey, prevHash ou
 * hash (chave de replay + campos da cadeia de integridade do ledger, auditoria interna que
 * não deveria estar inspecionável no bundle de nenhum cliente). batchId/distributionItemId/
 * referenceId ficam: são usados de verdade na resposta de criação de distribuição (confirmam
 * de qual lote saiu o crédito) e não são segredo por si só, diferente de hash/idempotencyKey.
 */
export const SAFE_LEDGER_ENTRY_SELECT = {
  id: true,
  walletId: true,
  type: true,
  amount: true,
  balanceAfter: true,
  referenceType: true,
  referenceId: true,
  batchId: true,
  distributionItemId: true,
  description: true,
  reversalOfId: true,
  createdAt: true,
} satisfies Prisma.LedgerEntrySelect;

export type SafeLedgerEntry = Prisma.LedgerEntryGetPayload<{ select: typeof SAFE_LEDGER_ENTRY_SELECT }>;

export function toSafeLedgerEntry(entry: LedgerEntry): SafeLedgerEntry {
  return {
    id: entry.id,
    walletId: entry.walletId,
    type: entry.type,
    amount: entry.amount,
    balanceAfter: entry.balanceAfter,
    referenceType: entry.referenceType,
    referenceId: entry.referenceId,
    batchId: entry.batchId,
    distributionItemId: entry.distributionItemId,
    description: entry.description,
    reversalOfId: entry.reversalOfId,
    createdAt: entry.createdAt,
  };
}
