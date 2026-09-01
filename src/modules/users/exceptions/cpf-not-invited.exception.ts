import { NotFoundException } from '@nestjs/common';

export class CpfNotInvitedException extends NotFoundException {
  constructor() {
    super({
      code: 'CPF_NOT_INVITED',
      message: 'Seu CPF não foi encontrado. Peça à empresa participante que te convide.',
    });
  }
}
