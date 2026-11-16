import { UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { databaseTable } from '../../common/database/table-reference.util';

/** Serializa concessões com o desligamento. Quem já saiu pode gastar o que possui,
 * mas não receber novos créditos ou giros. Bloqueios INACTIVE continuam vigentes. */
export async function assertMembershipCanEarn(
  tx: Prisma.TransactionClient,
  membershipId: string,
): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM ${databaseTable('Membership')} WHERE "id" = ${membershipId} FOR UPDATE`;
  const membership = await tx.membership.findUniqueOrThrow({
    where: { id: membershipId },
    select: { status: true, departedAt: true, user: { select: { status: true } } },
  });
  if (
    membership.status !== 'ACTIVE' ||
    membership.departedAt !== null ||
    membership.user.status === 'DELETED'
  ) {
    throw new UnprocessableEntityException({
      code: 'MEMBERSHIP_CANNOT_EARN',
      message: 'Este vínculo não pode receber novos coins ou giros.',
    });
  }
}
