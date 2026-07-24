import { ForbiddenException } from '@nestjs/common';

export class CannotAssignHigherRoleException extends ForbiddenException {
  constructor() {
    super({
      code: 'CANNOT_ASSIGN_HIGHER_ROLE',
      message: 'Você não pode atribuir um papel superior ao seu próprio.',
    });
  }
}
