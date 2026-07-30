import { Global, Module } from '@nestjs/common';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { UserJwtGuard } from './guards/user-jwt.guard';
import { PartnerJwtGuard } from './guards/partner-jwt.guard';
import { RolesGuard } from './guards/roles.guard';
import { TenantGuard } from './guards/tenant.guard';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';
import { SignupRateLimitGuard } from './guards/signup-rate-limit.guard';
import { EMAIL_PORT } from './email/email.port';
import { ConsoleEmailAdapter } from './email/console-email.adapter';
import { NOTIFICATION_PORT } from './notifications/notification.port';
import { ConsoleNotificationAdapter } from './notifications/console-notification.adapter';

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
    SignupRateLimitGuard,
    { provide: EMAIL_PORT, useClass: ConsoleEmailAdapter },
    { provide: NOTIFICATION_PORT, useClass: ConsoleNotificationAdapter },
  ],
  exports: [
    AdminJwtGuard,
    UserJwtGuard,
    PartnerJwtGuard,
    RolesGuard,
    TenantGuard,
    LoginRateLimitGuard,
    SignupRateLimitGuard,
    EMAIL_PORT,
    NOTIFICATION_PORT,
  ],
})
export class CommonModule {}
