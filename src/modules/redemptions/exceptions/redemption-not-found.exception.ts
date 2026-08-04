import { NotFoundException } from '@nestjs/common';

export class RedemptionNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'NOT_FOUND', message: 'Resgate não encontrado.' });
  }
}
