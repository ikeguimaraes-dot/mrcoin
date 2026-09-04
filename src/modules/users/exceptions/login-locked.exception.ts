import { HttpException, HttpStatus } from '@nestjs/common';

export class LoginLockedException extends HttpException {
  constructor() {
    super(
      {
        code: 'LOGIN_LOCKED',
        message: 'Muitas tentativas de login. Tente novamente em 15 minutos.',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
