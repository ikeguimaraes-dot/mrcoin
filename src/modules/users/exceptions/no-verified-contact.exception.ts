import { ConflictException } from '@nestjs/common';

export class NoVerifiedContactException extends ConflictException {
  constructor() {
    super({
      code: 'NO_VERIFIED_CONTACT',
      message: 'Esta conta ainda não tem um contato verificado — finalize o cadastro pelo link da sua organização.',
    });
  }
}
