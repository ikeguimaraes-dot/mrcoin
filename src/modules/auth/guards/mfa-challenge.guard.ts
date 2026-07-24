import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { extractBearerToken } from '../../../common/guards/bearer-token.util';
import { MfaChallengeJwtPayload } from '../../../common/guards/jwt-payload.types';

const INVALID_TOKEN_RESPONSE = { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' };

/** Só aceita mfaChallengeToken (type: 'mfa_challenge') — usado por POST /auth/mfa/verify. */
@Injectable()
export class MfaChallengeGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    let payload: MfaChallengeJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<MfaChallengeJwtPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    if (payload.type !== 'mfa_challenge') {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    request.mfaChallengeAdminId = payload.sub;
    return true;
  }
}
