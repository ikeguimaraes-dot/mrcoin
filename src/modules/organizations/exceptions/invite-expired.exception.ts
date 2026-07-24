import { BadRequestException } from '@nestjs/common';

export class InviteExpiredException extends BadRequestException {
  constructor() {
    super({ code: 'INVITE_EXPIRED', message: 'Este convite expirou.' });
  }
}
