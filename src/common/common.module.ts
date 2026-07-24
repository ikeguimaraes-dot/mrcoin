import { Global, Module } from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { UserJwtGuard } from './guards/user-jwt.guard';
import { PartnerJwtGuard } from './guards/partner-jwt.guard';
import { RolesGuard } from './guards/roles.guard';
import { TenantGuard } from './guards/tenant.guard';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';
import { EMAIL_PORT } from './email/email.port';
import { ConsoleEmailAdapter } from './email/console-email.adapter';

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
    { provide: EMAIL_PORT, useClass: ConsoleEmailAdapter },
  ],
  exports: [
    AdminJwtGuard,
    UserJwtGuard,
    PartnerJwtGuard,
    RolesGuard,
    TenantGuard,
    LoginRateLimitGuard,
    EMAIL_PORT,
  ],
})
export class CommonModule {}
