import { Prisma } from '@prisma/client';

/** Prisma qualifica as consultas do ORM, mas SQL raw precisa indicar o schema.
 * O identificador vem da configuração e é validado, nunca de um parâmetro HTTP. */
export function databaseTable(
  table: 'Membership' | 'AccountDeletionRequest' | 'CoinBatch' | 'LedgerEntry' | 'Wallet',
): Prisma.Sql {
  const schema = new URL(process.env.DATABASE_URL ?? '').searchParams.get('schema') ?? 'public';
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(schema)) throw new Error('Schema de banco inválido.');
  return Prisma.raw(`"${schema}"."${table}"`);
}
