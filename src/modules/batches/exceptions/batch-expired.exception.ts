import { UnprocessableEntityException } from '@nestjs/common';

export class BatchExpiredException extends UnprocessableEntityException {
  constructor(batchId: string) {
    super({ code: 'BATCH_EXPIRED', message: 'Lote de coins expirado.', details: { batchId } });
  }
}
