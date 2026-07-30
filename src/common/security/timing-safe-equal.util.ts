import { timingSafeEqual } from 'node:crypto';

/** Compara duas strings em tempo constante — evita timing attack na validação de
 * tokens/assinaturas (ex.: header `asaas-access-token` do webhook do PSP). */
export function timingSafeEqualString(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return timingSafeEqual(bufferA, bufferB);
}
