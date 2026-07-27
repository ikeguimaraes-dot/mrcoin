import { HttpException, HttpStatus } from '@nestjs/common';

export class TooManySignupAttemptsException extends HttpException {
  constructor() {
    super(
      { code: 'TOO_MANY_SIGNUP_ATTEMPTS', message: 'Muitas tentativas. Tente novamente em instantes.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
