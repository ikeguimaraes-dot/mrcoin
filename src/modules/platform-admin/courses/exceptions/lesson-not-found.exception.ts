import { NotFoundException } from '@nestjs/common';

export class LessonNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'NOT_FOUND', message: 'Aula não encontrada.' });
  }
}
