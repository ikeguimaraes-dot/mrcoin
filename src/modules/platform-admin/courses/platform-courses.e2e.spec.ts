import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../../auth/password.util';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../../settings/settings.constants';
import { PLATFORM_JWT_SERVICE } from '../platform-jwt.token';

interface CourseSummaryBody {
  id: string;
  title: string;
  status: 'DRAFT' | 'PUBLISHED';
  displayOrder: number;
}

interface LessonBody {
  id: string;
  title: string;
}

interface QuizOptionAdminBody {
  id: string;
  text: string;
  isCorrect: boolean;
}

interface QuizQuestionAdminBody {
  id: string;
  prompt: string;
  options: QuizOptionAdminBody[];
}

interface CourseDetailAdminBody extends CourseSummaryBody {
  lessons: LessonBody[];
  quiz: { id: string; questions: QuizQuestionAdminBody[] } | null;
}

const prisma = new PrismaService();
const createdCourseIds: string[] = [];
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const createdPlatformAdminIds: string[] = [];

let app: INestApplication;
let server: Server;
let platformJwtService: JwtService;

const FIXTURE_PASSWORD = 'Test@Password123';

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createPlatformAdminFixture(): Promise<{ platformAdminId: string; token: string }> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `E2E Platform Courses Admin ${suffix}`,
      email: `e2e-platform-courses-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  const token = platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
  return { platformAdminId: platformAdmin.id, token };
}

function createCourseBody(overrides?: Partial<{ title: string; displayOrder: number }>) {
  const suffix = randomUUID();
  return {
    title: overrides?.title ?? `Curso Admin E2E ${suffix}`,
    description: 'Descrição de teste',
    displayOrder: overrides?.displayOrder ?? 0,
  };
}

/** Deixa o curso publicável: 1 aula + 1 questão de quiz — usado nos testes que precisam
 * publicar de verdade, não nos que testam a validação de "não publicável". */
async function addLessonAndQuestion(token: string, courseId: string): Promise<void> {
  await request(server)
    .post(`/platform/courses/${courseId}/lessons`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'Aula 1', videoUrl: 'https://youtube.com/watch?v=unlisted', durationSeconds: 300, displayOrder: 0 })
    .expect(201);
  await request(server)
    .post(`/platform/courses/${courseId}/quiz/questions`)
    .set('Authorization', `Bearer ${token}`)
    .send({
      prompt: 'Pergunta?',
      displayOrder: 0,
      options: [
        { text: 'Certa', isCorrect: true, displayOrder: 0 },
        { text: 'Errada', isCorrect: false, displayOrder: 1 },
      ],
    })
    .expect(201);
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
  platformJwtService = app.get<JwtService>(PLATFORM_JWT_SERVICE);
}, 30000);

afterAll(async () => {
  await app.close();
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const wallets = await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });

  await prisma.courseCompletion.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.quizAttempt.deleteMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  await prisma.lessonCompletion.deleteMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } });
  await prisma.quizOption.deleteMany({ where: { question: { quiz: { courseId: { in: createdCourseIds } } } } });
  await prisma.quizQuestion.deleteMany({ where: { quiz: { courseId: { in: createdCourseIds } } } });
  await prisma.quiz.deleteMany({ where: { courseId: { in: createdCourseIds } } });
  await prisma.lesson.deleteMany({ where: { courseId: { in: createdCourseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: createdCourseIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: wallets.map((w) => w.id) } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.platformAdminAuditLog.deleteMany({ where: { platformAdminId: { in: createdPlatformAdminIds } } });
  await prisma.platformAdminRefreshToken.deleteMany({ where: { platformAdminId: { in: createdPlatformAdminIds } } });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdPlatformAdminIds } } });
  await prisma.$disconnect();
});

describe('CRUD completo — /platform/courses', () => {
  it('cria curso (nasce DRAFT), lista, mostra detalhe e atualiza', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();

    const createRes = await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(createCourseBody())
      .expect(201);
    const created = createRes.body as CourseSummaryBody;
    createdCourseIds.push(created.id);
    expect(created.status).toBe('DRAFT');

    const listRes = await request(server).get('/platform/courses').set('Authorization', `Bearer ${token}`).expect(200);
    const listBody = listRes.body as { items: CourseSummaryBody[] };
    expect(listBody.items.some((c) => c.id === created.id)).toBe(true);

    const detailRes = await request(server)
      .get(`/platform/courses/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const detail = detailRes.body as CourseDetailAdminBody;
    expect(detail.id).toBe(created.id);
    expect(detail.lessons).toEqual([]);
    expect(detail.quiz).toBeNull();

    const patchRes = await request(server)
      .patch(`/platform/courses/${created.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Título Atualizado' })
      .expect(200);
    const patched = patchRes.body as CourseSummaryBody;
    expect(patched.title).toBe('Título Atualizado');
    expect(patched.status).toBe('DRAFT');

    const createLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'COURSE_CREATED' },
    });
    expect(createLog).not.toBeNull();
    const updateLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'COURSE_UPDATED' },
    });
    expect(updateLog).not.toBeNull();
  });

  it('curso inexistente no GET/PATCH retorna 404', async () => {
    const { token } = await createPlatformAdminFixture();

    await request(server).get(`/platform/courses/${randomUUID()}`).set('Authorization', `Bearer ${token}`).expect(404);
    await request(server)
      .patch(`/platform/courses/${randomUUID()}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'X' })
      .expect(404);
  });

  it('CRUD de aulas: adiciona, atualiza e remove', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();
    const createRes = await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(createCourseBody())
      .expect(201);
    const course = createRes.body as CourseSummaryBody;
    createdCourseIds.push(course.id);

    const lessonRes = await request(server)
      .post(`/platform/courses/${course.id}/lessons`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Aula 1', videoUrl: 'https://youtube.com/watch?v=unlisted', durationSeconds: 300, displayOrder: 0 })
      .expect(201);
    const lesson = lessonRes.body as LessonBody;

    const updateLessonRes = await request(server)
      .patch(`/platform/courses/${course.id}/lessons/${lesson.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Aula 1 Revisada' })
      .expect(200);
    expect((updateLessonRes.body as LessonBody).title).toBe('Aula 1 Revisada');

    await request(server)
      .delete(`/platform/courses/${course.id}/lessons/${lesson.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const detailRes = await request(server)
      .get(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detailRes.body as CourseDetailAdminBody).lessons).toEqual([]);

    const actions = await prisma.platformAdminAuditLog.findMany({ where: { platformAdminId } });
    expect(actions.some((a) => a.action === 'COURSE_LESSON_CREATED')).toBe(true);
    expect(actions.some((a) => a.action === 'COURSE_LESSON_UPDATED')).toBe(true);
    expect(actions.some((a) => a.action === 'COURSE_LESSON_DELETED')).toBe(true);
  });

  it('CRUD de questões do quiz: cria com alternativas, substitui o conjunto no update, remove — isCorrect visível pro admin', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();
    const createRes = await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(createCourseBody())
      .expect(201);
    const course = createRes.body as CourseSummaryBody;
    createdCourseIds.push(course.id);

    const questionRes = await request(server)
      .post(`/platform/courses/${course.id}/quiz/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        prompt: 'Qual a capital do Brasil?',
        displayOrder: 0,
        options: [
          { text: 'Brasília', isCorrect: true, displayOrder: 0 },
          { text: 'Rio de Janeiro', isCorrect: false, displayOrder: 1 },
        ],
      })
      .expect(201);
    const question = questionRes.body as QuizQuestionAdminBody;
    expect(question.options).toHaveLength(2);
    expect(question.options.find((o) => o.isCorrect)?.text).toBe('Brasília');

    // Quiz foi criado via upsert implícito — confere no detalhe (visão de admin expõe isCorrect).
    const detailAfterCreate = await request(server)
      .get(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detailAfterCreate.body as CourseDetailAdminBody).quiz?.questions).toHaveLength(1);

    const updateRes = await request(server)
      .patch(`/platform/courses/${course.id}/quiz/questions/${question.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        prompt: 'Qual a capital do Brasil? (revisado)',
        displayOrder: 0,
        options: [
          { text: 'São Paulo', isCorrect: false, displayOrder: 0 },
          { text: 'Brasília', isCorrect: true, displayOrder: 1 },
          { text: 'Salvador', isCorrect: false, displayOrder: 2 },
        ],
      })
      .expect(200);
    const updated = updateRes.body as QuizQuestionAdminBody;
    // Substituiu o conjunto inteiro — 3 alternativas novas, não 2 antigas + 3 novas.
    expect(updated.options).toHaveLength(3);
    expect(updated.options.filter((o) => o.isCorrect)).toHaveLength(1);

    await request(server)
      .delete(`/platform/courses/${course.id}/quiz/questions/${question.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const detailAfterDelete = await request(server)
      .get(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detailAfterDelete.body as CourseDetailAdminBody).quiz?.questions).toEqual([]);

    const actions = await prisma.platformAdminAuditLog.findMany({ where: { platformAdminId } });
    expect(actions.some((a) => a.action === 'COURSE_QUIZ_QUESTION_CREATED')).toBe(true);
    expect(actions.some((a) => a.action === 'COURSE_QUIZ_QUESTION_UPDATED')).toBe(true);
    expect(actions.some((a) => a.action === 'COURSE_QUIZ_QUESTION_DELETED')).toBe(true);
  });

  it('exige exatamente uma alternativa correta — 400 se 0 ou 2+ marcadas', async () => {
    const { token } = await createPlatformAdminFixture();
    const createRes = await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(createCourseBody())
      .expect(201);
    const course = createRes.body as CourseSummaryBody;
    createdCourseIds.push(course.id);

    await request(server)
      .post(`/platform/courses/${course.id}/quiz/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        prompt: 'Sem correta',
        displayOrder: 0,
        options: [
          { text: 'A', isCorrect: false, displayOrder: 0 },
          { text: 'B', isCorrect: false, displayOrder: 1 },
        ],
      })
      .expect(400);

    await request(server)
      .post(`/platform/courses/${course.id}/quiz/questions`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        prompt: 'Duas corretas',
        displayOrder: 0,
        options: [
          { text: 'A', isCorrect: true, displayOrder: 0 },
          { text: 'B', isCorrect: true, displayOrder: 1 },
        ],
      })
      .expect(400);
  });
});

describe('Regra de publicação — precisa de pelo menos 1 aula e 1 questão de quiz', () => {
  it('publicar curso vazio (sem aula, sem quiz) retorna 422 COURSE_NOT_PUBLISHABLE listando os dois', async () => {
    const { token } = await createPlatformAdminFixture();
    const createRes = await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(createCourseBody())
      .expect(201);
    const course = createRes.body as CourseSummaryBody;
    createdCourseIds.push(course.id);

    const res = await request(server)
      .patch(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PUBLISHED' })
      .expect(422);
    const body = res.body as { code: string; details?: { missing?: string[] } };
    expect(body.code).toBe('COURSE_NOT_PUBLISHABLE');
    expect(body.details?.missing?.sort()).toEqual(['lessons', 'quizQuestions']);

    const unchanged = await prisma.course.findUniqueOrThrow({ where: { id: course.id } });
    expect(unchanged.status).toBe('DRAFT');
  });

  it('publicar curso com aula mas sem questão de quiz retorna 422 listando só quizQuestions', async () => {
    const { token } = await createPlatformAdminFixture();
    const createRes = await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(createCourseBody())
      .expect(201);
    const course = createRes.body as CourseSummaryBody;
    createdCourseIds.push(course.id);

    await request(server)
      .post(`/platform/courses/${course.id}/lessons`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Aula 1', videoUrl: 'https://youtube.com/watch?v=unlisted', durationSeconds: 300, displayOrder: 0 })
      .expect(201);

    const res = await request(server)
      .patch(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PUBLISHED' })
      .expect(422);
    const body = res.body as { code: string; details?: { missing?: string[] } };
    expect(body.code).toBe('COURSE_NOT_PUBLISHABLE');
    expect(body.details?.missing).toEqual(['quizQuestions']);
  });

  it('curso com aula e questão publica normalmente', async () => {
    const { token } = await createPlatformAdminFixture();
    const createRes = await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(createCourseBody())
      .expect(201);
    const course = createRes.body as CourseSummaryBody;
    createdCourseIds.push(course.id);
    await addLessonAndQuestion(token, course.id);

    const res = await request(server)
      .patch(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PUBLISHED' })
      .expect(200);
    expect((res.body as CourseSummaryBody).status).toBe('PUBLISHED');
  });

  it('despublicar (PUBLISHED → DRAFT) é sempre permitido, mesmo se o curso ficou sem aula/quiz depois de publicado', async () => {
    const { token } = await createPlatformAdminFixture();
    const createRes = await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${token}`)
      .send(createCourseBody())
      .expect(201);
    const course = createRes.body as CourseSummaryBody;
    createdCourseIds.push(course.id);
    await addLessonAndQuestion(token, course.id);

    await request(server)
      .patch(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'PUBLISHED' })
      .expect(200);

    // Remove a única aula depois de publicado — curso fica no ar e quebrado (cenário que
    // justifica o admin precisar tirar do ar sem qualquer trava).
    const detail = (
      await request(server).get(`/platform/courses/${course.id}`).set('Authorization', `Bearer ${token}`).expect(200)
    ).body as CourseDetailAdminBody;
    await request(server)
      .delete(`/platform/courses/${course.id}/lessons/${detail.lessons[0]!.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const unpublishRes = await request(server)
      .patch(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ status: 'DRAFT' })
      .expect(200);
    expect((unpublishRes.body as CourseSummaryBody).status).toBe('DRAFT');
  });
});

describe('Publicar/despublicar reflete em GET /courses do funcionário', () => {
  it('curso DRAFT não aparece pro funcionário; PUBLISHED aparece; voltar pra DRAFT some de novo', async () => {
    const { token: adminToken } = await createPlatformAdminFixture();
    const createRes = await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(createCourseBody())
      .expect(201);
    const course = createRes.body as CourseSummaryBody;
    createdCourseIds.push(course.id);
    await addLessonAndQuestion(adminToken, course.id);

    const suffix = randomUUID();
    const organization = await prisma.organization.create({
      data: { name: `Platform Courses Employee Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
    });
    createdOrgIds.push(organization.id);
    await prisma.conversionRate.create({
      data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
    });
    const cpf = randomCpf();
    const user = await prisma.user.create({
      data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name: `Platform Courses Employee ${suffix}` },
    });
    createdUserIds.push(user.id);
    const membership = await prisma.membership.create({ data: { userId: user.id, organizationId: organization.id, type: 'EMPLOYEE' } });
    await prisma.wallet.create({ data: { membershipId: membership.id } });
    const employeeJwtService = app.get(JwtService);
    const employeeToken = await employeeJwtService.signAsync({ sub: user.id, type: 'user' });

    const beforePublish = await request(server)
      .get('/courses')
      .query({ organizationId: organization.id })
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);
    expect((beforePublish.body as { items: CourseSummaryBody[] }).items.some((c) => c.id === course.id)).toBe(false);

    await request(server)
      .patch(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'PUBLISHED' })
      .expect(200);

    const afterPublish = await request(server)
      .get('/courses')
      .query({ organizationId: organization.id })
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);
    expect((afterPublish.body as { items: CourseSummaryBody[] }).items.some((c) => c.id === course.id)).toBe(true);

    await request(server)
      .patch(`/platform/courses/${course.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'DRAFT' })
      .expect(200);

    const afterUnpublish = await request(server)
      .get('/courses')
      .query({ organizationId: organization.id })
      .set('Authorization', `Bearer ${employeeToken}`)
      .expect(200);
    expect((afterUnpublish.body as { items: CourseSummaryBody[] }).items.some((c) => c.id === course.id)).toBe(false);
  });
});

describe('Isolamento total — apenas PlatformAdmin acessa /platform/courses', () => {
  it('token de AdminUser recebe 401', async () => {
    const jwtService = app.get(JwtService);
    const accessToken = jwtService.sign({ sub: randomUUID(), organizationId: randomUUID(), role: 'OPERATOR', type: 'admin' });

    await request(server).get('/platform/courses').set('Authorization', `Bearer ${accessToken}`).expect(401);
    await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${accessToken}`)
      .send(createCourseBody())
      .expect(401);
  });

  it('token de Partner recebe 401', async () => {
    const jwtService = app.get(JwtService);
    const partnerToken = jwtService.sign({ sub: randomUUID(), type: 'partner' });

    await request(server).get('/platform/courses').set('Authorization', `Bearer ${partnerToken}`).expect(401);
    await request(server)
      .post('/platform/courses')
      .set('Authorization', `Bearer ${partnerToken}`)
      .send(createCourseBody())
      .expect(401);
  });

  it('sem token retorna 401', async () => {
    await request(server).get('/platform/courses').expect(401);
  });
});
