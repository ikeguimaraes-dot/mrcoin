import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyRedemptionConfirmAttemptsException extends HttpException {
  constructor() {
    super(
      {
        code: 'TOO_MANY_REDEMPTION_CONFIRM_ATTEMPTS',
        message: 'Muitas tentativas de confirmação. Tente novamente em instantes.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
