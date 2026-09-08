import { UnprocessableEntityException } from '@nestjs/common';

type MissingPublishRequirement = 'lessons' | 'quizQuestions';

export class CourseNotPublishableException extends UnprocessableEntityException {
  constructor(missing: MissingPublishRequirement[]) {
    super({
      code: 'COURSE_NOT_PUBLISHABLE',
      message: 'Curso precisa de pelo menos uma aula e um quiz com pelo menos uma questão pra ser publicado.',
      details: { missing },
    });
  }
}
