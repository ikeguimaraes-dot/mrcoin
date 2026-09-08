import { HttpException, HttpStatus } from '@nestjs/common';

export class QuizRetryLockedException extends HttpException {
  constructor(retryAvailableAt: Date) {
    super(
      {
        code: 'QUIZ_RETRY_LOCKED',
        message: 'Você reprovou recentemente — só pode tentar de novo depois do prazo de espera.',
        details: { retryAvailableAt: retryAvailableAt.toISOString() },
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
