import { HttpException, HttpStatus } from '@nestjs/common';

export class PinLockedException extends HttpException {
  constructor() {
    super(
      {
        code: 'PIN_LOCKED',
        message: 'Muitas tentativas de PIN incorreto. Tente novamente em 15 minutos.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
