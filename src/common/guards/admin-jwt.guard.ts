import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { extractBearerToken } from './bearer-token.util';
import { AdminJwtPayload } from './jwt-payload.types';

const INVALID_TOKEN_RESPONSE = { code: 'UNAUTHORIZED', message: 'Token inválido ou expirado.' };

@Injectable()
export class AdminJwtGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    let payload: AdminJwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<AdminJwtPayload>(token);
    } catch {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    if (payload.type !== 'admin') {
      throw new UnauthorizedException(INVALID_TOKEN_RESPONSE);
    }

    request.admin = payload;
    return true;
  }
}
