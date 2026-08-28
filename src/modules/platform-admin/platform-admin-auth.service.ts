import { Injectable, Logger } from '@nestjs/common';
import { PlatformAdmin } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { verifyPassword } from '../auth/password.util';
import { PlatformAdminTokenPair, RequestMeta, PlatformAdminTokenService } from './platform-admin-token.service';
import { PlatformAdminMfaService } from './platform-admin-mfa.service';
import { PlatformAdminAuditService } from './platform-admin-audit.service';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';

export type LoginResult =
  | { status: 'MFA_REQUIRED'; mfaChallengeToken: string }
  | { status: 'MFA_SETUP_REQUIRED'; mfaChallengeToken: string };

export interface PlatformAdminProfile {
  id: string;
  name: string;
  email: string;
  status: string;
  mfaEnabled: boolean;
  lastLoginAt: Date | null;
}

/**
 * Orquestra login/refresh/logout do PlatformAdmin. MFA é obrigatório sem exceção — login
 * nunca devolve um token pair direto, sempre MFA_REQUIRED (mfaEnabled já true) ou
 * MFA_SETUP_REQUIRED (primeiro login), diferente de AuthService (AdminUser) onde só
 * OWNER/MANAGER são forçados via MFA_MANDATORY_ROLES.
 */
@Injectable()
export class PlatformAdminAuthService {
  private readonly logger = new Logger(PlatformAdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: PlatformAdminTokenService,
    private readonly mfaService: PlatformAdminMfaService,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta = {}): Promise<LoginResult> {
    const admin = await this.prisma.platformAdmin.findUnique({ where: { email: email.toLowerCase() } });

    if (!admin) {
      this.logger.warn(`Tentativa de login com e-mail desconhecido: ${email}`);
      await this.auditService.record({
        platformAdminId: null,
        action: 'LOGIN_FAILED',
        payload: { reason: 'UNKNOWN_EMAIL', email: email.toLowerCase() },
        ip: meta.ip,
      });
      throw new InvalidCredentialsException();
    }

    const passwordValid = await verifyPassword(admin.passwordHash, password);

    if (!passwordValid) {
      await this.auditService.record({
        platformAdminId: admin.id,
        action: 'LOGIN_FAILED',
        payload: { reason: 'INVALID_PASSWORD' },
        ip: meta.ip,
      });
      throw new InvalidCredentialsException();
    }

    if (admin.status !== 'ACTIVE') {
      await this.auditService.record({
        platformAdminId: admin.id,
        action: 'LOGIN_FAILED',
        payload: { reason: 'INACTIVE' },
        ip: meta.ip,
      });
      throw new InvalidCredentialsException();
    }

    const mfaChallengeToken = await this.tokenService.issueMfaChallengeToken(admin.id);
    return { status: admin.mfaEnabled ? 'MFA_REQUIRED' : 'MFA_SETUP_REQUIRED', mfaChallengeToken };
  }

  async completeMfaLogin(
    platformAdminId: string,
    code: string,
    meta: RequestMeta = {},
  ): Promise<PlatformAdminTokenPair> {
    await this.mfaService.verify(platformAdminId, code);
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });
    await this.recordLoginSuccess(admin, meta.ip);
    return this.tokenService.issueTokenPair(admin.id, meta);
  }

  async completeMfaSetup(
    platformAdminId: string,
    code: string,
    meta: RequestMeta = {},
  ): Promise<PlatformAdminTokenPair> {
    await this.mfaService.enable(platformAdminId, code);
    await this.auditService.record({ platformAdminId, action: 'MFA_ENABLED', ip: meta.ip });
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });
    await this.recordLoginSuccess(admin, meta.ip);
    return this.tokenService.issueTokenPair(admin.id, meta);
  }

  refresh(refreshToken: string, meta: RequestMeta = {}): Promise<PlatformAdminTokenPair> {
    return this.tokenService.rotateRefreshToken(refreshToken, meta);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokenService.revokeRefreshToken(refreshToken);
  }

  getProfile(platformAdminId: string): Promise<PlatformAdminProfile> {
    return this.prisma.platformAdmin.findUniqueOrThrow({
      where: { id: platformAdminId },
      select: { id: true, name: true, email: true, status: true, mfaEnabled: true, lastLoginAt: true },
    });
  }

  private async recordLoginSuccess(admin: PlatformAdmin, ip?: string): Promise<void> {
    await Promise.all([
      this.prisma.platformAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }),
      this.auditService.record({ platformAdminId: admin.id, action: 'LOGIN_SUCCESS', ip }),
    ]);
  }
}
