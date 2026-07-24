import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManyLoginAttemptsException extends HttpException {
  constructor() {
    super(
      {
        code: 'TOO_MANY_LOGIN_ATTEMPTS',
        message: 'Muitas tentativas de login. Tente novamente em instantes.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
