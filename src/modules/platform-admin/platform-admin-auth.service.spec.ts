import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { generate } from 'otplib';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { PlatformAdminTokenService } from './platform-admin-token.service';
import { PlatformAdminMfaService } from './platform-admin-mfa.service';
import { PlatformAdminAuditService } from './platform-admin-audit.service';
import { PlatformAdminAuthService } from './platform-admin-auth.service';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: 'platform-test-secret-platform-test-secret-32' });
const auditService = new PlatformAdminAuditService(prisma);
const tokenService = new PlatformAdminTokenService(jwtService, prisma, auditService);
const mfaService = new PlatformAdminMfaService(prisma);
const authService = new PlatformAdminAuthService(prisma, tokenService, mfaService, auditService);

const createdPlatformAdminIds: string[] = [];

const FIXTURE_PASSWORD = 'Test@Password123';

async function createPlatformAdminFixture(): Promise<{ platformAdminId: string; email: string; password: string }> {
  const suffix = randomUUID();

  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `Platform Auth Test Admin ${suffix}`,
      email: `platform-auth-test-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });

  createdPlatformAdminIds.push(platformAdmin.id);

  return { platformAdminId: platformAdmin.id, email: platformAdmin.email, password: FIXTURE_PASSWORD };
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

describe('PlatformAdminAuthService', () => {
  it('login com senha errada lança InvalidCredentialsException e grava PlatformAdminAuditLog LOGIN_FAILED', async () => {
    const { platformAdminId, email } = await createPlatformAdminFixture();

    await expect(authService.login(email, 'senha-errada')).rejects.toBeInstanceOf(InvalidCredentialsException);

    const auditLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'LOGIN_FAILED' },
    });
    expect(auditLog).not.toBeNull();
  });

  it('login com e-mail inexistente lança InvalidCredentialsException e grava audit sem platformAdminId', async () => {
    const unknownEmail = `nao-existe-${randomUUID()}@test.coins-api.dev`;
    await expect(authService.login(unknownEmail, 'qualquer-senha')).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );

    const auditLog = await prisma.platformAdminAuditLog.findFirst({
      where: { action: 'LOGIN_FAILED', platformAdminId: null },
      orderBy: { createdAt: 'desc' },
    });
    expect(auditLog).not.toBeNull();
    expect((auditLog?.payload as { email?: string } | null)?.email).toBe(unknownEmail);
  });

  it('login de um PlatformAdmin sem MFA configurado sempre recebe MFA_SETUP_REQUIRED — nunca tokens diretos', async () => {
    const { email, password } = await createPlatformAdminFixture();
    const result = await authService.login(email, password);

    expect(result.status).toBe('MFA_SETUP_REQUIRED');
    expect(result.mfaChallengeToken).toEqual(expect.any(String));
  });

  it('completeMfaSetup ativa mfaEnabled, grava MFA_ENABLED e emite tokens', async () => {
    const { platformAdminId, email, password } = await createPlatformAdminFixture();
    const loginResult = await authService.login(email, password);

    if (loginResult.status !== 'MFA_SETUP_REQUIRED') {
      throw new Error('esperado MFA_SETUP_REQUIRED');
    }

    const setup = await mfaService.setup(platformAdminId);
    const code = await generate({ secret: setup.secret });

    const tokens = await authService.completeMfaSetup(platformAdminId, code);
    expect(tokens.accessToken).toEqual(expect.any(String));

    const admin = await prisma.platformAdmin.findUniqueOrThrow({ where: { id: platformAdminId } });
    expect(admin.mfaEnabled).toBe(true);

    const auditLog = await prisma.platformAdminAuditLog.findFirst({
      where: { platformAdminId, action: 'MFA_ENABLED' },
    });
    expect(auditLog).not.toBeNull();
  });

  it('PlatformAdmin com mfaEnabled=true recebe MFA_REQUIRED no login; completeMfaLogin emite tokens', async () => {
    const { platformAdminId, email, password } = await createPlatformAdminFixture();
    const setup = await mfaService.setup(platformAdminId);
    await mfaService.enable(platformAdminId, await generate({ secret: setup.secret }));

    const result = await authService.login(email, password);
    expect(result.status).toBe('MFA_REQUIRED');

    const code = await generate({ secret: setup.secret });
    const tokens = await authService.completeMfaLogin(platformAdminId, code);
    expect(tokens.accessToken).toEqual(expect.any(String));
  });

  it('PlatformAdmin com status INACTIVE não loga, mesmo com senha correta (sem vazar o motivo)', async () => {
    const { platformAdminId, email, password } = await createPlatformAdminFixture();
    await prisma.platformAdmin.update({ where: { id: platformAdminId }, data: { status: 'INACTIVE' } });

    await expect(authService.login(email, password)).rejects.toBeInstanceOf(InvalidCredentialsException);
  });

  it('logout revoga o refresh token e refresh subsequente falha', async () => {
    const { platformAdminId, email, password } = await createPlatformAdminFixture();
    const setup = await mfaService.setup(platformAdminId);
    await mfaService.enable(platformAdminId, await generate({ secret: setup.secret }));

    const loginResult = await authService.login(email, password);
    if (loginResult.status !== 'MFA_REQUIRED') {
      throw new Error('esperado MFA_REQUIRED');
    }

    const code = await generate({ secret: setup.secret });
    const tokens = await authService.completeMfaLogin(platformAdminId, code);

    await authService.logout(tokens.refreshToken);
    await expect(authService.refresh(tokens.refreshToken)).rejects.toThrow();
  });
});
