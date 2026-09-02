/** Rejeita PIN com todos os dígitos iguais (1111, 0000...) ou em sequência ascendente/
 * descendente (1234, 4321, 123456, 654321...) — qualquer tamanho entre 4 e 6. */
export function isTrivialPin(pin: string): boolean {
  const digits = pin.split('').map(Number);

  const allSame = digits.every((digit) => digit === digits[0]);
  if (allSame) return true;

  const ascending = digits.every((digit, i) => i === 0 || digit === (digits[i - 1] ?? NaN) + 1);
  if (ascending) return true;

  const descending = digits.every((digit, i) => i === 0 || digit === (digits[i - 1] ?? NaN) - 1);
  if (descending) return true;

  return false;
}
