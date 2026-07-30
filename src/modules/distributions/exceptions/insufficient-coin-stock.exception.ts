import { UnprocessableEntityException } from '@nestjs/common';

export class InsufficientCoinStockException extends UnprocessableEntityException {
  constructor(organizationId: string, requested: number, totalAvailable: number) {
    super({
      code: 'INSUFFICIENT_COIN_STOCK',
      message: 'Estoque de coins da organização insuficiente para esta distribuição.',
      details: { organizationId, requested, totalAvailable },
    });
  }
}
