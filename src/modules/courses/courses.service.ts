import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { WalletsService } from '../wallets/wallets.service';
import { CourseCreditService } from './course-credit.service';
import { CourseAlreadyCompletedException } from './exceptions/course-already-completed.exception';
import { QuizRetryLockedException } from './exceptions/quiz-retry-locked.exception';
import { SubmitQuizInput } from './dto/submit-quiz.schema';
import { COURSE_COMPLETION_REWARD_COINS, PASSING_SCORE_PERCENT, RETRY_LOCKOUT_DAYS } from './courses.constants';

const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

export interface CourseListItem {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  displayOrder: number;
  progress: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED';
}

export interface CourseLessonView {
  id: string;
  title: string;
  videoUrl: string;
  durationSeconds: number;
  displayOrder: number;
  completed: boolean;
}

export interface QuizStateView {
  state: 'AVAILABLE' | 'LOCKED' | 'APPROVED';
  lockedUntil: string | null;
  approvedAt: string | null;
  scorePercent: number | null;
}

export interface CourseDetailView {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  lessons: CourseLessonView[];
  quiz: QuizStateView | null;
}

export interface QuizView {
  questions: {
    id: string;
    prompt: string;
    displayOrder: number;
    options: { id: string; text: string; displayOrder: number }[];
  }[];
}

export interface SubmitQuizResult {
  scorePercent: number;
  passed: boolean;
  retryAvailableAt: string | null;
  courseCompletion: { creditStatus: 'PENDING' | 'CREDITED'; coinsAwarded: number } | null;
}

/**
 * Endpoints do funcionário. Cursos são conteúdo da mrcoin (sem organizationId) — o
 * `organizationId` que todo método recebe aqui é só pra resolver a Membership/Wallet certa
 * (via WalletsService.resolveWalletId, reaproveitado) e pra saber de qual estoque tirar o
 * prêmio, nunca pra filtrar QUAIS cursos existem.
 */
@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletsService: WalletsService,
    private readonly courseCreditService: CourseCreditService,
  ) {}

  async listCourses(userId: string, organizationId: string): Promise<{ items: CourseListItem[] }> {
    const { membershipId } = await this.walletsService.resolveWalletId(userId, organizationId);

    const courses = await this.prisma.course.findMany({
      where: { status: 'PUBLISHED' },
      orderBy: { displayOrder: 'asc' },
    });

    const courseIds = courses.map((c) => c.id);

    const [completions, lessonCompletions] = await Promise.all([
      this.prisma.courseCompletion.findMany({ where: { membershipId, courseId: { in: courseIds } } }),
      this.prisma.lessonCompletion.findMany({
        where: { membershipId, lesson: { courseId: { in: courseIds } } },
        select: { lesson: { select: { courseId: true } } },
      }),
    ]);

    const completedCourseIds = new Set(completions.map((c) => c.courseId));
    const startedCourseIds = new Set(lessonCompletions.map((lc) => lc.lesson.courseId));

    return {
      items: courses.map((course) => ({
        id: course.id,
        title: course.title,
        description: course.description,
        coverImageUrl: course.coverImageUrl,
        displayOrder: course.displayOrder,
        progress: completedCourseIds.has(course.id)
          ? 'COMPLETED'
          : startedCourseIds.has(course.id)
            ? 'IN_PROGRESS'
            : 'NOT_STARTED',
      })),
    };
  }

  async getCourseDetail(userId: string, organizationId: string, courseId: string): Promise<CourseDetailView> {
    const { membershipId } = await this.walletsService.resolveWalletId(userId, organizationId);

    const course = await this.prisma.course.findFirst({
      where: { id: courseId, status: 'PUBLISHED' },
      include: { lessons: { orderBy: { displayOrder: 'asc' } }, quiz: true },
    });
    if (!course) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Curso não encontrado.' });
    }

    const lessonCompletions = await this.prisma.lessonCompletion.findMany({
      where: { membershipId, lessonId: { in: course.lessons.map((l) => l.id) } },
    });
    const completedLessonIds = new Set(lessonCompletions.map((lc) => lc.lessonId));

    const quiz = course.quiz ? await this.resolveQuizState(membershipId, courseId, course.quiz.id) : null;

    return {
      id: course.id,
      title: course.title,
      description: course.description,
      coverImageUrl: course.coverImageUrl,
      lessons: course.lessons.map((lesson) => ({
        id: lesson.id,
        title: lesson.title,
        videoUrl: lesson.videoUrl,
        durationSeconds: lesson.durationSeconds,
        displayOrder: lesson.displayOrder,
        completed: completedLessonIds.has(lesson.id),
      })),
      quiz,
    };
  }

  /** Upsert — repetir não tem efeito colateral (não move coins, só marca "assistido"), por
   * isso não exige Idempotency-Key ao contrário dos endpoints que creditam. */
  async completeLesson(userId: string, organizationId: string, courseId: string, lessonId: string): Promise<{ completed: true }> {
    const { membershipId } = await this.walletsService.resolveWalletId(userId, organizationId);

    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId, courseId, course: { status: 'PUBLISHED' } },
    });
    if (!lesson) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Aula não encontrada.' });
    }

    await this.prisma.lessonCompletion.upsert({
      where: { lessonId_membershipId: { lessonId, membershipId } },
      create: { lessonId, membershipId },
      update: {},
    });

    return { completed: true };
  }

  async getQuiz(userId: string, organizationId: string, courseId: string): Promise<QuizView> {
    await this.walletsService.resolveWalletId(userId, organizationId);

    const quiz = await this.prisma.quiz.findFirst({
      where: { courseId, course: { status: 'PUBLISHED' } },
      include: {
        questions: {
          orderBy: { displayOrder: 'asc' },
          include: { options: { orderBy: { displayOrder: 'asc' }, select: { id: true, text: true, displayOrder: true } } },
        },
      },
    });
    if (!quiz) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Quiz não encontrado.' });
    }

    return {
      questions: quiz.questions.map((q) => ({
        id: q.id,
        prompt: q.prompt,
        displayOrder: q.displayOrder,
        options: q.options,
      })),
    };
  }

  async submitQuiz(
    userId: string,
    organizationId: string,
    courseId: string,
    input: SubmitQuizInput,
    idempotencyKey: string,
  ): Promise<SubmitQuizResult> {
    const { membershipId } = await this.walletsService.resolveWalletId(userId, organizationId);

    const existingAttempt = await this.prisma.quizAttempt.findUnique({ where: { idempotencyKey } });
    if (existingAttempt) {
      return this.buildSubmitResultFromAttempt(existingAttempt.id);
    }

    const quiz = await this.prisma.quiz.findFirst({
      where: { courseId, course: { status: 'PUBLISHED' } },
      include: { questions: { include: { options: true } } },
    });
    if (!quiz) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Quiz não encontrado.' });
    }

    const existingCompletion = await this.prisma.courseCompletion.findUnique({
      where: { courseId_membershipId: { courseId, membershipId } },
    });
    if (existingCompletion) {
      throw new CourseAlreadyCompletedException();
    }

    const lastAttempt = await this.prisma.quizAttempt.findFirst({
      where: { quizId: quiz.id, membershipId },
      orderBy: { createdAt: 'desc' },
    });
    if (lastAttempt && !lastAttempt.passed) {
      const lockedUntil = this.retryAvailableAt(lastAttempt.createdAt);
      if (lockedUntil > new Date()) {
        throw new QuizRetryLockedException(lockedUntil);
      }
    }

    const { scorePercent, passed } = this.grade(quiz.questions, input.answers);

    const attempt = await this.prisma.quizAttempt.create({
      data: {
        quizId: quiz.id,
        membershipId,
        scorePercent,
        passed,
        answers: input.answers,
        idempotencyKey,
      },
    });

    if (!passed) {
      return {
        scorePercent,
        passed: false,
        retryAvailableAt: this.retryAvailableAt(attempt.createdAt).toISOString(),
        courseCompletion: null,
      };
    }

    const completion = await this.createCompletionOrFindExisting(courseId, membershipId, organizationId, attempt.id);
    const credited = await this.courseCreditService.tryCredit(completion.id);

    return {
      scorePercent,
      passed: true,
      retryAvailableAt: null,
      courseCompletion: { creditStatus: credited ? 'CREDITED' : 'PENDING', coinsAwarded: COURSE_COMPLETION_REWARD_COINS },
    };
  }

  private grade(
    questions: { id: string; options: { id: string; isCorrect: boolean }[] }[],
    answers: SubmitQuizInput['answers'],
  ): { scorePercent: number; passed: boolean } {
    const selectedByQuestion = new Map(answers.map((a) => [a.questionId, a.selectedOptionId]));

    let correctCount = 0;
    for (const question of questions) {
      const correctOption = question.options.find((o) => o.isCorrect);
      if (correctOption && selectedByQuestion.get(question.id) === correctOption.id) {
        correctCount += 1;
      }
    }

    const totalQuestions = questions.length;
    // floor, não round — nunca deixa um placar abaixo de 80% de verdade arredondar pra cima e
    // passar por engano (ver plano da feature).
    const scorePercent = totalQuestions > 0 ? Math.floor((correctCount * 100) / totalQuestions) : 0;

    return { scorePercent, passed: scorePercent >= PASSING_SCORE_PERCENT };
  }

  private retryAvailableAt(attemptCreatedAt: Date): Date {
    return new Date(attemptCreatedAt.getTime() + RETRY_LOCKOUT_DAYS * 24 * 60 * 60 * 1000);
  }

  /** Corrida: duas submissões concorrentes aprovadas pro mesmo (course, membership) — só uma
   * cria a CourseCompletion, a outra esbarra no unique constraint e busca a que já existe em
   * vez de propagar o erro (a pessoa passou de qualquer jeito, não é um caso de erro). */
  private async createCompletionOrFindExisting(
    courseId: string,
    membershipId: string,
    organizationId: string,
    quizAttemptId: string,
  ) {
    try {
      return await this.prisma.courseCompletion.create({
        data: { courseId, membershipId, organizationId, quizAttemptId },
      });
    } catch (error) {
      if (this.isUniqueViolationOn(error, 'courseId')) {
        return this.prisma.courseCompletion.findUniqueOrThrow({
          where: { courseId_membershipId: { courseId, membershipId } },
        });
      }
      throw error;
    }
  }

  /** Replay de Idempotency-Key: reconstrói a mesma resposta que a submissão original devolveu,
   * sem regravar nem recorrigir nada. */
  private async buildSubmitResultFromAttempt(quizAttemptId: string): Promise<SubmitQuizResult> {
    const attempt = await this.prisma.quizAttempt.findUniqueOrThrow({ where: { id: quizAttemptId } });

    if (!attempt.passed) {
      return {
        scorePercent: attempt.scorePercent,
        passed: false,
        retryAvailableAt: this.retryAvailableAt(attempt.createdAt).toISOString(),
        courseCompletion: null,
      };
    }

    const completion = await this.prisma.courseCompletion.findUnique({ where: { quizAttemptId } });

    return {
      scorePercent: attempt.scorePercent,
      passed: true,
      retryAvailableAt: null,
      courseCompletion: completion
        ? { creditStatus: completion.creditStatus, coinsAwarded: COURSE_COMPLETION_REWARD_COINS }
        : null,
    };
  }

  private async resolveQuizState(membershipId: string, courseId: string, quizId: string): Promise<QuizStateView> {
    const completion = await this.prisma.courseCompletion.findUnique({
      where: { courseId_membershipId: { courseId, membershipId } },
      include: { quizAttempt: true },
    });
    if (completion) {
      return {
        state: 'APPROVED',
        lockedUntil: null,
        approvedAt: completion.createdAt.toISOString(),
        scorePercent: completion.quizAttempt.scorePercent,
      };
    }

    const lastAttempt = await this.prisma.quizAttempt.findFirst({
      where: { quizId, membershipId },
      orderBy: { createdAt: 'desc' },
    });

    if (lastAttempt && !lastAttempt.passed) {
      const lockedUntil = this.retryAvailableAt(lastAttempt.createdAt);
      if (lockedUntil > new Date()) {
        return { state: 'LOCKED', lockedUntil: lockedUntil.toISOString(), approvedAt: null, scorePercent: null };
      }
    }

    return { state: 'AVAILABLE', lockedUntil: null, approvedAt: null, scorePercent: null };
  }

  private isUniqueViolationOn(error: unknown, field: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== UNIQUE_CONSTRAINT_ERROR_CODE) {
      return false;
    }
    const target = error.meta?.target;
    return Array.isArray(target) && target.includes(field);
  }
}
