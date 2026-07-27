import { NotFoundException } from '@nestjs/common';

export class OtpNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'OTP_NOT_FOUND', message: 'Nenhum pedido de verificação pendente encontrado.' });
  }
}
