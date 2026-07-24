import { createHash } from 'node:crypto';
import { LedgerEntryType, LedgerReferenceType } from '@prisma/client';

/** Hash de "gênese" — usado como prevHash do primeiro entry de cada carteira. */
export const GENESIS_HASH = '0'.repeat(64);

export interface LedgerHashPayload {
  walletId: string;
  type: LedgerEntryType;
  amount: number;
  balanceAfter: number;
  referenceType: LedgerReferenceType;
  referenceId: string;
  idempotencyKey: string;
  batchId: string | null;
  createdAt: Date;
}

/** Serialização determinística — delimitador fixo, sem ambiguidade de JSON.stringify. */
export function canonicalizeLedgerPayload(payload: LedgerHashPayload): string {
  return [
    payload.walletId,
    payload.type,
    String(payload.amount),
    String(payload.balanceAfter),
    payload.referenceType,
    payload.referenceId,
    payload.idempotencyKey,
    payload.batchId ?? '',
    payload.createdAt.toISOString(),
  ].join('|');
}

/** hash = sha256(prevHash + payload canônico), conforme a regra 6 do CLAUDE.md. */
export function computeEntryHash(prevHash: string, payload: LedgerHashPayload): string {
  return createHash('sha256')
    .update(prevHash + canonicalizeLedgerPayload(payload))
    .digest('hex');
}
