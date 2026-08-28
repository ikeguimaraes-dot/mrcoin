import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptMfaSecret, encryptMfaSecret } from '../../common/crypto/mfa-crypto.util';
import { buildOtpauthUrl, generateTotpSecret, verifyTotpCode } from '../auth/totp.util';
import { InvalidMfaCodeException } from './exceptions/invalid-mfa-code.exception';
import { TOTP_ISSUER } from './platform-admin.constants';

export interface PlatformMfaSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

/** mfaSecret (coluna já existente em PlatformAdmin) é sempre lido/gravado criptografado. */
@Injectable()
export class PlatformAdminMfaService {
  constructor(private readonly prisma: PrismaService) {}

  async setup(platformAdminId: string): Promise<PlatformMfaSetupResult> {
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });
    const secret = generateTotpSecret();
    const otpauthUrl = buildOtpauthUrl(secret, admin.email, TOTP_ISSUER);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    await this.prisma.platformAdmin.update({
      where: { id: platformAdminId },
      data: { mfaSecret: encryptMfaSecret(secret) },
    });

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async enable(platformAdminId: string, code: string): Promise<void> {
    await this.assertValidCode(platformAdminId, code);
    await this.prisma.platformAdmin.update({ where: { id: platformAdminId }, data: { mfaEnabled: true } });
  }

  async verify(platformAdminId: string, code: string): Promise<void> {
    await this.assertValidCode(platformAdminId, code);
  }

  private async assertValidCode(platformAdminId: string, code: string): Promise<void> {
    const admin = await this.prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });

    if (!admin.mfaSecret) {
      throw new InvalidMfaCodeException();
    }

    const secret = decryptMfaSecret(admin.mfaSecret);
    const isValid = await verifyTotpCode(secret, code);

    if (!isValid) {
      throw new InvalidMfaCodeException();
    }
  }
}
