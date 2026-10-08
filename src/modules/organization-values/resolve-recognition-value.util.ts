import { Prisma, PrismaClient } from '@prisma/client';
import {
  RecognitionValueInactiveException,
  RecognitionValueNotFoundException,
} from './exceptions/organization-value.exceptions';

export interface RecognitionValue {
  id: string;
  name: string;
}

/** Garante que o valor citado numa distribuição pertence à organização que está distribuindo
 * (escopo SEMPRE pelo organizationId do JWT, nunca pelo do valor) e está ativo. Inexistente e
 * "de outra organização" caem no mesmo erro — não revela que o id existe em outra empresa. */
export async function resolveRecognitionValue(
  prisma: Prisma.TransactionClient | PrismaClient,
  organizationId: string,
  organizationValueId: string,
): Promise<RecognitionValue> {
  const value = await prisma.organizationValue.findFirst({
    where: { id: organizationValueId, organizationId },
    select: { id: true, name: true, isActive: true },
  });

  if (!value) {
    throw new RecognitionValueNotFoundException();
  }

  if (!value.isActive) {
    throw new RecognitionValueInactiveException();
  }

  return { id: value.id, name: value.name };
}
