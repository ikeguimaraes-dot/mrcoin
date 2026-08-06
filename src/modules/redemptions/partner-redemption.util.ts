/** Primeiro nome de um nome completo — usado só pro atendente conferir "é essa pessoa
 * mesmo", nunca pra identificar univocamente (ver PARTNER_REDEMPTION_CONFIRM_ALLOWED_FIELDS
 * no schema de resposta pra o que mais fica de fora). */
export function extractFirstName(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] ?? fullName;
}
