import { ConflictException } from '@nestjs/common';

export class MembershipAlreadyExistsException extends ConflictException {
  constructor() {
    super({ code: 'MEMBERSHIP_ALREADY_EXISTS', message: 'Este CPF já é membro desta organização.' });
  }
}
