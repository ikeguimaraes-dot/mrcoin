import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { JobRunRecorderService } from './job-run-recorder.service';
import { ReconciliationService } from './reconciliation.service';
import { BalanceMismatchIssue, JobRunDetails } from './job-run.types';

const prisma = new PrismaService();
const ledgerService = new LedgerService(prisma);
const reconciliationService = new ReconciliationService(prisma, new JobRunRecorderService(prisma));

const createdWalletIds: string[] = [];
const createdJobRunIds: string[] = [];

async function createWalletFixture(): Promise<string> {
  const suffix = randomUUID();

  const organization = await prisma.organization.create({
    data: {
      name: `Reconciliation Test Org ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
    },
  });
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });

  const user = await prisma.user.create({
    data: {
      cpfEncrypted: `test-encrypted-${suffix}`,
      cpfHash: `test-hash-${suffix}`,
      name: `Reconciliation Test User ${suffix}`,
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

function post(walletId: string, type: 'CREDIT' | 'DEBIT' | 'EXPIRE', amount: number) {
  return ledgerService.post({
    walletId,
    type,
    amount,
    referenceType: 'MANUAL_ADJUSTMENT',
    referenceId: randomUUID(),
    description: `Operação ${type} ${amount}`,
    idempotencyKey: randomUUID(),
  });
}

async function runReconciliationAndGetIssues(): Promise<BalanceMismatchIssue[]> {
  await reconciliationService.run();

  const jobRun = await prisma.jobRun.findFirstOrThrow({
    where: { jobName: 'RECONCILE_BALANCES' },
    orderBy: { startedAt: 'desc' },
  });
  createdJobRunIds.push(jobRun.id);

  const details = jobRun.details as unknown as JobRunDetails<BalanceMismatchIssue>;
  return details.issues;
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

  await prisma.jobRun.deleteMany({ where: { id: { in: createdJobRunIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: createdWalletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: createdWalletIds } } });
  await prisma.membership.deleteMany({ where: { id: { in: memberships.map((m) => m.id) } } });
  await prisma.user.deleteMany({ where: { id: { in: memberships.map((m) => m.userId) } } });
  await prisma.conversionRate.deleteMany({
    where: { organizationId: { in: memberships.map((m) => m.organizationId) } },
  });
  await prisma.organization.deleteMany({
    where: { id: { in: memberships.map((m) => m.organizationId) } },
  });

  await prisma.$disconnect();
});

describe('ReconciliationService', () => {
  it('não gera divergência para uma wallet cujo cachedBalance bate com a soma dos entries', async () => {
    const walletId = await createWalletFixture();

    await post(walletId, 'CREDIT', 100);
    await post(walletId, 'DEBIT', 40);

    const issues = await runReconciliationAndGetIssues();
    expect(issues.some((issue) => issue.walletId === walletId)).toBe(false);
  });

  it('detecta divergência quando cachedBalance é adulterado diretamente, sem passar pelo LedgerService', async () => {
    const walletId = await createWalletFixture();

    await post(walletId, 'CREDIT', 100);
    await prisma.wallet.update({ where: { id: walletId }, data: { cachedBalance: 999 } });

    const issues = await runReconciliationAndGetIssues();
    const issue = issues.find((i) => i.walletId === walletId);

    expect(issue).toBeDefined();
    expect(issue?.type).toBe('BALANCE_MISMATCH');
    expect(issue?.sumOfDeltas).toBe(100);
    expect(issue?.lastBalanceAfter).toBe(100);
    expect(issue?.actualCachedBalance).toBe(999);
  });

  it('grava um JobRun com status SUCCESS ao final da execução', async () => {
    await createWalletFixture();
    await reconciliationService.run();

    const jobRun = await prisma.jobRun.findFirstOrThrow({
      where: { jobName: 'RECONCILE_BALANCES' },
      orderBy: { startedAt: 'desc' },
    });
    createdJobRunIds.push(jobRun.id);

    expect(jobRun.status).toBe('SUCCESS');
    expect(jobRun.finishedAt).not.toBeNull();
  });
});
