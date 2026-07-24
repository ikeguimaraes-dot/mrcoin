import { applyDecorators, UseGuards } from '@nestjs/common';
import { AdminRole } from '@prisma/client';
import { AdminJwtGuard } from '../guards/admin-jwt.guard';
import { TenantGuard } from '../guards/tenant.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from './roles.decorator';

/**
 * Bundle de @UseGuards(AdminJwtGuard, TenantGuard, RolesGuard) + @Roles(...) numa linha
 * só — evita erro de ordenação dos guards (TenantGuard/RolesGuard dependem do
 * request.admin que só o AdminJwtGuard, rodando primeiro, injeta).
 */
export function AdminAuth(...roles: AdminRole[]) {
  return applyDecorators(UseGuards(AdminJwtGuard, TenantGuard, RolesGuard), Roles(...roles));
}
