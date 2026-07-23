function calcCheckDigit(digits: number[]): number {
  let weight = digits.length + 1;
  let sum = 0;

  for (const digit of digits) {
    sum += digit * weight;
    weight--;
  }

  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

/** Gera um CPF com dígitos verificadores válidos, determinístico por índice. Não é um CPF real. */
export function generateFakeCpf(seedIndex: number): string {
  // (100000000 + seedIndex) garante 9 dígitos-base distintos por índice — uma
  // combinação linear em módulo 10 (ex.: seedIndex + i*7) repete com período 10.
  const base = String(100000000 + seedIndex)
    .padStart(9, '0')
    .split('')
    .map(Number);
  const firstCheckDigit = calcCheckDigit(base);
  const secondCheckDigit = calcCheckDigit([...base, firstCheckDigit]);

  return [...base, firstCheckDigit, secondCheckDigit].join('');
}
