import { NotFoundException } from '@nestjs/common';

export class RecipientNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'NOT_FOUND', message: 'Destinatário não encontrado.' });
  }
}
