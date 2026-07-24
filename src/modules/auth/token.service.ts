import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception';
import { ACCESS_TOKEN_TTL_SECONDS, MFA_CHALLENGE_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } from './auth.constants';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

interface AdminIdentity {
  id: string;
  organizationId: string;
  role: AdminRole;
}

/**
 * Access token: JWT assinado (JWT_ACCESS_SECRET). Refresh token: string opaca aleatória,
 * armazenada só como hash (sha256) — nunca em claro no banco. `family` agrupa a cadeia de
 * rotação; reuso de um token já revogado derruba a family inteira (regra 2 do CLAUDE.md).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  issueAccessToken(admin: AdminIdentity): Promise<string> {
    return this.jwtService.signAsync(
      { sub: admin.id, organizationId: admin.organizationId, role: admin.role, type: 'admin' },
      { expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
  }

  issueMfaChallengeToken(adminUserId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: adminUserId, type: 'mfa_challenge' },
      { expiresIn: MFA_CHALLENGE_TTL_SECONDS },
    );
  }

  async issueTokenPair(admin: AdminIdentity, meta: RequestMeta = {}): Promise<TokenPair> {
    const family = randomBytes(16).toString('hex');
    const [accessToken, { rawToken: refreshToken }] = await Promise.all([
      this.issueAccessToken(admin),
      this.createRefreshTokenRecord(admin.id, family, meta),
    ]);

    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async rotateRefreshToken(rawToken: string, meta: RequestMeta = {}): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { adminUser: true },
    });

    if (!existing) {
      throw new InvalidRefreshTokenException();
    }

    if (existing.revokedAt) {
      await this.revokeFamily(existing.family);
      await this.prisma.auditLog.create({
        data: {
          organizationId: existing.adminUser.organizationId,
          actorAdminUserId: existing.adminUserId,
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          payload: { family: existing.family, refreshTokenId: existing.id },
          ip: meta.ip ?? 'unknown',
        },
      });
      throw new InvalidRefreshTokenException();
    }

    if (existing.expiresAt < new Date()) {
      throw new InvalidRefreshTokenException();
    }

    // CAS: só prossegue se FOMOS nós a revogar (perde a corrida se outra rotação
    // concorrente do mesmo token já revogou entre o findUnique e aqui).
    const revokeResult = await this.prisma.refreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revokeResult.count === 0) {
      throw new InvalidRefreshTokenException();
    }

    const { rawToken: newRawToken, id: newId } = await this.createRefreshTokenRecord(
      existing.adminUserId,
      existing.family,
      meta,
    );

    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { replacedById: newId },
    });

    const accessToken = await this.issueAccessToken({
      id: existing.adminUser.id,
      organizationId: existing.adminUser.organizationId,
      role: existing.adminUser.role,
    });

    return { accessToken, refreshToken: newRawToken, tokenType: 'Bearer', expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createRefreshTokenRecord(
    adminUserId: string,
    family: string,
    meta: RequestMeta,
  ): Promise<{ rawToken: string; id: string }> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const created = await this.prisma.refreshToken.create({
      data: { adminUserId, tokenHash, family, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });

    return { rawToken, id: created.id };
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
