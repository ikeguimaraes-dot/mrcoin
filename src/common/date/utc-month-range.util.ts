export interface UtcMonthRange {
  monthStart: Date;
  monthEnd: Date;
}

/** Início/fim (exclusivo) do mês corrente em UTC — usado por qualquer métrica de "mês
 * atual" (dashboard por organização e dashboard de plataforma). */
export function getUtcMonthRange(reference: Date = new Date()): UtcMonthRange {
  const monthStart = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1));
  const monthEnd = new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1));
  return { monthStart, monthEnd };
}
