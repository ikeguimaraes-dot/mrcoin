import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { extractBearerToken } from './bearer-token.util';
import { PartnerJwtPayload } from './jwt-payload.types';

const INVALID_TOKEN_RESPONSE = { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' };

/**
 * Só verifica o JWT e anexa `request.partner` — sem organizationId, porque Partner é
 * platform-wide (compartilhado entre todas as organizações, sem pertencer a nenhuma).
 * Ainda não há endpoint de login que emita esse token — infraestrutura pronta pra quando
 * o módulo partners/ existir.
 */
@Injectable()
export class PartnerJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    let payload: PartnerJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<PartnerJwtPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    if (payload.type !== 'partner') {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    request.partner = payload;
    return true;
  }
}
