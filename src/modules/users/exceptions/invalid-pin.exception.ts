import { HttpException, HttpStatus } from '@nestjs/common';

export class InvalidPinException extends HttpException {
  constructor(attemptsRemaining: number) {
    super(
      {
        code: 'INVALID_PIN',
        message: 'PIN incorreto.',
        details: { attemptsRemaining },
      },
      HttpStatus.UNAUTHORIZED,
    );
  }
}
