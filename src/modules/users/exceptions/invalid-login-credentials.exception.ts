import { UnauthorizedException } from '@nestjs/common';

export class InvalidLoginCredentialsException extends UnauthorizedException {
  constructor() {
    super({ code: 'INVALID_CREDENTIALS', message: 'CPF ou senha inválidos.' });
  }
}
