export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN = /password|passwordhash|token|secret|cpf/i;

/** Percorre um valor arbitrário (já JSON-safe, ex.: body de um request) e substitui por
 * '[REDACTED]' qualquer chave sensível — usado antes de gravar qualquer payload em
 * AuditLog (nunca senha/token em claro).
 *
 * A sobrecarga com objeto garante um retorno sem `null` no nível raiz — é isso que o
 * Prisma exige pro campo `payload: Json` (ele distingue `null` de `Prisma.JsonNull`, e só
 * aceita o segundo nesse nível; `null` só é válido aninhado dentro do objeto/array). Como
 * os dois pontos de uso passam sempre um objeto literal, isso evita um cast inseguro. */
export function redactSensitiveFields<T extends Record<string, unknown>>(value: T): { [key: string]: JsonValue };
export function redactSensitiveFields(value: unknown): JsonValue;
export function redactSensitiveFields(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item));
  }

  if (value === null || typeof value !== 'object') {
    return value as JsonValue;
  }

  const result: { [key: string]: JsonValue } = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactSensitiveFields(entry);
  }
  return result;
}
