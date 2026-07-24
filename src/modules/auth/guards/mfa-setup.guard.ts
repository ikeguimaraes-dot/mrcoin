import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { extractBearerToken } from '../../../common/guards/bearer-token.util';
import { AdminJwtPayload, MfaChallengeJwtPayload } from '../../../common/guards/jwt-payload.types';

const INVALID_TOKEN_RESPONSE = { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' };

/**
 * Aceita token de sessão admin completa OU mfaChallengeToken — setup/enable de MFA podem
 * ser chamados tanto no fluxo obrigatório (challenge, primeiro login de OWNER/MANAGER)
 * quanto voluntariamente por um admin já com sessão ativa.
 */
@Injectable()
export class MfaSetupGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    let payload: AdminJwtPayload | MfaChallengeJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<AdminJwtPayload | MfaChallengeJwtPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    if (payload.type !== 'admin' && payload.type !== 'mfa_challenge') {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    request.mfaSetupAdminId = payload.sub;
    return true;
  }
}
