import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { JobRunRecorderService } from './job-run-recorder.service';
import { HashChainVerificationService } from './hash-chain-verification.service';
import { HashChainIssue, JobRunDetails } from './job-run.types';

const prisma = new PrismaService();
const ledgerService = new LedgerService(prisma);
const hashChainVerificationService = new HashChainVerificationService(
  prisma,
  new JobRunRecorderService(prisma),
);

const createdWalletIds: string[] = [];
const createdJobRunIds: string[] = [];

async function createWalletFixture(): Promise<string> {
  const suffix = randomUUID();

  const organization = await prisma.organization.create({
    data: {
      name: `HashChain Test Org ${suffix}`,
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
      name: `HashChain Test User ${suffix}`,
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

async function runVerificationAndGetIssues(): Promise<HashChainIssue[]> {
  await hashChainVerificationService.run();

  const jobRun = await prisma.jobRun.findFirstOrThrow({
    where: { jobName: 'VERIFY_HASH_CHAIN' },
    orderBy: { startedAt: 'desc' },
  });
  createdJobRunIds.push(jobRun.id);

  const details = jobRun.details as unknown as JobRunDetails<HashChainIssue>;
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

describe('HashChainVerificationService', () => {
  it('não gera problema para uma cadeia íntegra', async () => {
    const walletId = await createWalletFixture();

    await post(walletId, 'CREDIT', 100);
    await post(walletId, 'CREDIT', 50);
    await post(walletId, 'DEBIT', 30);

    const issues = await runVerificationAndGetIssues();
    expect(issues.some((issue) => issue.walletId === walletId)).toBe(false);
  });

  it('detecta HASH_MISMATCH num entry adulterado, sem cascatear PREV_HASH_MISMATCH', async () => {
    const walletId = await createWalletFixture();

    await post(walletId, 'CREDIT', 100);
    const middle = await post(walletId, 'CREDIT', 50);
    await post(walletId, 'DEBIT', 30);

    await prisma.ledgerEntry.update({ where: { id: middle.id }, data: { amount: 999 } });

    const issues = await runVerificationAndGetIssues();
    const walletIssues = issues.filter((issue) => issue.walletId === walletId);

    expect(walletIssues).toHaveLength(1);
    expect(walletIssues[0]?.type).toBe('HASH_MISMATCH');
    expect(walletIssues[0]?.entryId).toBe(middle.id);
  });

  it('detecta GENESIS_MISMATCH quando o prevHash do primeiro entry é adulterado', async () => {
    const walletId = await createWalletFixture();

    const first = await post(walletId, 'CREDIT', 100);
    await post(walletId, 'DEBIT', 40);

    await prisma.ledgerEntry.update({
      where: { id: first.id },
      data: { prevHash: 'f'.repeat(64) },
    });

    const issues = await runVerificationAndGetIssues();
    const walletIssues = issues.filter((issue) => issue.walletId === walletId);

    expect(
      walletIssues.some((issue) => issue.type === 'GENESIS_MISMATCH' && issue.entryId === first.id),
    ).toBe(true);
  });
});
