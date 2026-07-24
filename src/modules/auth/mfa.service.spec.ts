import { randomUUID } from 'node:crypto';
import { generate } from 'otplib';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from './password.util';
import { MfaService } from './mfa.service';
import { InvalidMfaCodeException } from './exceptions/invalid-mfa-code.exception';

const prisma = new PrismaService();
const mfaService = new MfaService(prisma);

const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];

async function createAdminFixture(): Promise<string> {
  const suffix = randomUUID();

  const organization = await prisma.organization.create({
    data: { name: `MFA Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `MFA Test Admin ${suffix}`,
      email: `mfa-test-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword('whatever-not-used-here'),
      role: 'OPERATOR',
    },
  });

  createdOrgIds.push(organization.id);
  createdAdminIds.push(admin.id);
  return admin.id;
}

function anyCodeOtherThan(code: string): string {
  return code === '000000' ? '111111' : '000000';
}

afterAll(async () => {
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('MfaService', () => {
  it('setup gera um secret e grava mfaSecret criptografado (nunca em claro) no banco', async () => {
    const adminId = await createAdminFixture();
    const result = await mfaService.setup(adminId);

    expect(result.secret).toEqual(expect.any(String));
    expect(result.otpauthUrl).toContain('otpauth://');
    expect(result.qrCodeDataUrl).toContain('data:image/png;base64,');

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    expect(admin.mfaSecret).not.toBeNull();
    expect(admin.mfaSecret).not.toBe(result.secret);
    expect(admin.mfaEnabled).toBe(false);
  });

  it('enable com código correto ativa mfaEnabled; código errado é rejeitado', async () => {
    const adminId = await createAdminFixture();
    const setup = await mfaService.setup(adminId);
    const validCode = await generate({ secret: setup.secret });
    const wrongCode = anyCodeOtherThan(validCode);

    await expect(mfaService.enable(adminId, wrongCode)).rejects.toBeInstanceOf(InvalidMfaCodeException);

    let admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    expect(admin.mfaEnabled).toBe(false);

    await mfaService.enable(adminId, validCode);

    admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    expect(admin.mfaEnabled).toBe(true);
  });

  it('verify aceita código válido e rejeita código inválido sem alterar mfaEnabled', async () => {
    const adminId = await createAdminFixture();
    const setup = await mfaService.setup(adminId);
    const validCode = await generate({ secret: setup.secret });
    await mfaService.enable(adminId, validCode);

    const secondValidCode = await generate({ secret: setup.secret });
    await expect(mfaService.verify(adminId, secondValidCode)).resolves.toBeUndefined();

    const wrongCode = anyCodeOtherThan(secondValidCode);
    await expect(mfaService.verify(adminId, wrongCode)).rejects.toBeInstanceOf(InvalidMfaCodeException);
  });

  it('verify sem mfaSecret configurado (setup nunca chamado) rejeita', async () => {
    const adminId = await createAdminFixture();
    await expect(mfaService.verify(adminId, '123456')).rejects.toBeInstanceOf(InvalidMfaCodeException);
  });
});
