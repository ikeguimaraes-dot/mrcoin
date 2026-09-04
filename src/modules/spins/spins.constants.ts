/** 8 setores fixos, iguais pra toda organização — a ordem é o contrato com o app (índice =
 * posição física na roleta), nunca reordenar sem coordenar com o client. */
export const SPIN_SECTORS = [50, 50, 50, 150, 150, 150, 500, 1000] as const;

/** Pior caso possível num giro — quanto cada Spin reserva de CoinBatch.remainingCoins no
 * momento da concessão (ver plano da feature "roleta de prêmios"). */
export const SPIN_RESERVED_AMOUNT = Math.max(...SPIN_SECTORS);

/** Teto de giros por chamada de concessão — mesmo espírito de outros limites de input desta
 * base (CSV_MAX_ROWS, limit.max em listagens paginadas). */
export const SPIN_GRANT_MAX_QUANTITY = 100;
