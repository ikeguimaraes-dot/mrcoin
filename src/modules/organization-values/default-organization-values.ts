import { Prisma, PrismaClient } from '@prisma/client';

/** Pilares do método FOME — toda organização nasce com eles (a empresa pode renomear,
 * reordenar, desativar ou criar outros depois, pelo coins-admin). */
export const DEFAULT_ORGANIZATION_VALUES = [
  { name: 'Foco', sortOrder: 1 },
  { name: 'Ordem', sortOrder: 2 },
  { name: 'Método', sortOrder: 3 },
  { name: 'Execução', sortOrder: 4 },
] as const;

type PrismaWriter = Prisma.TransactionClient | PrismaClient;

/** Idempotente pela unique (organizationId, name) — rodar de novo não duplica nada. Recebe o
 * client por parâmetro (como createOrganizationWithOwnerInvite) pra servir tanto dentro de
 * uma transação do Nest quanto no seed e no script de backfill. */
export async function createDefaultOrganizationValues(prisma: PrismaWriter, organizationId: string): Promise<void> {
  await prisma.organizationValue.createMany({
    data: DEFAULT_ORGANIZATION_VALUES.map((value) => ({ organizationId, ...value })),
    skipDuplicates: true,
  });
}

export interface BackfillDefaultValuesResult {
  seededOrganizationIds: string[];
  skippedCount: number;
}

/** Backfill das organizações anteriores aos valores: só semeia quem ainda não tem NENHUM
 * valor — organização que já mexeu na própria lista (renomeou "Foco", por exemplo) não ganha
 * os padrões de volta. */
export async function backfillDefaultOrganizationValues(prisma: PrismaClient): Promise<BackfillDefaultValuesResult> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, _count: { select: { values: true } } },
  });

  const pending = organizations.filter((organization) => organization._count.values === 0);

  for (const organization of pending) {
    await createDefaultOrganizationValues(prisma, organization.id);
  }

  return {
    seededOrganizationIds: pending.map((organization) => organization.id),
    skippedCount: organizations.length - pending.length,
  };
}
