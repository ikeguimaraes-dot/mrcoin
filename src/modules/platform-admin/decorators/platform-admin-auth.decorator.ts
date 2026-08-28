import { applyDecorators, UseGuards } from '@nestjs/common';
import { PlatformAdminJwtGuard } from '../guards/platform-admin-jwt.guard';

/**
 * Guarda uma rota atrás do JWT dedicado de PlatformAdmin. Sem TenantGuard/RolesGuard —
 * PlatformAdmin é platform-wide (sem organizationId) e não tem hierarquia de papéis nesta
 * fase. Módulos de CRUD de plataforma (futuro) importam PlatformAdminModule para usar
 * este decorator.
 */
export function PlatformAdminAuth() {
  return applyDecorators(UseGuards(PlatformAdminJwtGuard));
}
