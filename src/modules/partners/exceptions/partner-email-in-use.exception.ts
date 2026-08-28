import { ConflictException } from '@nestjs/common';

export class PartnerEmailAlreadyInUseException extends ConflictException {
  constructor() {
    super({ code: 'PARTNER_EMAIL_IN_USE', message: 'Já existe um parceiro com este e-mail de contato.' });
  }
}
