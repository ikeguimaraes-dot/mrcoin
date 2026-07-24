import { ConflictException } from '@nestjs/common';

export class IdempotencyConflictException extends ConflictException {
  constructor(idempotencyKey: string, details?: Record<string, unknown>) {
    super({
      code: 'IDEMPOTENCY_CONFLICT',
      message: 'Chave de idempotência já foi usada com parâmetros diferentes.',
      details: { idempotencyKey, ...details },
    });
  }
}
