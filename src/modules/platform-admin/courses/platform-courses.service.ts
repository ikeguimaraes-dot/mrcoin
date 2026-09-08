import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformAdminAuditService } from '../platform-admin-audit.service';
import { CreateCourseInput } from './dto/create-course.schema';
import { UpdateCourseInput } from './dto/update-course.schema';
import { CreateLessonInput } from './dto/create-lesson.schema';
import { UpdateLessonInput } from './dto/update-lesson.schema';
import { QuizQuestionInput } from './dto/quiz-question.schema';
import { CourseNotFoundException } from './exceptions/course-not-found.exception';
import { CourseNotPublishableException } from './exceptions/course-not-publishable.exception';
import { LessonNotFoundException } from './exceptions/lesson-not-found.exception';
import { QuizQuestionNotFoundException } from './exceptions/quiz-question-not-found.exception';

const COURSE_SELECT = {
  id: true,
  title: true,
  description: true,
  coverImageUrl: true,
  displayOrder: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

/**
 * CRUD de Course/Lesson/Quiz pra PlatformAdmin — mesmo padrão de PlatformOffersService
 * (sem Idempotency-Key, não move coins; PlatformAdminAuditService.record() explícito em
 * toda escrita). Edição de questão substitui o conjunto de alternativas inteiro (mais
 * simples que CRUD de alternativa por alternativa — ver plano da feature).
 */
@Injectable()
export class PlatformCoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  async create(platformAdminId: string, input: CreateCourseInput, ip: string | undefined) {
    const course = await this.prisma.course.create({ data: input, select: COURSE_SELECT });

    await this.auditService.record({
      platformAdminId,
      action: 'COURSE_CREATED',
      payload: { courseId: course.id, title: course.title },
      ip,
    });

    return course;
  }

  async list(options?: { cursor?: string; limit?: number; status?: 'DRAFT' | 'PUBLISHED' }) {
    const limit = options?.limit ?? 20;
    const courses = await this.prisma.course.findMany({
      where: options?.status ? { status: options.status } : undefined,
      orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: COURSE_SELECT,
    });

    const hasMore = courses.length > limit;
    const page = hasMore ? courses.slice(0, limit) : courses;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }

  async getById(courseId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        ...COURSE_SELECT,
        lessons: {
          orderBy: { displayOrder: 'asc' },
          select: { id: true, title: true, videoUrl: true, durationSeconds: true, displayOrder: true },
        },
        quiz: {
          select: {
            id: true,
            questions: {
              orderBy: { displayOrder: 'asc' },
              select: {
                id: true,
                prompt: true,
                displayOrder: true,
                options: {
                  orderBy: { displayOrder: 'asc' },
                  select: { id: true, text: true, isCorrect: true, displayOrder: true },
                },
              },
            },
          },
        },
      },
    });

    if (!course) {
      throw new CourseNotFoundException();
    }

    return course;
  }

  async update(platformAdminId: string, courseId: string, input: UpdateCourseInput, ip: string | undefined) {
    await this.getExistingOrThrow(courseId);

    // Só valida ao PUBLICAR — despublicar (status: DRAFT) tem que ser sempre possível, sem
    // trava nenhuma, pra dar pro admin tirar do ar na hora um curso com problema.
    if (input.status === 'PUBLISHED') {
      await this.ensurePublishable(courseId);
    }

    const course = await this.prisma.course.update({ where: { id: courseId }, data: input, select: COURSE_SELECT });

    await this.auditService.record({
      platformAdminId,
      action: 'COURSE_UPDATED',
      payload: { courseId, changes: input },
      ip,
    });

    return course;
  }

  async addLesson(platformAdminId: string, courseId: string, input: CreateLessonInput, ip: string | undefined) {
    await this.getExistingOrThrow(courseId);

    const lesson = await this.prisma.lesson.create({ data: { ...input, courseId } });

    await this.auditService.record({
      platformAdminId,
      action: 'COURSE_LESSON_CREATED',
      payload: { courseId, lessonId: lesson.id, title: lesson.title },
      ip,
    });

    return lesson;
  }

  async updateLesson(
    platformAdminId: string,
    courseId: string,
    lessonId: string,
    input: UpdateLessonInput,
    ip: string | undefined,
  ) {
    await this.getExistingLessonOrThrow(courseId, lessonId);

    const lesson = await this.prisma.lesson.update({ where: { id: lessonId }, data: input });

    await this.auditService.record({
      platformAdminId,
      action: 'COURSE_LESSON_UPDATED',
      payload: { courseId, lessonId, changes: input },
      ip,
    });

    return lesson;
  }

  async removeLesson(platformAdminId: string, courseId: string, lessonId: string, ip: string | undefined): Promise<void> {
    await this.getExistingLessonOrThrow(courseId, lessonId);

    await this.prisma.lesson.delete({ where: { id: lessonId } });

    await this.auditService.record({
      platformAdminId,
      action: 'COURSE_LESSON_DELETED',
      payload: { courseId, lessonId },
      ip,
    });
  }

  /** Upsert do Quiz do curso (cria se ainda não existe — não há endpoint separado pra "criar
   * quiz vazio", ver plano) + cria a questão com suas alternativas. */
  async addQuestion(platformAdminId: string, courseId: string, input: QuizQuestionInput, ip: string | undefined) {
    await this.getExistingOrThrow(courseId);

    const quiz = await this.prisma.quiz.upsert({
      where: { courseId },
      create: { courseId },
      update: {},
    });

    const question = await this.prisma.quizQuestion.create({
      data: {
        quizId: quiz.id,
        prompt: input.prompt,
        displayOrder: input.displayOrder,
        options: { create: input.options },
      },
      include: { options: { orderBy: { displayOrder: 'asc' } } },
    });

    await this.auditService.record({
      platformAdminId,
      action: 'COURSE_QUIZ_QUESTION_CREATED',
      payload: { courseId, questionId: question.id },
      ip,
    });

    return question;
  }

  /** Substitui o conjunto de alternativas inteiro — apaga as antigas, cria as novas, tudo
   * numa transação (mais simples que reconciliar CRUD de alternativa por alternativa). */
  async updateQuestion(
    platformAdminId: string,
    courseId: string,
    questionId: string,
    input: QuizQuestionInput,
    ip: string | undefined,
  ) {
    await this.getExistingQuestionOrThrow(courseId, questionId);

    const question = await this.prisma.$transaction(async (tx) => {
      await tx.quizOption.deleteMany({ where: { questionId } });
      return tx.quizQuestion.update({
        where: { id: questionId },
        data: {
          prompt: input.prompt,
          displayOrder: input.displayOrder,
          options: { create: input.options },
        },
        include: { options: { orderBy: { displayOrder: 'asc' } } },
      });
    });

    await this.auditService.record({
      platformAdminId,
      action: 'COURSE_QUIZ_QUESTION_UPDATED',
      payload: { courseId, questionId },
      ip,
    });

    return question;
  }

  async removeQuestion(
    platformAdminId: string,
    courseId: string,
    questionId: string,
    ip: string | undefined,
  ): Promise<void> {
    await this.getExistingQuestionOrThrow(courseId, questionId);

    // QuizOption não tem onDelete: Cascade (é RESTRICT por padrão) — apaga as alternativas
    // antes da questão, na mesma transação, mesmo raciocínio de updateQuestion.
    await this.prisma.$transaction(async (tx) => {
      await tx.quizOption.deleteMany({ where: { questionId } });
      await tx.quizQuestion.delete({ where: { id: questionId } });
    });

    await this.auditService.record({
      platformAdminId,
      action: 'COURSE_QUIZ_QUESTION_DELETED',
      payload: { courseId, questionId },
      ip,
    });
  }

  private async getExistingOrThrow(courseId: string): Promise<void> {
    const existing = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!existing) {
      throw new CourseNotFoundException();
    }
  }

  /** Curso publicado sem aula ou sem questão quebra a experiência do funcionário (entra e não
   * tem o que assistir, ou assiste e não tem prova pra ganhar o coin) — só chamado ao
   * PUBLICAR, nunca ao despublicar. */
  private async ensurePublishable(courseId: string): Promise<void> {
    const [lessonCount, questionCount] = await Promise.all([
      this.prisma.lesson.count({ where: { courseId } }),
      this.prisma.quizQuestion.count({ where: { quiz: { courseId } } }),
    ]);

    const missing: ('lessons' | 'quizQuestions')[] = [];
    if (lessonCount === 0) missing.push('lessons');
    if (questionCount === 0) missing.push('quizQuestions');

    if (missing.length > 0) {
      throw new CourseNotPublishableException(missing);
    }
  }

  private async getExistingLessonOrThrow(courseId: string, lessonId: string): Promise<void> {
    const lesson = await this.prisma.lesson.findFirst({ where: { id: lessonId, courseId } });
    if (!lesson) {
      throw new LessonNotFoundException();
    }
  }

  private async getExistingQuestionOrThrow(courseId: string, questionId: string): Promise<void> {
    const question = await this.prisma.quizQuestion.findFirst({ where: { id: questionId, quiz: { courseId } } });
    if (!question) {
      throw new QuizQuestionNotFoundException();
    }
  }
}
