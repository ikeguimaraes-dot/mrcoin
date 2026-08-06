import { UnauthorizedException } from '@nestjs/common';

export class InvalidPartnerRefreshTokenException extends UnauthorizedException {
  constructor() {
    super({ code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token inválido, expirado ou revogado.' });
  }
}
