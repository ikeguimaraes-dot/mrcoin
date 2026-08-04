import { UnprocessableEntityException } from '@nestjs/common';

export class RedemptionExpiredException extends UnprocessableEntityException {
  constructor() {
    super({ code: 'REDEMPTION_EXPIRED', message: 'Resgate expirado.' });
  }
}
