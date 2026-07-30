import { UnprocessableEntityException } from '@nestjs/common';

export class PspChargeFailedException extends UnprocessableEntityException {
  constructor(operation: string, details?: Record<string, unknown>) {
    super({
      code: 'PSP_CHARGE_FAILED',
      message: 'Falha ao comunicar com o provedor de pagamento.',
      details: { operation, ...details },
    });
  }
}
