import { UnprocessableEntityException } from '@nestjs/common';

export class NoSpinAvailableException extends UnprocessableEntityException {
  constructor() {
    super({ code: 'NO_SPIN_AVAILABLE', message: 'Nenhum giro disponível pra resgatar.' });
  }
}
