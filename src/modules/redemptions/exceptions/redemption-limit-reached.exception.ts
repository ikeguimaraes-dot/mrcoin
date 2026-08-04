import { UnprocessableEntityException } from '@nestjs/common';

export class RedemptionLimitReachedException extends UnprocessableEntityException {
  constructor() {
    super({ code: 'REDEMPTION_LIMIT_REACHED', message: 'Limite de resgates dessa oferta já atingido.' });
  }
}
