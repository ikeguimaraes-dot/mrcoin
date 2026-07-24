import { ForbiddenException } from '@nestjs/common';

export class CannotModifyHigherRankException extends ForbiddenException {
  constructor() {
    super({
      code: 'CANNOT_MODIFY_HIGHER_RANK',
      message: 'Você não pode modificar um admin de papel igual ou superior ao seu.',
    });
  }
}
