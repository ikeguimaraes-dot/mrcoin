import { ConflictException } from '@nestjs/common';

export class OrganizationCnpjInUseException extends ConflictException {
  constructor() {
    super({ code: 'ORGANIZATION_CNPJ_IN_USE', message: 'Já existe uma organização com este CNPJ.' });
  }
}
