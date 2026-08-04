import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { InvalidRefreshTokenException } from './exceptions/invalid-refresh-token.exception';
import { USER_ACCESS_TOKEN_TTL_DAYS, USER_REFRESH_TOKEN_TTL_DAYS } from './users.constants';

export interface UserTokenPair {
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
 * Emite/rotaciona sessão do usuário final (coins-app) — mesmo mecanismo do TokenService de
 * admin (rotação por family, hash sha256 em repouso, detecção de reuso revogando a family
 * inteira, CAS via updateMany guardado por revokedAt: null), implementação paralela porque o
 * TokenService do admin lê admin.organizationId/role e grava AuditLog — conceitos
 * organization-scoped que um User não tem. Reuso detectado aqui só loga (Logger.warn), sem
 * AuditLog: não existe organização pra escopar esse registro.
 */
@Injectable()
export class UserTokenService {
  private readonly logger = new Logger(UserTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  issueAccessToken(userId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: userId, type: 'user' },
      { expiresIn: USER_ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 },
    );
  }

  async issueTokenPair(userId: string, meta: RequestMeta = {}): Promise<UserTokenPair> {
    const family = randomBytes(16).toString('hex');
    const [accessToken, { rawToken: refreshToken }] = await Promise.all([
      this.issueAccessToken(userId),
      this.createRefreshTokenRecord(userId, family, meta),
    ]);

    return { accessToken, refreshToken, tokenType: 'Bearer', expiresIn: USER_ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60 };
  }

  async rotateRefreshToken(rawToken: string, meta: RequestMeta = {}): Promise<UserTokenPair> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.userRefreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw new InvalidRefreshTokenException();
    }

    if (existing.revokedAt) {
      await this.revokeFamily(existing.family);
      this.logger.warn(`Reuso de refresh token detectado — family ${existing.family} revogada (userId=${existing.userId}).`);
      throw new InvalidRefreshTokenException();
    }

    if (existing.expiresAt < new Date()) {
      throw new InvalidRefreshTokenException();
    }

    // CAS: só prossegue se FOMOS nós a revogar (perde a corrida se outra rotação
    // concorrente do mesmo token já revogou entre o findUnique e aqui) — mesma técnica do
    // TokenService de admin.
    const revokeResult = await this.prisma.userRefreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revokeResult.count === 0) {
      throw new InvalidRefreshTokenException();
    }

    const { rawToken: newRawToken, id: newId } = await this.createRefreshTokenRecord(existing.userId, existing.family, meta);

    await this.prisma.userRefreshToken.update({
      where: { id: existing.id },
      data: { replacedById: newId },
    });

    const accessToken = await this.issueAccessToken(existing.userId);

    return {
      accessToken,
      refreshToken: newRawToken,
      tokenType: 'Bearer',
      expiresIn: USER_ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60,
    };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.userRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createRefreshTokenRecord(
    userId: string,
    family: string,
    meta: RequestMeta,
  ): Promise<{ rawToken: string; id: string }> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + USER_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const created = await this.prisma.userRefreshToken.create({
      data: { userId, tokenHash, family, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });

    return { rawToken, id: created.id };
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.prisma.userRefreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
