export const QUEUE_RECONCILE_BALANCES = 'reconcile-balances';
export const QUEUE_VERIFY_HASH_CHAIN = 'verify-hash-chain';
export const QUEUE_CREDIT_COURSE_COMPLETIONS = 'credit-course-completions';

export const SCHEDULER_ID_RECONCILE_BALANCES = 'reconcile-balances-daily';
export const SCHEDULER_ID_VERIFY_HASH_CHAIN = 'verify-hash-chain-daily';
export const SCHEDULER_ID_CREDIT_COURSE_COMPLETIONS = 'credit-course-completions-15min';

export const CRON_RECONCILE_BALANCES = '0 3 * * *';
export const CRON_VERIFY_HASH_CHAIN = '30 3 * * *';
/// Mais frequente que os jobs diários acima de propósito — aqui tem gente esperando um
/// crédito de verdade (aprovou o quiz, estoque da empresa estava zerado), não só uma
/// varredura diagnóstica.
export const CRON_CREDIT_COURSE_COMPLETIONS = '*/15 * * * *';

export const MAX_ISSUES_PERSISTED = 500;

export const WALLET_PAGE_SIZE = 100;
export const LEDGER_ENTRY_PAGE_SIZE = 200;
