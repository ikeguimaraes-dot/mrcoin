import { createHash, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { AdminRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from './password.util';
import { TokenService } from './token.service';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: 'test-secret-test-secret-test-secret-32' });
const tokenService = new TokenService(jwtService, prisma);

const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];

async function createAdminFixture(): Promise<{
  organizationId: string;
  adminId: string;
  role: AdminRole;
}> {
  const suffix = randomUUID();

  const organization = await prisma.organization.create({
    data: { name: `Token Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `Token Test Admin ${suffix}`,
      email: `token-test-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword('whatever-not-used-here'),
      role: 'OPERATOR',
    },
  });

  createdOrgIds.push(organization.id);
  createdAdminIds.push(admin.id);

  return { organizationId: organization.id, adminId: admin.id, role: admin.role };
}

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.auditLog.deleteMany({ where: { actorAdminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('TokenService', () => {
  it('issueTokenPair emite um access token JWT válido e um refresh token novo', async () => {
    const { organizationId, adminId, role } = await createAdminFixture();
    const pair = await tokenService.issueTokenPair({ id: adminId, organizationId, role });

    expect(pair.refreshToken).toEqual(expect.any(String));

    const payload = await jwtService.verifyAsync<{
      sub: string;
      organizationId: string;
      role: AdminRole;
      type: string;
    }>(pair.accessToken);
    expect(payload).toMatchObject({ sub: adminId, organizationId, role, type: 'admin' });

    const count = await prisma.refreshToken.count({ where: { adminUserId: adminId } });
    expect(count).toBe(1);
  });

  it('rotateRefreshToken emite um novo par e revoga o token antigo (mesma family)', async () => {
    const { organizationId, adminId, role } = await createAdminFixture();
    const original = await tokenService.issueTokenPair({ id: adminId, organizationId, role });

    const rotated = await tokenService.rotateRefreshToken(original.refreshToken);

    expect(rotated.refreshToken).not.toBe(original.refreshToken);

    const originalHash = createHash('sha256').update(original.refreshToken).digest('hex');
    const originalRecord = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: originalHash },
    });
    const rotatedHash = createHash('sha256').update(rotated.refreshToken).digest('hex');
    const rotatedRecord = await prisma.refreshToken.findUniqueOrThrow({
      where: { tokenHash: rotatedHash },
    });

    expect(originalRecord.revokedAt).not.toBeNull();
    expect(originalRecord.replacedById).toBe(rotatedRecord.id);
    expect(rotatedRecord.family).toBe(originalRecord.family);
  });

  it('reuso de um refresh token já rotacionado derruba a family inteira e grava AuditLog', async () => {
    const { organizationId, adminId, role } = await createAdminFixture();
    const original = await tokenService.issueTokenPair({ id: adminId, organizationId, role });
    const rotated = await tokenService.rotateRefreshToken(original.refreshToken);

    await expect(tokenService.rotateRefreshToken(original.refreshToken)).rejects.toThrow();
    await expect(tokenService.rotateRefreshToken(rotated.refreshToken)).rejects.toThrow();

    const auditLog = await prisma.auditLog.findFirst({
      where: { actorAdminUserId: adminId, action: 'REFRESH_TOKEN_REUSE_DETECTED' },
    });
    expect(auditLog).not.toBeNull();
  });

  it('revokeRefreshToken (logout) impede reuso subsequente', async () => {
    const { organizationId, adminId, role } = await createAdminFixture();
    const pair = await tokenService.issueTokenPair({ id: adminId, organizationId, role });

    await tokenService.revokeRefreshToken(pair.refreshToken);

    await expect(tokenService.rotateRefreshToken(pair.refreshToken)).rejects.toThrow();
  });

  it('concorrência: duas rotações simultâneas do mesmo refresh token — só uma passa', async () => {
    const { organizationId, adminId, role } = await createAdminFixture();
    const pair = await tokenService.issueTokenPair({ id: adminId, organizationId, role });

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
