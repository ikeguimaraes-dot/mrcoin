import { NotFoundException } from '@nestjs/common';

export class BatchNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'NOT_FOUND', message: 'Lote não encontrado.' });
  }
}
