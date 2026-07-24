import { Global, Module } from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { UserJwtGuard } from './guards/user-jwt.guard';
import { PartnerJwtGuard } from './guards/partner-jwt.guard';
import { RolesGuard } from './guards/roles.guard';
import { TenantGuard } from './guards/tenant.guard';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';

/** Guards reutilizáveis por qualquer módulo — @Global() pra não precisar reimportar. */
@Global()
@Module({
  providers: [
    AdminJwtGuard,
    UserJwtGuard,
    PartnerJwtGuard,
    RolesGuard,
    TenantGuard,
    LoginRateLimitGuard,
  ],
  exports: [AdminJwtGuard, UserJwtGuard, PartnerJwtGuard, RolesGuard, TenantGuard, LoginRateLimitGuard],
})
export class CommonModule {}
