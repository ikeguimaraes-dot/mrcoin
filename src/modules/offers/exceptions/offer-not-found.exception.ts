import { NotFoundException } from '@nestjs/common';

export class OfferNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'NOT_FOUND', message: 'Oferta não encontrada.' });
  }
}
