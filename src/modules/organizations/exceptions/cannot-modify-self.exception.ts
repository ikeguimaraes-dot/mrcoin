import { ForbiddenException } from '@nestjs/common';

export class CannotModifySelfException extends ForbiddenException {
  constructor() {
    super({ code: 'CANNOT_MODIFY_SELF', message: 'Você não pode executar esta ação sobre a própria conta.' });
  }
}
