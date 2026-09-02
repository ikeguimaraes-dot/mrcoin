import { BadRequestException } from '@nestjs/common';

export class TransactionPinNotSetException extends BadRequestException {
  constructor() {
    super({
      code: 'TRANSACTION_PIN_NOT_SET',
      message: 'Configure um PIN de transação antes de fazer uma compra.',
    });
  }
}
