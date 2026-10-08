/**
 * Backfill dos valores padrão (Foco, Ordem, Método, Execução) para organizações criadas antes
 * de OrganizationValue existir. Rodado manualmente, uma vez por ambiente, depois do deploy da
 * migration `organization_values_recognition` — organizações novas já nascem com os valores
 * (createOrganizationWithOwnerInvite).
 *
 * Idempotente: só semeia organização que ainda não tem NENHUM valor; quem já tem pelo menos
 * um (inclusive se renomeou/apagou algum padrão) é pulada. Pode rodar de novo sem efeito.
 *
 * Uso:
 *   pnpm ts-node -r tsconfig-paths/register prisma/backfill-organization-values.ts
 *
 * Diferente de `prisma db seed`, é seguro contra produção — não cria nenhum dado fictício.
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { backfillDefaultOrganizationValues } from '../src/modules/organization-values/default-organization-values';

config({ quiet: true });

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const { seededOrganizationIds, skippedCount } = await backfillDefaultOrganizationValues(prisma);

  console.log('Backfill de valores concluído:', {
    seeded: seededOrganizationIds.length,
    skippedAlreadyHadValues: skippedCount,
    seededOrganizationIds,
  });
}

main()
  .catch((error: unknown) => {
    console.error('Falha no backfill de valores:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
