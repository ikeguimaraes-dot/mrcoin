import { Injectable } from '@nestjs/common';
import * as QRCode from 'qrcode';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptMfaSecret, encryptMfaSecret } from '../../common/crypto/mfa-crypto.util';
import { buildOtpauthUrl, generateTotpSecret, verifyTotpCode } from './totp.util';
import { InvalidMfaCodeException } from './exceptions/invalid-mfa-code.exception';
import { TOTP_ISSUER } from './auth.constants';

export interface MfaSetupResult {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

/** mfaSecret (coluna já existente em AdminUser) é sempre lido/gravado criptografado. */
@Injectable()
export class MfaService {
  constructor(private readonly prisma: PrismaService) {}

  async setup(adminUserId: string): Promise<MfaSetupResult> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });
    const secret = generateTotpSecret();
    const otpauthUrl = buildOtpauthUrl(secret, admin.email, TOTP_ISSUER);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    await this.prisma.adminUser.update({
      where: { id: adminUserId },
      data: { mfaSecret: encryptMfaSecret(secret) },
    });

    return { secret, otpauthUrl, qrCodeDataUrl };
  }

  async enable(adminUserId: string, code: string): Promise<void> {
    await this.assertValidCode(adminUserId, code);
    await this.prisma.adminUser.update({ where: { id: adminUserId }, data: { mfaEnabled: true } });
  }

  async verify(adminUserId: string, code: string): Promise<void> {
    await this.assertValidCode(adminUserId, code);
  }

  private async assertValidCode(adminUserId: string, code: string): Promise<void> {
    const admin = await this.prisma.adminUser.findUniqueOrThrow({ where: { id: adminUserId } });

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
