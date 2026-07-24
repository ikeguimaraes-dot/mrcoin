import { UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

const BEARER_PREFIX = 'Bearer ';

/** Extrai o token de `Authorization: Bearer <token>` — lança 401 se ausente/malformado. */
export function extractBearerToken(request: Request): string {
  const header = request.headers.authorization;

  if (!header?.startsWith(BEARER_PREFIX)) {
    throw new UnauthorizedException({
      code: 'UNAUTHORIZED',
      message: 'Token de autenticação ausente.',
    });
  }

  return header.slice(BEARER_PREFIX.length);
}
