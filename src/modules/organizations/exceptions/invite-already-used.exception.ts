import { ConflictException } from '@nestjs/common';

export class InviteAlreadyUsedException extends ConflictException {
  constructor() {
    super({ code: 'INVITE_ALREADY_USED', message: 'Este convite já foi utilizado ou revogado.' });
  }
}
