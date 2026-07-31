import { ConflictException } from '@nestjs/common';

export class DistributionNotPendingException extends ConflictException {
  constructor(distributionId: string, currentStatus: string) {
    super({
      code: 'DISTRIBUTION_NOT_PENDING',
      message: 'Esta distribuição já foi confirmada ou concluída.',
      details: { distributionId, currentStatus },
    });
  }
}
