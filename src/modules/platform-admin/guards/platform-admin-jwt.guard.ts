import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { extractBearerToken } from '../../../common/guards/bearer-token.util';
import { PlatformAdminJwtPayload } from '../../../common/guards/jwt-payload.types';
import { PLATFORM_JWT_SERVICE } from '../platform-jwt.token';

const INVALID_TOKEN_RESPONSE = { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' };

/**
 * Verifica contra PLATFORM_JWT_SERVICE (secret PLATFORM_ADMIN_JWT_SECRET, dedicado) — não
 * o JwtService global usado por AdminUser/Partner/User. Um token de qualquer outra camada
 * nunca passa aqui: mesmo que a claim `type` fosse forjada, a assinatura não bate contra
 * este secret (e vice-versa — ver actor-jwt-guards cross-rejection tests).
 */
@Injectable()
export class PlatformAdminJwtGuard implements CanActivate {
  constructor(@Inject(PLATFORM_JWT_SERVICE) private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    let payload: PlatformAdminJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<PlatformAdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    if (payload.type !== 'platform_admin') {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    request.platformAdmin = payload;
    return true;
  }
}
