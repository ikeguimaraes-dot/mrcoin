import { BadRequestException } from '@nestjs/common';

/** `Idempotency-Key` header obrigatório em POSTs financeiros da API pública (regra do
 * CLAUDE.md) — mesma validação reaproveitada por todo endpoint que precisa dela. */
export function requireIdempotencyKey(idempotencyKey: string | undefined): string {
  if (!idempotencyKey?.trim()) {
    throw new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: 'Header Idempotency-Key é obrigatório.',
    });
  }
  return idempotencyKey;
}
