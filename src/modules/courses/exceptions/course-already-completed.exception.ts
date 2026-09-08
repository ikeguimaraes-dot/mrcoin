import { ConflictException } from '@nestjs/common';

export class CourseAlreadyCompletedException extends ConflictException {
  constructor() {
    super({ code: 'COURSE_ALREADY_COMPLETED', message: 'Este curso já foi concluído — não é possível refazer o quiz.' });
  }
}
