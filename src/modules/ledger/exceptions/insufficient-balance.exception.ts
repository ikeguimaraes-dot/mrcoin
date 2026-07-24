import { UnprocessableEntityException } from '@nestjs/common';

export class InsufficientBalanceException extends UnprocessableEntityException {
  constructor(walletId: string, requested: number, available: number) {
    super({
      code: 'INSUFFICIENT_BALANCE',
      message: 'Saldo insuficiente para esta operação.',
      details: { walletId, requested, available },
    });
  }
}
