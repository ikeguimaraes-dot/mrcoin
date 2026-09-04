import { BadRequestException } from '@nestjs/common';

export class FuturePeriodNotAllowedException extends BadRequestException {
  constructor() {
    super({ code: 'FUTURE_PERIOD_NOT_ALLOWED', message: 'Não é possível consultar um período futuro.' });
  }
}
