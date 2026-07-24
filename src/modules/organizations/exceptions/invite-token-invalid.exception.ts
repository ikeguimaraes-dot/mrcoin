import { NotFoundException } from '@nestjs/common';

export class InviteTokenInvalidException extends NotFoundException {
  constructor() {
    super({ code: 'INVITE_TOKEN_INVALID', message: 'Convite não encontrado ou inválido.' });
  }
}
