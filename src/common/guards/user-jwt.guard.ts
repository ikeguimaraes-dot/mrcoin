import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { extractBearerToken } from './bearer-token.util';
import { UserJwtPayload } from './jwt-payload.types';

const INVALID_TOKEN_RESPONSE = { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' };

/**
 * Só verifica o JWT e anexa `request.user` — sem organizationId, porque um User
 * (coins-app) pode ter Membership em várias organizações ao mesmo tempo, então não existe
 * "a" organização dele no token (diferente do AdminJwtGuard). Ainda não há endpoint de
 * login que emita esse token — infraestrutura pronta pra quando o módulo users/ existir.
 */
@Injectable()
export class UserJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    let payload: UserJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<UserJwtPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    if (payload.type !== 'user') {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    request.user = payload;
    return true;
  }
}
