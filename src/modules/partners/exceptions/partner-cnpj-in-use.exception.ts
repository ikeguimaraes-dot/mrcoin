import { ConflictException } from '@nestjs/common';

export class PartnerCnpjAlreadyInUseException extends ConflictException {
  constructor() {
    super({ code: 'PARTNER_CNPJ_IN_USE', message: 'Já existe um parceiro com este CNPJ.' });
  }
}
