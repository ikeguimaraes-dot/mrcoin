import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Request } from 'express';

/**
 * Injeta `request.organizationId` a partir do JWT (setado pelo AdminJwtGuard, que roda
 * antes na cadeia) — único lugar do código que decide o escopo de tenant. Services nunca
 * leem organizationId de body/params (regra crítica do CLAUDE.md).
 */
@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const organizationId = request.admin?.organizationId;

    if (!organizationId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    }

    request.organizationId = organizationId;
    return true;
  }
}
