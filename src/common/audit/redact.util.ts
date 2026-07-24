export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN = /password|passwordhash|token|secret|cpf/i;

/** Percorre um valor arbitrário (já JSON-safe, ex.: body de um request) e substitui por
 * '[REDACTED]' qualquer chave sensível — usado antes de gravar qualquer payload em
 * AuditLog (nunca senha/token em claro). */
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
