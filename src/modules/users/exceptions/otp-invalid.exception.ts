import { UnauthorizedException } from '@nestjs/common';

export class OtpInvalidException extends UnauthorizedException {
  constructor() {
    super({ code: 'OTP_INVALID', message: 'Código inválido.' });
  }
}
