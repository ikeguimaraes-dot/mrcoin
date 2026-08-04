import { NotFoundException } from '@nestjs/common';

export class PartnerNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'NOT_FOUND', message: 'Parceiro não encontrado.' });
  }
}
