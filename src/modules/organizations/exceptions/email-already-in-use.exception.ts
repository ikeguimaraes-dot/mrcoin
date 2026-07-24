import { ConflictException } from '@nestjs/common';

export class EmailAlreadyInUseException extends ConflictException {
  constructor() {
    super({ code: 'EMAIL_ALREADY_IN_USE', message: 'Este e-mail já está em uso.' });
  }
}
