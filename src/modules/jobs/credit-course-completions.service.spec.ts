import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { CourseCreditService } from '../courses/course-credit.service';
import { COURSE_COMPLETION_REWARD_COINS } from '../courses/courses.constants';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { JobRunRecorderService } from './job-run-recorder.service';
import { CreditCourseCompletionsService } from './credit-course-completions.service';

const prisma = new PrismaService();
const ledgerService = new LedgerService(prisma);
const courseCreditService = new CourseCreditService(prisma, ledgerService);
const service = new CreditCourseCompletionsService(prisma, new JobRunRecorderService(prisma), courseCreditService);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];
const createdJobRunIds: string[] = [];

interface WalletFixture {
  organizationId: string;
  membershipId: string;
  walletId: string;
}

async function createWalletFixture(): Promise<WalletFixture> {
  const suffix = randomUUID();

  const organization = await prisma.organization.create({
    data: { name: `Credit Course Job Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });

  const user = await prisma.user.create({
    data: { cpfEncrypted: `test-encrypted-${suffix}`, cpfHash: `test-hash-${suffix}`, name: `Credit Course Job Test User ${suffix}` },
  });
  createdUserIds.push(user.id);

  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: organization.id, type: 'EMPLOYEE' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id, cachedBalance: 0 } });

  return { organizationId: organization.id, membershipId: membership.id, walletId: wallet.id };
}

async function createPaidBatch(organizationId: string, remainingCoins: number): Promise<void> {
  await prisma.coinBatch.create({
    data: {
      organizationId,
      totalCoins: remainingCoins,
      remainingCoins,
      priceInCents: remainingCoins * 10,
      status: 'PAID',
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    },
  });
}

/** Cria uma CourseCompletion PENDING pronta pro job creditar — Course/Quiz/QuizAttempt são só
 * o suporte estrutural necessário (o job não olha pra dentro deles, só pra CourseCompletion). */
async function createPendingCompletion(fixture: WalletFixture) {
  const suffix = randomUUID();
  const course = await prisma.course.create({
    data: { title: `Curso Job Test ${suffix}`, description: 'x', displayOrder: 0, status: 'PUBLISHED' },
  });
  createdCourseIds.push(course.id);
  const quiz = await prisma.quiz.create({ data: { courseId: course.id } });
  const attempt = await prisma.quizAttempt.create({
    data: { quizId: quiz.id, membershipId: fixture.membershipId, scorePercent: 100, passed: true, answers: [] },
  });
  return prisma.courseCompletion.create({
    data: {
      courseId: course.id,
      membershipId: fixture.membershipId,
      organizationId: fixture.organizationId,
      quizAttemptId: attempt.id,
    },
  });
}

async function runJobAndGetJobRun() {
  await service.run();
  const jobRun = await prisma.jobRun.findFirstOrThrow({
    where: { jobName: 'CREDIT_COURSE_COMPLETIONS' },
    orderBy: { startedAt: 'desc' },
  });
  createdJobRunIds.push(jobRun.id);
  return jobRun;
}

afterAll(async () => {
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const wallets = await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  const walletIds = wallets.map((w) => w.id);

  await prisma.jobRun.deleteMany({ where: { id: { in: createdJobRunIds } } });
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.courseCompletion.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.quizAttempt.deleteMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  await prisma.quiz.deleteMany({ where: { courseId: { in: createdCourseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { id: { in: memberships.map((m) => m.id) } } });
  await prisma.coinBatch.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });

  await prisma.$disconnect();
});

describe('CreditCourseCompletionsService', () => {
  it('credita uma pendência quando a organização tem estoque disponível', async () => {
    const fixture = await createWalletFixture();
    await createPaidBatch(fixture.organizationId, 5000);
    const completion = await createPendingCompletion(fixture);

    await runJobAndGetJobRun();

    const after = await prisma.courseCompletion.findUniqueOrThrow({ where: { id: completion.id } });
    expect(after.creditStatus).toBe('CREDITED');
    expect(after.creditedAt).not.toBeNull();

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: fixture.walletId, referenceType: 'COURSE_COMPLETION' },
    });
    expect(entries).toHaveLength(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fixture.walletId } });
    expect(wallet.cachedBalance).toBe(COURSE_COMPLETION_REWARD_COINS);
  });

  it('pula pendência sem estoque sem travar as de outras organizações', async () => {
    const withoutStock = await createWalletFixture();
    // Sem lote PAID — estoque zerado de propósito.
    const pendingWithoutStock = await createPendingCompletion(withoutStock);

    const withStock = await createWalletFixture();
    await createPaidBatch(withStock.organizationId, 5000);
    const pendingWithStock = await createPendingCompletion(withStock);

    await runJobAndGetJobRun();

    const stillPending = await prisma.courseCompletion.findUniqueOrThrow({ where: { id: pendingWithoutStock.id } });
    expect(stillPending.creditStatus).toBe('PENDING');

    const credited = await prisma.courseCompletion.findUniqueOrThrow({ where: { id: pendingWithStock.id } });
    expect(credited.creditStatus).toBe('CREDITED');
  });

  it('idempotente — rodar duas vezes não credita duas vezes', async () => {
    const fixture = await createWalletFixture();
    await createPaidBatch(fixture.organizationId, 5000);
    const completion = await createPendingCompletion(fixture);

    await runJobAndGetJobRun();
    await runJobAndGetJobRun();

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: fixture.walletId, referenceType: 'COURSE_COMPLETION' },
    });
    expect(entries).toHaveLength(1);

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: fixture.walletId } });
    expect(wallet.cachedBalance).toBe(COURSE_COMPLETION_REWARD_COINS);

    const after = await prisma.courseCompletion.findUniqueOrThrow({ where: { id: completion.id } });
    expect(after.creditStatus).toBe('CREDITED');
  });

  it('grava um JobRun com status SUCCESS e o total de créditos/pendências da passada', async () => {
    const fixture = await createWalletFixture();
    await createPaidBatch(fixture.organizationId, 5000);
    await createPendingCompletion(fixture);

    const jobRun = await runJobAndGetJobRun();

    expect(jobRun.status).toBe('SUCCESS');
    expect(jobRun.finishedAt).not.toBeNull();
    const details = jobRun.details as unknown as { credited: number; stillPending: number };
    expect(details.credited).toBeGreaterThanOrEqual(1);
  });
});
