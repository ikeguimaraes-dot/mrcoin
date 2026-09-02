import { BadRequestException } from '@nestjs/common';

export class SelfTransferException extends BadRequestException {
  constructor() {
    super({ code: 'SELF_TRANSFER_NOT_ALLOWED', message: 'Não é possível transferir coins para você mesmo.' });
  }
}
