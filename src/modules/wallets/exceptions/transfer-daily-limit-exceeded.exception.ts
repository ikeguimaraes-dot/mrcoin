import { UnprocessableEntityException } from '@nestjs/common';

export class TransferDailyLimitExceededException extends UnprocessableEntityException {
  constructor(limit: number, alreadySent: number, requested: number) {
    super({
      code: 'TRANSFER_DAILY_LIMIT_EXCEEDED',
      message: 'Limite diário de transferência excedido.',
      details: { limit, alreadySent, requested },
    });
  }
}
