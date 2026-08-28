import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Env } from '../../config/env.schema';
import { PLATFORM_JWT_SERVICE } from './platform-jwt.token';
import { PlatformAdminAuthController } from './platform-admin-auth.controller';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { PlatformAdminTokenService } from './platform-admin-token.service';
import { PlatformAdminMfaService } from './platform-admin-mfa.service';
import { PlatformAdminAuditService } from './platform-admin-audit.service';
import { PlatformAdminJwtGuard } from './guards/platform-admin-jwt.guard';
import { PlatformMfaChallengeGuard } from './guards/platform-mfa-challenge.guard';
import { PlatformMfaSetupGuard } from './guards/platform-mfa-setup.guard';
import { PlatformAdminLoginRateLimitGuard } from './guards/platform-admin-login-rate-limit.guard';
import { PlatformAdminMfaRateLimitGuard } from './guards/platform-admin-mfa-rate-limit.guard';

/**
 * Deliberadamente NÃO importa o JwtModule global (app.module.ts) — monta sua própria
 * instância de JwtService (PLATFORM_JWT_SERVICE) com PLATFORM_ADMIN_JWT_SECRET, um secret
 * dedicado. Isso é o que garante isolamento real de token entre PlatformAdmin e
 * AdminUser/Partner/User, além da checagem de claim `type` que os outros guards já usam.
 * PlatformAdminJwtGuard não é global (ao contrário de AdminJwtGuard/PartnerJwtGuard em
 * CommonModule) — módulos futuros de CRUD de plataforma importam PlatformAdminModule.
 */
@Module({
  controllers: [PlatformAdminAuthController],
  providers: [
    {
      provide: PLATFORM_JWT_SERVICE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): JwtService =>
        new JwtService({ secret: config.get('PLATFORM_ADMIN_JWT_SECRET', { infer: true }) }),
    },
    PlatformAdminAuthService,
    PlatformAdminTokenService,
    PlatformAdminMfaService,
    PlatformAdminAuditService,
    PlatformAdminJwtGuard,
    PlatformMfaChallengeGuard,
    PlatformMfaSetupGuard,
    PlatformAdminLoginRateLimitGuard,
    PlatformAdminMfaRateLimitGuard,
  ],
  exports: [PLATFORM_JWT_SERVICE, PlatformAdminJwtGuard],
})
export class PlatformAdminModule {}
