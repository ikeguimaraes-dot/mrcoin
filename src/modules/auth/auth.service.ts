import { Injectable, Logger } from '@nestjs/common';
import { AdminUser } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { verifyPassword } from './password.util';
import { RequestMeta, TokenPair, TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';

export type LoginResult =
  | { status: 'MFA_REQUIRED'; mfaChallengeToken: string }
  | { status: 'MFA_SETUP_REQUIRED'; mfaChallengeToken: string }
  | ({ status: 'OK' } & TokenPair);

const MFA_MANDATORY_ROLES = ['OWNER', 'MANAGER'];

/** Orquestra login/refresh/logout — regra de negócio pura, delega tokens ao TokenService. */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    private readonly mfaService: MfaService,
  ) {}

  async login(email: string, password: string, meta: RequestMeta = {}): Promise<LoginResult> {
    const admin = await this.prisma.adminUser.findUnique({ where: { email: email.toLowerCase() } });

    if (!admin) {
      this.logger.warn(`Tentativa de login com e-mail desconhecido: ${email}`);
      throw new InvalidCredentialsException();
    }

    const passwordValid = await verifyPassword(admin.passwordHash, password);

    if (!passwordValid) {
      await this.prisma.auditLog.create({
        data: {
          organizationId: admin.organizationId,
          actorAdminUserId: admin.id,
          action: 'LOGIN_FAILED',
          payload: { reason: 'INVALID_PASSWORD' },
          ip: meta.ip ?? 'unknown',
        },
      });
      throw new InvalidCredentialsException();
    }

    if (admin.mfaEnabled) {
      return {
        status: 'MFA_REQUIRED',
        mfaChallengeToken: await this.tokenService.issueMfaChallengeToken(admin.id),
      };
    }

    if (MFA_MANDATORY_ROLES.includes(admin.role)) {
      return {
        status: 'MFA_SETUP_REQUIRED',
        mfaChallengeToken: await this.tokenService.issueMfaChallengeToken(admin.id),
      };
    }

    await this.recordLoginSuccess(admin, meta.ip);
    const tokens = await this.tokenService.issueTokenPair(admin, meta);
    return { status: 'OK', ...tokens };
  }

  async completeMfaLogin(adminUserId: string, code: string, meta: RequestMeta = {}): Promise<TokenPair> {
    await this.mfaService.verify(adminUserId, code);
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    await this.recordLoginSuccess(admin, meta.ip);
    return this.tokenService.issueTokenPair(admin, meta);
  }

  async completeMfaSetup(adminUserId: string, code: string, meta: RequestMeta = {}): Promise<TokenPair> {
    await this.mfaService.enable(adminUserId, code);
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    await this.recordLoginSuccess(admin, meta.ip);
    return this.tokenService.issueTokenPair(admin, meta);
  }

  refresh(refreshToken: string, meta: RequestMeta = {}): Promise<TokenPair> {
    return this.tokenService.rotateRefreshToken(refreshToken, meta);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokenService.revokeRefreshToken(refreshToken);
  }

  private async recordLoginSuccess(admin: AdminUser, ip?: string): Promise<void> {
    await Promise.all([
      this.prisma.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          organizationId: admin.organizationId,
          actorAdminUserId: admin.id,
          action: 'LOGIN_SUCCESS',
          payload: {},
          ip: ip ?? 'unknown',
        },
      }),
    ]);
  }
}
