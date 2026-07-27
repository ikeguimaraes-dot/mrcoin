import { HttpException, HttpStatus } from '@nestjs/common';

export class OtpTooManyAttemptsException extends HttpException {
  constructor() {
    super(
      { code: 'OTP_TOO_MANY_ATTEMPTS', message: 'Muitas tentativas. Solicite um novo código.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
