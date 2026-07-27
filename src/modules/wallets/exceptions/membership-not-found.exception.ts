import { NotFoundException } from '@nestjs/common';

export class MembershipNotFoundException extends NotFoundException {
  constructor() {
    super({ code: 'MEMBERSHIP_NOT_FOUND', message: 'Você não é membro desta organização.' });
  }
}
