export interface BalanceMismatchIssue {
  type: 'BALANCE_MISMATCH';
  walletId: string;
  sumOfDeltas: number;
  lastBalanceAfter: number;
  actualCachedBalance: number;
}

export type HashChainIssueType = 'GENESIS_MISMATCH' | 'PREV_HASH_MISMATCH' | 'HASH_MISMATCH';

export interface HashChainIssue {
  type: HashChainIssueType;
  walletId: string;
  entryId: string;
  expected: string;
  actual: string;
}

export interface JobRunDetails<TIssue> {
  walletsChecked: number;
  issues: TIssue[];
}
