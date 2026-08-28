import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { PLATFORM_JWT_SERVICE } from './platform-jwt.token';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception';
import { PlatformAdminAuditService } from './platform-admin-audit.service';
import { ACCESS_TOKEN_TTL_SECONDS, MFA_CHALLENGE_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from './platform-admin.constants';

export interface PlatformAdminTokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

/**
 * Emite/rotaciona sessão do PlatformAdmin. Access token e mfaChallengeToken são assinados
 * via PLATFORM_JWT_SERVICE (secret dedicado) — nunca o JwtService global usado por
 * AdminUser/Partner/User. Refresh token é opaco (sha256 em repouso), mesma mecânica de
 * TokenService/PartnerTokenService: family agrupa a cadeia de rotação, reuso de um token
 * já revogado derruba a family inteira.
 */
@Injectable()
export class PlatformAdminTokenService {
  constructor(
    @Inject(PLATFORM_JWT_SERVICE) private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  issueAccessToken(platformAdminId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: platformAdminId, type: 'platform_admin' },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
  }

  issueMfaChallengeToken(platformAdminId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: platformAdminId, type: 'platform_mfa_challenge' },
      { expiresIn: MFA_CHALLENGE_TTL_SECONDS },
    );
  }

  async issueTokenPair(platformAdminId: string, meta: RequestMeta = {}): Promise<PlatformAdminTokenPair> {
    const family = randomBytes(16).toString('hex');
    const [accessToken, { rawToken: refreshToken }] = await Promise.all([
      this.issueAccessToken(platformAdminId),
      this.createRefreshTokenRecord(platformAdminId, family, meta),
    ]);

    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async rotateRefreshToken(rawToken: string, meta: RequestMeta = {}): Promise<PlatformAdminTokenPair> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.platformAdminRefreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw new InvalidRefreshTokenException();
    }

    if (existing.revokedAt) {
      await this.revokeFamily(existing.family);
      await this.auditService.record({
        platformAdminId: existing.platformAdminId,
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        payload: { family: existing.family, refreshTokenId: existing.id },
        ip: meta.ip,
      });
      throw new InvalidRefreshTokenException();
    }

    if (existing.expiresAt < new Date()) {
      throw new InvalidRefreshTokenException();
    }

    // CAS: só prossegue se FOMOS nós a revogar (perde a corrida se outra rotação
    // concorrente do mesmo token já revogou entre o findUnique e aqui).
    const revokeResult = await this.prisma.platformAdminRefreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revokeResult.count === 0) {
      throw new InvalidRefreshTokenException();
    }

    const { rawToken: newRawToken, id: newId } = await this.createRefreshTokenRecord(
      existing.platformAdminId,
      existing.family,
      meta,
    );

    await this.prisma.platformAdminRefreshToken.update({
      where: { id: existing.id },
      data: { replacedById: newId },
    });

    const accessToken = await this.issueAccessToken(existing.platformAdminId);

    return { accessToken, refreshToken: newRawToken, tokenType: 'Bearer', expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.platformAdminRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createRefreshTokenRecord(
    platformAdminId: string,
    family: string,
    meta: RequestMeta,
  ): Promise<{ rawToken: string; id: string }> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const created = await this.prisma.platformAdminRefreshToken.create({
      data: { platformAdminId, tokenHash, family, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });

    return { rawToken, id: created.id };
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.prisma.platformAdminRefreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
