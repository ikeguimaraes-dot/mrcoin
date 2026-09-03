import { ConflictException } from '@nestjs/common';
import { BatchStatus } from '@prisma/client';

/** Lançada quando aprovar/recusar não é um replay benigno da mesma decisão (ex.: recusar
 * um lote já aprovado, ou vice-versa) — diferente de repetir a MESMA ação, que é
 * idempotente e não é erro. */
export class BatchDecisionConflictException extends ConflictException {
  constructor(currentStatus: BatchStatus) {
    super({
      code: 'BATCH_DECISION_CONFLICT',
      message: `Lote já está em status ${currentStatus} — não é possível decidir de novo.`,
      details: { currentStatus },
    });
  }
}
