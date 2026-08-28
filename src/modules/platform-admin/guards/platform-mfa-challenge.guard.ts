import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { extractBearerToken } from '../../../common/guards/bearer-token.util';
import { PlatformMfaChallengeJwtPayload } from '../../../common/guards/jwt-payload.types';
import { PLATFORM_JWT_SERVICE } from '../platform-jwt.token';

const INVALID_TOKEN_RESPONSE = { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' };

/** Só aceita mfaChallengeToken de plataforma (type: 'platform_mfa_challenge') — usado por POST /platform/auth/mfa/verify. */
@Injectable()
export class PlatformMfaChallengeGuard implements CanActivate {
  constructor(@Inject(PLATFORM_JWT_SERVICE) private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    let payload: PlatformMfaChallengeJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<PlatformMfaChallengeJwtPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    if (payload.type !== 'platform_mfa_challenge') {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    request.platformMfaChallengeId = payload.sub;
    return true;
  }
}
