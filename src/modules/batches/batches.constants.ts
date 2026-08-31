export const BATCH_LIST_PAGE_SIZE = 20;
export const DEFAULT_BATCH_VALIDITY_MONTHS = 12;

/** Piso de priceInCents pra compra de lote — regra de negócio nossa, não uma trava
 * documentada do Asaas (a doc da API não especifica mínimo pro campo `value`). Evita cobrança
 * Pix trivial quando totalCoins × taxa resulta num valor baixo demais pra fazer sentido
 * cobrar. Confirmado com o produto: R$5,00. */
export const MIN_BATCH_PRICE_IN_CENTS = 500;
