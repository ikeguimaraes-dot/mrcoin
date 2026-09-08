import { UnprocessableEntityException } from '@nestjs/common';

export class QuizLessonsPendingException extends UnprocessableEntityException {
  constructor(pendingLessons: number) {
    super({
      code: 'QUIZ_LESSONS_PENDING',
      message: 'Assista todas as aulas do curso antes de fazer o quiz.',
      details: { pendingLessons },
    });
  }
}
