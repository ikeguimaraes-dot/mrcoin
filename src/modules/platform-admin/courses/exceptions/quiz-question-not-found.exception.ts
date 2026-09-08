import { NotFoundException } from '@nestjs/common';

export class QuizQuestionNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'NOT_FOUND', message: 'Questão não encontrada.' });
  }
}
