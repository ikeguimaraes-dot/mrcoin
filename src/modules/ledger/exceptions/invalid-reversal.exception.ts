import { BadRequestException } from '@nestjs/common';

export class InvalidReversalException extends BadRequestException {
  constructor(entryId: string) {
    super({
      code: 'INVALID_REVERSAL',
      message: 'Não é permitido reverter um entry do tipo REVERSAL.',
      details: { entryId },
    });
  }
}
