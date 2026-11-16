import { Prisma } from '@prisma/client';
import { SPIN_RESERVED_AMOUNT } from './spins.constants';

/** A mesma reserva só pode ser liberada uma vez, seja por vencimento ou exclusão. */
export async function releasePendingSpin(
  tx: Prisma.TransactionClient,
  spin: { id: string; reservedBatchId: string },
): Promise<void> {
  const updated = await tx.spin.updateMany({
    where: { id: spin.id, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });
  if (updated.count === 1) {
    await tx.coinBatch.update({
      where: { id: spin.reservedBatchId },
      data: { remainingCoins: { increment: SPIN_RESERVED_AMOUNT } },
    });
  }
}
