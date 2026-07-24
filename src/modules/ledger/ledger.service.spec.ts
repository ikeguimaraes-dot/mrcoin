import { randomUUID } from 'node:crypto';
import { LedgerEntry } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { InsufficientBalanceException } from './exceptions/insufficient-balance.exception';
import { InvalidReversalException } from './exceptions/invalid-reversal.exception';
import { computeEntryHash, GENESIS_HASH } from './hash.util';
import { LedgerService } from './ledger.service';

const prisma = new PrismaService();
const ledgerService = new LedgerService(prisma);

const createdWalletIds: string[] = [];

async function createWalletFixture(): Promise<string> {
  const suffix = randomUUID();

  const organization = await prisma.organization.create({
    data: {
      name: `Ledger Test Org ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
    },
  });

  const user = await prisma.user.create({
    data: {
      cpfEncrypted: `test-encrypted-${suffix}`,
      cpfHash: `test-hash-${suffix}`,
      name: `Ledger Test User ${suffix}`,
    },
  });

  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, type: 'CUSTOMER' },
  });

  const wallet = await prisma.wallet.create({
    data: { membershipId: membership.id, cachedBalance: 0 },
  });

  createdWalletIds.push(wallet.id);
  return wallet.id;
}

afterAll(async () => {
  const wallets = await prisma.wallet.findMany({
    where: { id: { in: createdWalletIds } },
    select: { id: true, membershipId: true },
  });
  const memberships = await prisma.membership.findMany({
    where: { id: { in: wallets.map((w) => w.membershipId) } },
    select: { id: true, userId: true, organizationId: true },
  });

  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: createdWalletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: createdWalletIds } } });
  await prisma.membership.deleteMany({ where: { id: { in: memberships.map((m) => m.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
  await prisma.organization.deleteMany({
    where: { id: { in: memberships.map((m) => m.organizationId) } },
  });

  await prisma.$disconnect();
});

describe('LedgerService', () => {
  it('credita um valor simples e atualiza o saldo da wallet', async () => {
    const walletId = await createWalletFixture();

    const entry = await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 100,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Crédito de teste',
      idempotencyKey: randomUUID(),
    });

    expect(entry.balanceAfter).toBe(100);

    const balance = await ledgerService.getBalance(walletId);
    expect(balance.cachedBalance).toBe(100);
  });

  it('debita um valor simples após um crédito', async () => {
    const walletId = await createWalletFixture();

    await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 100,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Crédito de teste',
      idempotencyKey: randomUUID(),
    });

    const debitEntry = await ledgerService.post({
      walletId,
      type: 'DEBIT',
      amount: 40,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Débito de teste',
      idempotencyKey: randomUUID(),
    });

    expect(debitEntry.balanceAfter).toBe(60);

    const balance = await ledgerService.getBalance(walletId);
    expect(balance.cachedBalance).toBe(60);
  });

  it('é idempotente: a mesma idempotencyKey duas vezes cria um único entry e retorna o mesmo resultado', async () => {
    const walletId = await createWalletFixture();
    const idempotencyKey = randomUUID();
    const referenceId = randomUUID();

    const input = {
      walletId,
      type: 'CREDIT' as const,
      amount: 100,
      referenceType: 'MANUAL_ADJUSTMENT' as const,
      referenceId,
      description: 'Crédito idempotente',
      idempotencyKey,
    };

    const first = await ledgerService.post(input);
    const second = await ledgerService.post(input);

    expect(second.id).toBe(first.id);
    expect(second.balanceAfter).toBe(first.balanceAfter);

    const count = await prisma.ledgerEntry.count({ where: { idempotencyKey } });
    expect(count).toBe(1);

    const balance = await ledgerService.getBalance(walletId);
    expect(balance.cachedBalance).toBe(100);
  });

  it('bloqueia débito maior que o saldo sem criar entry nem alterar o saldo', async () => {
    const walletId = await createWalletFixture();

    await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 50,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Crédito de teste',
      idempotencyKey: randomUUID(),
    });

    await expect(
      ledgerService.post({
        walletId,
        type: 'DEBIT',
        amount: 100,
        referenceType: 'MANUAL_ADJUSTMENT',
        referenceId: randomUUID(),
        description: 'Débito acima do saldo',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InsufficientBalanceException);

    const balance = await ledgerService.getBalance(walletId);
    expect(balance.cachedBalance).toBe(50);

    const debitCount = await prisma.ledgerEntry.count({ where: { walletId, type: 'DEBIT' } });
    expect(debitCount).toBe(0);
  });

  it('concorrência: dois débitos simultâneos com saldo para apenas um — um passa, o outro falha, saldo nunca fica negativo', async () => {
    const walletId = await createWalletFixture();

    await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 100,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Crédito de teste',
      idempotencyKey: randomUUID(),
    });

    const results = await Promise.allSettled([
      ledgerService.post({
        walletId,
        type: 'DEBIT',
        amount: 100,
        referenceType: 'MANUAL_ADJUSTMENT',
        referenceId: randomUUID(),
        description: 'Débito concorrente 1',
        idempotencyKey: randomUUID(),
      }),
      ledgerService.post({
        walletId,
        type: 'DEBIT',
        amount: 100,
        referenceType: 'MANUAL_ADJUSTMENT',
        referenceId: randomUUID(),
        description: 'Débito concorrente 2',
        idempotencyKey: randomUUID(),
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      InsufficientBalanceException,
    );

    const balance = await ledgerService.getBalance(walletId);
    expect(balance.cachedBalance).toBe(0);
    expect(balance.cachedBalance).toBeGreaterThanOrEqual(0);

    const debitCount = await prisma.ledgerEntry.count({ where: { walletId, type: 'DEBIT' } });
    expect(debitCount).toBe(1);
  });

  it('reverse() cria um novo entry REVERSAL e não altera o entry original', async () => {
    const walletId = await createWalletFixture();

    const original = await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 100,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Crédito a ser revertido',
      idempotencyKey: randomUUID(),
    });

    const reversal = await ledgerService.reverse({
      entryId: original.id,
      reason: 'Estorno de teste',
      idempotencyKey: randomUUID(),
    });

    expect(reversal.type).toBe('REVERSAL');
    expect(reversal.reversalOfId).toBe(original.id);
    expect(reversal.amount).toBe(original.amount);
    expect(reversal.balanceAfter).toBe(0);

    const originalAfterReversal = await prisma.ledgerEntry.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(originalAfterReversal).toEqual(original);

    const balance = await ledgerService.getBalance(walletId);
    expect(balance.cachedBalance).toBe(0);
  });

  it('rejeita reaproveitar uma idempotencyKey com parâmetros diferentes', async () => {
    const walletId = await createWalletFixture();
    const idempotencyKey = randomUUID();

    await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 100,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Crédito original',
      idempotencyKey,
    });

    await expect(
      ledgerService.post({
        walletId,
        type: 'CREDIT',
        amount: 999,
        referenceType: 'MANUAL_ADJUSTMENT',
        referenceId: randomUUID(),
        description: 'Reaproveitando a chave com outro valor',
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictException);
  });

  it('rejeita reverter um entry que já é um REVERSAL', async () => {
    const walletId = await createWalletFixture();

    const original = await ledgerService.post({
      walletId,
      type: 'CREDIT',
      amount: 100,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Crédito original',
      idempotencyKey: randomUUID(),
    });

    const reversal = await ledgerService.reverse({
      entryId: original.id,
      reason: 'Estorno de teste',
      idempotencyKey: randomUUID(),
    });

    await expect(
      ledgerService.reverse({
        entryId: reversal.id,
        reason: 'Tentando reverter o estorno',
        idempotencyKey: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(InvalidReversalException);
  });

  it('mantém a cadeia de hashes íntegra após uma sequência de operações', async () => {
    const walletId = await createWalletFixture();

    const operations: Array<{ type: 'CREDIT' | 'DEBIT'; amount: number }> = [
      { type: 'CREDIT', amount: 100 },
      { type: 'CREDIT', amount: 50 },
      { type: 'DEBIT', amount: 30 },
      { type: 'CREDIT', amount: 20 },
      { type: 'DEBIT', amount: 10 },
    ];

    for (const operation of operations) {
      await ledgerService.post({
        walletId,
        type: operation.type,
        amount: operation.amount,
        referenceType: 'MANUAL_ADJUSTMENT',
        referenceId: randomUUID(),
        description: `Operação ${operation.type} ${operation.amount}`,
        idempotencyKey: randomUUID(),
      });
    }

    const entries: LedgerEntry[] = await prisma.ledgerEntry.findMany({
      where: { walletId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    expect(entries).toHaveLength(operations.length);
    expect(entries[0]?.prevHash).toBe(GENESIS_HASH);

    let expectedPrevHash = GENESIS_HASH;
    for (const entry of entries) {
      expect(entry.prevHash).toBe(expectedPrevHash);

      const recomputedHash = computeEntryHash(entry.prevHash, {
        walletId: entry.walletId,
        type: entry.type,
        amount: entry.amount,
        balanceAfter: entry.balanceAfter,
        referenceType: entry.referenceType,
        referenceId: entry.referenceId,
        idempotencyKey: entry.idempotencyKey,
        batchId: entry.batchId,
        createdAt: entry.createdAt,
      });

      expect(recomputedHash).toBe(entry.hash);
      expectedPrevHash = entry.hash;
    }
  });
});
