import { NotFoundException } from '@nestjs/common';

export class AccountNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'ACCOUNT_NOT_FOUND',
      message: 'Conta não encontrada. Verifique se você já tem cadastro em alguma organização.',
    });
  }
}
