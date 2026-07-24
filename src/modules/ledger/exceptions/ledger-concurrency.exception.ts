import { ConflictException } from '@nestjs/common';

export class LedgerConcurrencyException extends ConflictException {
  constructor(walletId: string, attempts: number) {
    super({
      code: 'LEDGER_CONCURRENCY_CONFLICT',
      message: 'Não foi possível concluir a operação após múltiplas tentativas de concorrência.',
      details: { walletId, attempts },
    });
  }
}
