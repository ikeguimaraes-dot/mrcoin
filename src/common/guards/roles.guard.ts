import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';

const ROLE_RANK: Record<AdminRole, number> = {
  VIEWER: 1,
  OPERATOR: 2,
  MANAGER: 3,
  OWNER: 4,
};

/** Hierárquico: @Roles(MANAGER) também permite OWNER (rank maior sempre passa). */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const callerRole = request.admin?.role;

    if (!callerRole) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    }

    const minimumRequiredRank = Math.min(...requiredRoles.map((role) => ROLE_RANK[role]));

    if (ROLE_RANK[callerRole] < minimumRequiredRank) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Acesso negado.' });
    }

    return true;
  }
}
