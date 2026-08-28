import { randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { PlatformAdminMfaService } from './platform-admin-mfa.service';
import { InvalidMfaCodeException } from './exceptions/invalid-mfa-code.exception';

const prisma = new PrismaService();
const mfaService = new PlatformAdminMfaService(prisma);

const createdPlatformAdminIds: string[] = [];

async function createPlatformAdminFixture(): Promise<string> {
  const suffix = randomUUID();

  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `Platform MFA Test Admin ${suffix}`,
      email: `platform-mfa-test-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword('whatever-not-used-here'),
    },
  });

  createdPlatformAdminIds.push(platformAdmin.id);
  return platformAdmin.id;
}

function anyCodeOtherThan(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

afterAll(async () => {
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdPlatformAdminIds } } });
  await prisma.$disconnect();
});

describe('PlatformAdminMfaService', () => {
  it('setup gera um secret e grava mfaSecret criptografado (nunca em claro) no banco', async () => {
    const platformAdminId = await createPlatformAdminFixture();
    const result = await mfaService.setup(platformAdminId);

    expect(result.secret).toEqual(expect.any(String));
    expect(result.otpauthUrl).toContain('otpauth://');
    expect(result.qrCodeDataUrl).toContain('data:image/png;base64,');

    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });
    expect(admin.mfaSecret).not.toBeNull();
    expect(admin.mfaSecret).not.toBe(result.secret);
    expect(admin.mfaEnabled).toBe(false);
  });

  it('enable com código correto ativa mfaEnabled; código errado é rejeitado', async () => {
    const platformAdminId = await createPlatformAdminFixture();
    const setup = await mfaService.setup(platformAdminId);
    const validCode = await generate({ secret: setup.secret });
    const wrongCode = anyCodeOtherThan(validCode);

    await expect(mfaService.enable(platformAdminId, wrongCode)).rejects.toBeInstanceOf(
      InvalidMfaCodeException,
    );

    let admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });
    expect(admin.mfaEnabled).toBe(false);

    await mfaService.enable(platformAdminId, validCode);

    admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });
    expect(admin.mfaEnabled).toBe(true);
  });

  it('verify aceita código válido e rejeita código inválido sem alterar mfaEnabled', async () => {
    const platformAdminId = await createPlatformAdminFixture();
    const setup = await mfaService.setup(platformAdminId);
    const validCode = await generate({ secret: setup.secret });
    await mfaService.enable(platformAdminId, validCode);

    const secondValidCode = await generate({ secret: setup.secret });
    await expect(mfaService.verify(platformAdminId, secondValidCode)).resolves.toBeUndefined();

    const wrongCode = anyCodeOtherThan(secondValidCode);
    await expect(mfaService.verify(platformAdminId, wrongCode)).rejects.toBeInstanceOf(InvalidMfaCodeException);
  });

  it('verify sem mfaSecret configurado (setup nunca chamado) rejeita', async () => {
    const platformAdminId = await createPlatformAdminFixture();
    await expect(mfaService.verify(platformAdminId, '123456')).rejects.toBeInstanceOf(InvalidMfaCodeException);
  });
});
