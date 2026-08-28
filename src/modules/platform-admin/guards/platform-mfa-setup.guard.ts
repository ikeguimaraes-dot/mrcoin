import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { extractBearerToken } from '../../../common/guards/bearer-token.util';
import { PlatformAdminJwtPayload, PlatformMfaChallengeJwtPayload } from '../../../common/guards/jwt-payload.types';
import { PLATFORM_JWT_SERVICE } from '../platform-jwt.token';

const INVALID_TOKEN_RESPONSE = { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' };

/**
 * Aceita token de sessão de plataforma completa OU mfaChallengeToken de plataforma —
 * setup/enable de MFA podem ser chamados tanto no fluxo obrigatório (challenge, sempre no
 * primeiro login) quanto voluntariamente por um PlatformAdmin já com sessão ativa.
 */
@Injectable()
export class PlatformMfaSetupGuard implements CanActivate {
  constructor(@Inject(PLATFORM_JWT_SERVICE) private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    let payload: PlatformAdminJwtPayload | PlatformMfaChallengeJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<PlatformAdminJwtPayload | PlatformMfaChallengeJwtPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    if (payload.type !== 'platform_admin' && payload.type !== 'platform_mfa_challenge') {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    request.platformMfaSetupId = payload.sub;
    return true;
  }
}
