import { UnauthorizedException } from '@nestjs/common';

export class InvalidMfaCodeException extends UnauthorizedException {
  constructor() {
    super({ code: 'INVALID_MFA_CODE', message: 'Código de autenticação inválido.' });
  }
}
