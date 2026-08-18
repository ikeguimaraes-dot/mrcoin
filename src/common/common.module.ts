import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.schema';
import { AdminJwtGuard } from './guards/admin-jwt.guard';
import { UserJwtGuard } from './guards/user-jwt.guard';
import { PartnerJwtGuard } from './guards/partner-jwt.guard';
import { RolesGuard } from './guards/roles.guard';
import { TenantGuard } from './guards/tenant.guard';
import { LoginRateLimitGuard } from './guards/login-rate-limit.guard';
import { SignupRateLimitGuard } from './guards/signup-rate-limit.guard';
import { EMAIL_PORT, EmailPort } from './email/email.port';
import { ConsoleEmailAdapter } from './email/console-email.adapter';
import { ResendEmailAdapter } from './email/resend-email.adapter';
import { NOTIFICATION_PORT } from './notifications/notification.port';
import { ConsoleNotificationAdapter } from './notifications/console-notification.adapter';
import { STORAGE_PORT } from './storage/storage.port';
import { LocalDiskStorageAdapter } from './storage/local-disk-storage.adapter';

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
    {
      provide: EMAIL_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): EmailPort =>
        config.get('NODE_ENV', { infer: true }) === 'production'
          ? new ResendEmailAdapter(
              config.get('RESEND_API_KEY', { infer: true }),
              config.get('RESEND_FROM_EMAIL', { infer: true }),
            )
          : new ConsoleEmailAdapter(),
    },
    { provide: NOTIFICATION_PORT, useClass: ConsoleNotificationAdapter },
    { provide: STORAGE_PORT, useClass: LocalDiskStorageAdapter },
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
    STORAGE_PORT,
  ],
})
export class CommonModule {}
