import { createHash, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { PlatformAdminTokenService } from './platform-admin-token.service';
import { PlatformAdminAuditService } from './platform-admin-audit.service';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: 'platform-test-secret-platform-test-secret-32' });
const auditService = new PlatformAdminAuditService(prisma);
const tokenService = new PlatformAdminTokenService(jwtService, prisma, auditService);

const createdPlatformAdminIds: string[] = [];

async function createPlatformAdminFixture(): Promise<string> {
  const suffix = randomUUID();

  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `Platform Token Test Admin ${suffix}`,
      email: `platform-token-test-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword('whatever-not-used-here'),
    },
  });

  createdPlatformAdminIds.push(platformAdmin.id);
  return platformAdmin.id;
}

afterAll(async () => {
  await prisma.platformAdminRefreshToken.deleteMany({
    where: { platformAdminId: { in: createdPlatformAdminIds } },
  });
  await prisma.platformAdminAuditLog.deleteMany({
    where: { platformAdminId: { in: createdPlatformAdminIds } },
  });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdPlatformAdminIds } } });
  await prisma.$disconnect();
});

describe('PlatformAdminTokenService', () => {
  it('issueTokenPair emite um access token JWT com type=platform_admin e um refresh token novo', async () => {
    const platformAdminId = await createPlatformAdminFixture();
    const pair = await tokenService.issueTokenPair(platformAdminId);

    expect(pair.refreshToken).toEqual(expect.any(String));

    const payload = await jwtService.verifyAsync<{ sub: string; type: string }>(pair.accessToken);
    expect(payload).toMatchObject({ sub: platformAdminId, type: 'platform_admin' });

    const count = await prisma.platformAdminRefreshToken.count({ where: { platformAdminId } });
    expect(count).toBe(1);
  });

  it('rotateRefreshToken emite um novo par e revoga o token antigo (mesma family)', async () => {
    const platformAdminId = await createPlatformAdminFixture();
    const original = await tokenService.issueTokenPair(platformAdminId);

    const rotated = await tokenService.rotateRefreshToken(original.refreshToken);

    expect(rotated.refreshToken).not.toBe(original.refreshToken);

    const originalHash = createHash('sha256').update(original.refreshToken).digest('hex');
    const originalRecord = await prisma.platformAdminRefreshToken.findUniqueOrThrow({
      where: { tokenHash: originalHash },
    });
    const rotatedHash = createHash('sha256').update(rotated.refreshToken).digest('hex');
    const rotatedRecord = await prisma.platformAdminRefreshToken.findUniqueOrThrow({
      where: { tokenHash: rotatedHash },
    });

    expect(originalRecord.revokedAt).not.toBeNull();
    expect(originalRecord.replacedById).toBe(rotatedRecord.id);
    expect(rotatedRecord.family).toBe(originalRecord.family);
  });

  it('reuso de um refresh token já rotacionado derruba a family inteira e grava PlatformAdminAuditLog', async () => {
    const platformAdminId = await createPlatformAdminFixture();
    const original = await tokenService.issueTokenPair(platformAdminId);
    const rotated = await tokenService.rotateRefreshToken(original.refreshToken);

    await expect(tokenService.rotateRefreshToken(original.refreshToken)).rejects.toThrow();
    await expect(tokenService.rotateRefreshToken(rotated.refreshToken)).rejects.toThrow();

    const auditLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'REFRESH_TOKEN_REUSE_DETECTED' },
    });
    expect(auditLog).not.toBeNull();
  });

  it('revokeRefreshToken (logout) impede reuso subsequente', async () => {
    const platformAdminId = await createPlatformAdminFixture();
    const pair = await tokenService.issueTokenPair(platformAdminId);

    await tokenService.revokeRefreshToken(pair.refreshToken);

    await expect(tokenService.rotateRefreshToken(pair.refreshToken)).rejects.toThrow();
  });

  it('concorrência: duas rotações simultâneas do mesmo refresh token — só uma passa', async () => {
    const platformAdminId = await createPlatformAdminFixture();
    const pair = await tokenService.issueTokenPair(platformAdminId);

    const results = await Promise.allSettled([
      tokenService.rotateRefreshToken(pair.refreshToken),
      tokenService.rotateRefreshToken(pair.refreshToken),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
