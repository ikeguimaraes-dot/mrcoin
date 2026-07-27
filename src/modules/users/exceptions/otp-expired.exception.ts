import { BadRequestException } from '@nestjs/common';

export class OtpExpiredException extends BadRequestException {
  constructor() {
    super({ code: 'OTP_EXPIRED', message: 'Este código expirou. Solicite um novo.' });
  }
}
