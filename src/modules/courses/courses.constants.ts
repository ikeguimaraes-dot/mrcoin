/** Nota mínima pra aprovação — em pontos percentuais inteiros. */
export const PASSING_SCORE_PERCENT = 80;

/** Prêmio por curso aprovado, constante do sistema (não configurável por curso). */
export const COURSE_COMPLETION_REWARD_COINS = 50;

/** Reprovou: só pode tentar de novo depois desses dias, contados da tentativa reprovada. */
export const RETRY_LOCKOUT_DAYS = 7;

/** Tamanho de página do job credit-course-completions — mesmo espírito de WALLET_PAGE_SIZE
 * em jobs.constants.ts. */
export const COURSE_COMPLETION_CREDIT_BATCH_SIZE = 100;
