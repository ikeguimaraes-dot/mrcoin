import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { CoinBatch, Course, Quiz } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';
import { COURSE_COMPLETION_REWARD_COINS } from './courses.constants';

interface CourseListItemBody {
  id: string;
  progress: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
}

interface CourseDetailBody {
  id: string;
  lessons: { id: string; thumbnailUrl: string | null; completed: boolean }[];
  quiz: {
    state: 'LESSONS_PENDING' | 'AVAILABLE' | 'LOCKED' | 'APPROVED';
    pendingLessons: number | null;
    lockedUntil: string | null;
    scorePercent: number | null;
  } | null;
}

interface QuizResponseBody {
  questions: { id: string; options: { id: string; text: string }[] }[];
}

interface SubmitQuizResponseBody {
  scorePercent: number;
  passed: boolean;
  retryAvailableAt: string | null;
  courseCompletion: { creditStatus: 'PENDING' | 'CREDITED'; coinsAwarded: number } | null;
}

interface ErrorResponseBody {
  code: string;
  details?: Record<string, unknown>;
}

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const createdCourseIds: string[] = [];

let app: INestApplication;
let server: Server;
let moduleRef: TestingModule;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

function tokenFor(userId: string): Promise<string> {
  return jwtService.signAsync({ sub: userId, type: 'user' });
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Courses Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });
  return organization;
}

async function createMember(organizationId: string): Promise<{ userId: string; membershipId: string; walletId: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name: `Courses Test User ${suffix}` },
  });
  createdUserIds.push(user.id);
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId, type: 'EMPLOYEE' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id } });
  return { userId: user.id, membershipId: membership.id, walletId: wallet.id };
}

async function createPaidBatch(organizationId: string, remainingCoins: number, expiresInDays: number): Promise<CoinBatch> {
  return prisma.coinBatch.create({
    data: {
      organizationId,
      totalCoins: remainingCoins,
      remainingCoins,
      priceInCents: remainingCoins * 10,
      status: 'PAID',
      expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
    },
  });
}

interface QuestionFixture {
  id: string;
  correctOptionId: string;
  wrongOptionId: string;
}

/** Cria um curso PUBLISHED com uma aula e um quiz de `questionCount` questões (2 alternativas
 * cada). `buildAnswers(correctCount)` monta um array de respostas com as `correctCount`
 * primeiras questões certas e o resto errado — usado pra cravar um scorePercent exato via
 * floor(correct*100/total), igual à regra de `CoursesService.grade`. */
async function createCourseWithQuiz(
  questionCount: number,
): Promise<{ course: Course; quiz: Quiz; lessonId: string; questions: QuestionFixture[]; buildAnswers: (correctCount: number) => { questionId: string; selectedOptionId: string }[] }> {
  const suffix = randomUUID();
  const course = await prisma.course.create({
    data: {
      title: `Curso E2E ${suffix}`,
      description: 'Descrição de teste',
      displayOrder: 0,
      status: 'PUBLISHED',
    },
  });
  createdCourseIds.push(course.id);

  const lesson = await prisma.lesson.create({
    data: { courseId: course.id, title: 'Aula 1', videoUrl: 'https://youtube.com/watch?v=unlisted', durationSeconds: 300, displayOrder: 0 },
  });

  const quiz = await prisma.quiz.create({ data: { courseId: course.id } });

  const questions: QuestionFixture[] = [];
  for (let i = 0; i < questionCount; i += 1) {
    const question = await prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        prompt: `Pergunta ${i + 1}?`,
        displayOrder: i,
        options: {
          create: [
            { text: 'Certa', isCorrect: true, displayOrder: 0 },
            { text: 'Errada', isCorrect: false, displayOrder: 1 },
          ],
        },
      },
      include: { options: true },
    });
    const correctOptionId = question.options.find((o) => o.isCorrect)!.id;
    const wrongOptionId = question.options.find((o) => !o.isCorrect)!.id;
    questions.push({ id: question.id, correctOptionId, wrongOptionId });
  }

  return {
    course,
    quiz,
    lessonId: lesson.id,
    questions,
    buildAnswers: (correctCount: number) =>
      questions.map((q, index) => ({
        questionId: q.id,
        selectedOptionId: index < correctCount ? q.correctOptionId : q.wrongOptionId,
      })),
  };
}

/** Marca a aula como assistida via API (mesma rota real) — pré-requisito pro quiz liberar
 * desde que POST/GET .../quiz passaram a exigir todas as aulas do curso assistidas. */
async function completeLesson(token: string, courseId: string, lessonId: string, organizationId: string): Promise<void> {
  await request(server)
    .post(`/courses/${courseId}/lessons/${lessonId}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .send({ organizationId })
    .expect(201);
}

/** Adiciona uma 2ª aula a um curso já criado por `createCourseWithQuiz` — usado pra testar o
 * gate de "assistiu todas as aulas" com mais de uma aula pendente. */
async function addLesson(courseId: string, displayOrder: number): Promise<string> {
  const lesson = await prisma.lesson.create({
    data: {
      courseId,
      title: `Aula ${displayOrder + 1}`,
      videoUrl: 'https://youtube.com/watch?v=unlisted',
      durationSeconds: 300,
      displayOrder,
    },
  });
  return lesson.id;
}

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const wallets = await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  const walletIds = wallets.map((w) => w.id);

  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.courseCompletion.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.quizAttempt.deleteMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  await prisma.lessonCompletion.deleteMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  await prisma.quizOption.deleteMany({ where: { question: { quiz: { courseId: { in: createdCourseIds } } } } });
  await prisma.quizQuestion.deleteMany({ where: { quiz: { courseId: { in: createdCourseIds } } } });
  await prisma.quiz.deleteMany({ where: { courseId: { in: createdCourseIds } } });
  await prisma.lesson.deleteMany({ where: { courseId: { in: createdCourseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.coinBatch.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('GET /courses', () => {
  it('sem token retorna 401', async () => {
    const org = await createOrg();
    await request(server).get('/courses').query({ organizationId: org.id }).expect(401);
  });

  it('reflete o progresso: não iniciado, em andamento (assistiu aula) e concluído (passou no quiz)', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    await createPaidBatch(org.id, 5000, 90);

    const untouched = await createCourseWithQuiz(5);
    const started = await createCourseWithQuiz(5);
    const completed = await createCourseWithQuiz(5);

    await request(server)
      .post(`/courses/${started.course.id}/lessons/${started.lessonId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ organizationId: org.id })
      .expect(201);

    await completeLesson(token, completed.course.id, completed.lessonId, org.id);
    await request(server)
      .post(`/courses/${completed.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: completed.buildAnswers(5) })
      .expect(201);

    const res = await request(server)
      .get('/courses')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const items = (res.body as { items: CourseListItemBody[] }).items;

    expect(items.find((i) => i.id === untouched.course.id)?.progress).toBe('NOT_STARTED');
    expect(items.find((i) => i.id === started.course.id)?.progress).toBe('IN_PROGRESS');
    expect(items.find((i) => i.id === completed.course.id)?.progress).toBe('COMPLETED');
  });

  it('curso em rascunho (DRAFT) não aparece na lista', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const suffix = randomUUID();
    const draft = await prisma.course.create({
      data: { title: `Rascunho ${suffix}`, description: 'x', displayOrder: 0, status: 'DRAFT' },
    });
    createdCourseIds.push(draft.id);

    const res = await request(server)
      .get('/courses')
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const items = (res.body as { items: CourseListItemBody[] }).items;
    expect(items.some((i) => i.id === draft.id)).toBe(false);
  });
});

describe('GET /courses/:id', () => {
  it('aula devolve thumbnailUrl — com valor e com null', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const fixture = await createCourseWithQuiz(1);

    await prisma.lesson.update({
      where: { id: fixture.lessonId },
      data: { thumbnailUrl: 'https://example.com/thumb.png' },
    });
    const withThumbnail = await request(server)
      .get(`/courses/${fixture.course.id}`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((withThumbnail.body as CourseDetailBody).lessons[0]).toMatchObject({
      thumbnailUrl: 'https://example.com/thumb.png',
    });

    await prisma.lesson.update({ where: { id: fixture.lessonId }, data: { thumbnailUrl: null } });
    const withoutThumbnail = await request(server)
      .get(`/courses/${fixture.course.id}`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((withoutThumbnail.body as CourseDetailBody).lessons[0]).toMatchObject({ thumbnailUrl: null });
  });
});

describe('GET /courses/:id/quiz', () => {
  it('nunca inclui isCorrect nas alternativas', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const fixture = await createCourseWithQuiz(3);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    const res = await request(server)
      .get(`/courses/${fixture.course.id}/quiz`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as QuizResponseBody;

    expect(body.questions).toHaveLength(3);
    for (const question of body.questions) {
      for (const option of question.options) {
        expect(option).not.toHaveProperty('isCorrect');
      }
    }
  });
});

describe('Quiz bloqueado por aulas pendentes', () => {
  it('aula pendente bloqueia GET/POST do quiz e informa quantas faltam', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const fixture = await createCourseWithQuiz(5);
    await addLesson(fixture.course.id, 1);
    // Só a 1ª das 2 aulas assistida — falta 1.
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    const detailRes = await request(server)
      .get(`/courses/${fixture.course.id}`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const quizState = (detailRes.body as CourseDetailBody).quiz;
    expect(quizState?.state).toBe('LESSONS_PENDING');
    expect(quizState?.pendingLessons).toBe(1);

    const quizRes = await request(server)
      .get(`/courses/${fixture.course.id}/quiz`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(422);
    expect((quizRes.body as ErrorResponseBody).code).toBe('QUIZ_LESSONS_PENDING');
    expect((quizRes.body as ErrorResponseBody).details).toEqual({ pendingLessons: 1 });

    const submitRes = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(5) })
      .expect(422);
    expect((submitRes.body as ErrorResponseBody).code).toBe('QUIZ_LESSONS_PENDING');
    expect((submitRes.body as ErrorResponseBody).details).toEqual({ pendingLessons: 1 });

    const attempts = await prisma.quizAttempt.findMany({
      where: { quizId: fixture.quiz.id, membershipId: member.membershipId },
    });
    expect(attempts).toHaveLength(0);
  });

  it('assistir a aula que faltava libera o quiz na hora', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    await createPaidBatch(org.id, 5000, 90);
    const fixture = await createCourseWithQuiz(5);
    const secondLessonId = await addLesson(fixture.course.id, 1);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    const blockedDetail = await request(server)
      .get(`/courses/${fixture.course.id}`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((blockedDetail.body as CourseDetailBody).quiz).toMatchObject({ state: 'LESSONS_PENDING' });

    await completeLesson(token, fixture.course.id, secondLessonId, org.id);

    const unlockedDetail = await request(server)
      .get(`/courses/${fixture.course.id}`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((unlockedDetail.body as CourseDetailBody).quiz).toMatchObject({ state: 'AVAILABLE' });

    await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(5) })
      .expect(201);
  });

  it('curso sem nenhuma aula cadastrada nunca fica LESSONS_PENDING', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    await createPaidBatch(org.id, 5000, 90);

    const suffix = randomUUID();
    const course = await prisma.course.create({
      data: { title: `Curso Sem Aula ${suffix}`, description: 'x', displayOrder: 0, status: 'PUBLISHED' },
    });
    createdCourseIds.push(course.id);
    const quiz = await prisma.quiz.create({ data: { courseId: course.id } });
    const question = await prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        prompt: 'Pergunta única?',
        displayOrder: 0,
        options: {
          create: [
            { text: 'Certa', isCorrect: true, displayOrder: 0 },
            { text: 'Errada', isCorrect: false, displayOrder: 1 },
          ],
        },
      },
      include: { options: true },
    });
    const correctOptionId = question.options.find((o) => o.isCorrect)!.id;

    const detailRes = await request(server)
      .get(`/courses/${course.id}`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detailRes.body as CourseDetailBody).quiz).toMatchObject({ state: 'AVAILABLE' });

    await request(server)
      .get(`/courses/${course.id}/quiz`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const submitRes = await request(server)
      .post(`/courses/${course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: [{ questionId: question.id, selectedOptionId: correctOptionId }] })
      .expect(201);
    expect((submitRes.body as SubmitQuizResponseBody).passed).toBe(true);
  });
});

describe('POST /courses/:id/quiz/submit', () => {
  it('80% exato aprova e credita os 50 coins na hora quando há estoque', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    await createPaidBatch(org.id, 5000, 90);
    // 4/5 corretas = 80,0% exato.
    const fixture = await createCourseWithQuiz(5);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    const res = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(4) })
      .expect(201);
    const body = res.body as SubmitQuizResponseBody;

    expect(body.scorePercent).toBe(80);
    expect(body.passed).toBe(true);
    expect(body.courseCompletion).toEqual({ creditStatus: 'CREDITED', coinsAwarded: COURSE_COMPLETION_REWARD_COINS });

    const wallet = await prisma.wallet.findUniqueOrThrow({ where: { id: member.walletId } });
    expect(wallet.cachedBalance).toBe(COURSE_COMPLETION_REWARD_COINS);
    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: member.walletId, referenceType: 'COURSE_COMPLETION' },
    });
    expect(entries).toHaveLength(1);
  });

  it('79% exato reprova — nunca arredonda pra cima', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    // floor(19*100/24) = floor(79.16) = 79% exato.
    const fixture = await createCourseWithQuiz(24);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    const res = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(19) })
      .expect(201);
    const body = res.body as SubmitQuizResponseBody;

    expect(body.scorePercent).toBe(79);
    expect(body.passed).toBe(false);
    expect(body.courseCompletion).toBeNull();
    expect(body.retryAvailableAt).not.toBeNull();

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: member.walletId, referenceType: 'COURSE_COMPLETION' },
    });
    expect(entries).toHaveLength(0);
  });

  it('reprovado não pode resubmeter antes de 7 dias — 429 QUIZ_RETRY_LOCKED', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    const fixture = await createCourseWithQuiz(5);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(0) })
      .expect(201);

    const res = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(5) })
      .expect(429);
    expect((res.body as ErrorResponseBody).code).toBe('QUIZ_RETRY_LOCKED');
  });

  it('depois dos 7 dias, reprovado pode resubmeter e aprovar', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    await createPaidBatch(org.id, 5000, 90);
    const fixture = await createCourseWithQuiz(5);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(0) })
      .expect(201);

    // Adianta a tentativa reprovada pra fora da janela de 7 dias (só manipulação direta via
    // Prisma pra não depender de tempo real em teste).
    await prisma.quizAttempt.updateMany({
      where: { quizId: fixture.quiz.id, membershipId: member.membershipId },
      data: { createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) },
    });

    const res = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(5) })
      .expect(201);
    const body = res.body as SubmitQuizResponseBody;

    expect(body.passed).toBe(true);
    expect(body.courseCompletion?.creditStatus).toBe('CREDITED');
  });

  it('curso já concluído não credita de novo numa segunda submissão aprovada — 409', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    await createPaidBatch(org.id, 5000, 90);
    const fixture = await createCourseWithQuiz(5);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(5) })
      .expect(201);

    const res = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(5) })
      .expect(409);
    expect((res.body as ErrorResponseBody).code).toBe('COURSE_ALREADY_COMPLETED');

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: member.walletId, referenceType: 'COURSE_COMPLETION' },
    });
    expect(entries).toHaveLength(1);
  });

  it('duas submissões concorrentes aprovadas nunca creditam duas vezes', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    await createPaidBatch(org.id, 5000, 90);
    const fixture = await createCourseWithQuiz(5);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    const [resA, resB] = await Promise.all([
      request(server)
        .post(`/courses/${fixture.course.id}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `test-${randomUUID()}`)
        .send({ organizationId: org.id, answers: fixture.buildAnswers(5) }),
      request(server)
        .post(`/courses/${fixture.course.id}/quiz/submit`)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', `test-${randomUUID()}`)
        .send({ organizationId: org.id, answers: fixture.buildAnswers(5) }),
    ]);

    // O desfecho exato depende do timing: se as duas chegarem quase juntas na criação da
    // CourseCompletion, a 2ª esbarra no unique constraint e devolve 201 com a MESMA completion
    // (createCompletionOrFindExisting); se a 1ª já tiver terminado antes da 2ª começar, a 2ª
    // encontra `existingCompletion` logo no início e recebe 409 COURSE_ALREADY_COMPLETED. As
    // duas são corretas — o que a regra de negócio garante é nunca creditar duas vezes, não uma
    // combinação específica de status HTTP.
    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual(expect.arrayContaining([201]));
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: member.walletId, referenceType: 'COURSE_COMPLETION' },
    });
    expect(entries).toHaveLength(1);
    const completions = await prisma.courseCompletion.findMany({
      where: { courseId: fixture.course.id, membershipId: member.membershipId },
    });
    expect(completions).toHaveLength(1);
  });

  it('estoque insuficiente no momento da aprovação: aprovação nunca se perde, fica PENDING sem LedgerEntry', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    // Sem lote PAID — estoque zerado.
    const fixture = await createCourseWithQuiz(5);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    const res = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(5) })
      .expect(201);
    const body = res.body as SubmitQuizResponseBody;

    expect(body.passed).toBe(true);
    expect(body.courseCompletion).toEqual({ creditStatus: 'PENDING', coinsAwarded: COURSE_COMPLETION_REWARD_COINS });

    const completion = await prisma.courseCompletion.findUniqueOrThrow({
      where: { courseId_membershipId: { courseId: fixture.course.id, membershipId: member.membershipId } },
    });
    expect(completion.creditStatus).toBe('PENDING');

    const entries = await prisma.ledgerEntry.findMany({
      where: { walletId: member.walletId, referenceType: 'COURSE_COMPLETION' },
    });
    expect(entries).toHaveLength(0);

    // Um lote passa a existir depois — o job (testado em separado) é quem credita; aqui só
    // confirmamos que a aprovação sobreviveu intacta, esperando o crédito.
    const detailRes = await request(server)
      .get(`/courses/${fixture.course.id}`)
      .query({ organizationId: org.id })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detailRes.body as CourseDetailBody).quiz?.state).toBe('APPROVED');
  });

  it('replay por Idempotency-Key devolve o mesmo resultado sem criar 2ª tentativa', async () => {
    const org = await createOrg();
    const member = await createMember(org.id);
    const token = await tokenFor(member.userId);
    await createPaidBatch(org.id, 5000, 90);
    const fixture = await createCourseWithQuiz(5);
    await completeLesson(token, fixture.course.id, fixture.lessonId, org.id);

    const idempotencyKey = `test-${randomUUID()}`;
    const first = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(5) })
      .expect(201);

    const second = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', idempotencyKey)
      .send({ organizationId: org.id, answers: fixture.buildAnswers(5) })
      .expect(201);

    expect(second.body).toEqual(first.body);

    const attempts = await prisma.quizAttempt.findMany({ where: { quizId: fixture.quiz.id, membershipId: member.membershipId } });
    expect(attempts).toHaveLength(1);
  });

  it('isolamento por organização — mesma pessoa em duas organizações tem progresso e estoque independentes', async () => {
    const orgA = await createOrg();
    const orgB = await createOrg();
    await createPaidBatch(orgA.id, 5000, 90);
    // orgB fica sem estoque de propósito.

    const cpf = randomCpf();
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name: `Courses Isolation User ${suffix}` },
    });
    createdUserIds.push(user.id);
    const membershipA = await prisma.membership.create({ data: { userId: user.id, organizationId: orgA.id, type: 'EMPLOYEE' } });
    const walletA = await prisma.wallet.create({ data: { membershipId: membershipA.id } });
    const membershipB = await prisma.membership.create({ data: { userId: user.id, organizationId: orgB.id, type: 'EMPLOYEE' } });
    await prisma.wallet.create({ data: { membershipId: membershipB.id } });

    const token = await tokenFor(user.id);
    const fixture = await createCourseWithQuiz(5);
    await completeLesson(token, fixture.course.id, fixture.lessonId, orgA.id);
    await completeLesson(token, fixture.course.id, fixture.lessonId, orgB.id);

    const resA = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: orgA.id, answers: fixture.buildAnswers(5) })
      .expect(201);
    expect((resA.body as SubmitQuizResponseBody).courseCompletion?.creditStatus).toBe('CREDITED');

    const resB = await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Authorization', `Bearer ${token}`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: orgB.id, answers: fixture.buildAnswers(5) })
      .expect(201);
    // Aprovou nos dois (mesma pessoa, cursos são globais), mas só orgA tinha estoque — orgB
    // fica PENDING, provando que o crédito é por organização, não por pessoa.
    expect((resB.body as SubmitQuizResponseBody).courseCompletion?.creditStatus).toBe('PENDING');

    const walletAAfter = await prisma.wallet.findUniqueOrThrow({ where: { id: walletA.id } });
    expect(walletAAfter.cachedBalance).toBe(COURSE_COMPLETION_REWARD_COINS);
  });

  it('sem token retorna 401', async () => {
    const fixture = await createCourseWithQuiz(5);
    await request(server)
      .post(`/courses/${fixture.course.id}/quiz/submit`)
      .set('Idempotency-Key', `test-${randomUUID()}`)
      .send({ organizationId: randomUUID(), answers: fixture.buildAnswers(5) })
      .expect(401);
  });
});
