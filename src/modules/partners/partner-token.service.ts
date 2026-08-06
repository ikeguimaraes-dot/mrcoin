import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { InvalidPartnerRefreshTokenException } from './exceptions/invalid-partner-refresh-token.exception';
import { PARTNER_ACCESS_TOKEN_TTL_SECONDS, PARTNER_REFRESH_TOKEN_TTL_DAYS } from './partners.constants';

export interface PartnerTokenPair {
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
 * Emite/rotaciona sessão do parceiro (coins-partner) — access token curto (JWT,
 * JWT_ACCESS_SECRET) + refresh token opaco com rotação por family, mesmo mecanismo do
 * TokenService de admin. Implementação paralela ao UserTokenService pelo mesmo motivo: Partner
 * não tem organizationId nem gera AuditLog. Reuso de refresh token detectado só loga
 * (Logger.warn), sem AuditLog — não existe organização pra escopar esse registro.
 */
@Injectable()
export class PartnerTokenService {
  private readonly logger = new Logger(PartnerTokenService.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  issueAccessToken(partnerId: string): Promise<string> {
    return this.jwtService.signAsync(
      { sub: partnerId, type: 'partner' },
      { expiresIn: PARTNER_ACCESS_TOKEN_TTL_SECONDS },
    );
  }

  async issueTokenPair(partnerId: string, meta: RequestMeta = {}): Promise<PartnerTokenPair> {
    const family = randomBytes(16).toString('hex');
    const [accessToken, { rawToken: refreshToken }] = await Promise.all([
      this.issueAccessToken(partnerId),
      this.createRefreshTokenRecord(partnerId, family, meta),
    ]);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: PARTNER_ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async rotateRefreshToken(rawToken: string, meta: RequestMeta = {}): Promise<PartnerTokenPair> {
    const tokenHash = this.hashToken(rawToken);
    const existing = await this.prisma.partnerRefreshToken.findUnique({ where: { tokenHash } });

    if (!existing) {
      throw new InvalidPartnerRefreshTokenException();
    }

    if (existing.revokedAt) {
      await this.revokeFamily(existing.family);
      this.logger.warn(
        `Reuso de refresh token detectado — family ${existing.family} revogada (partnerId=${existing.partnerId}).`,
      );
      throw new InvalidPartnerRefreshTokenException();
    }

    if (existing.expiresAt < new Date()) {
      throw new InvalidPartnerRefreshTokenException();
    }

    // CAS: só prossegue se FOMOS nós a revogar (perde a corrida se outra rotação
    // concorrente do mesmo token já revogou entre o findUnique e aqui) — mesma técnica do
    // TokenService de admin.
    const revokeResult = await this.prisma.partnerRefreshToken.updateMany({
      where: { id: existing.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    if (revokeResult.count === 0) {
      throw new InvalidPartnerRefreshTokenException();
    }

    const { rawToken: newRawToken, id: newId } = await this.createRefreshTokenRecord(
      existing.partnerId,
      existing.family,
      meta,
    );

    await this.prisma.partnerRefreshToken.update({
      where: { id: existing.id },
      data: { replacedById: newId },
    });

    const accessToken = await this.issueAccessToken(existing.partnerId);

    return {
      accessToken,
      refreshToken: newRawToken,
      tokenType: 'Bearer',
      expiresIn: PARTNER_ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async revokeRefreshToken(rawToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawToken);
    await this.prisma.partnerRefreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async createRefreshTokenRecord(
    partnerId: string,
    family: string,
    meta: RequestMeta,
  ): Promise<{ rawToken: string; id: string }> {
    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + PARTNER_REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    const created = await this.prisma.partnerRefreshToken.create({
      data: { partnerId, tokenHash, family, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    });

    return { rawToken, id: created.id };
  }

  private async revokeFamily(family: string): Promise<void> {
    await this.prisma.partnerRefreshToken.updateMany({
      where: { family, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
