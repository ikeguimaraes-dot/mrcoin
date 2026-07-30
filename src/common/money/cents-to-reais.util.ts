/** Converte centavos (inteiro, formato interno) para reais decimais — só usado na
 * fronteira com APIs externas que esperam valor em reais (ex.: Asaas). Nunca usar
 * o resultado para armazenamento ou cálculo interno. */
export function centsToReais(cents: number): number {
  return Math.round(cents) / 100;
}
