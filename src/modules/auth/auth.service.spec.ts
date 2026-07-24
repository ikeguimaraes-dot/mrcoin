import { randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { AdminRole } from '@prisma/client';
import { generate } from 'otplib';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from './password.util';
import { TokenService } from './token.service';
import { MfaService } from './mfa.service';
import { AuthService } from './auth.service';
import { InvalidCredentialsException } from './exceptions/invalid-credentials.exception';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: 'test-secret-test-secret-test-secret-32' });
const tokenService = new TokenService(jwtService, prisma);
const mfaService = new MfaService(prisma);
const authService = new AuthService(prisma, tokenService, mfaService);

const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];

const FIXTURE_PASSWORD = 'Test@Password123';

async function createAdminFixture(
  role: AdminRole,
): Promise<{ adminId: string; organizationId: string; email: string; password: string }> {
  const suffix = randomUUID();

  const organization = await prisma.organization.create({
    data: { name: `Auth Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `Auth Test Admin ${suffix}`,
      email: `auth-test-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role,
    },
  });

  createdOrgIds.push(organization.id);
  createdAdminIds.push(admin.id);

  return {
    adminId: admin.id,
    organizationId: organization.id,
    email: admin.email,
    password: FIXTURE_PASSWORD,
  };
}

afterAll(async () => {
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.auditLog.deleteMany({ where: { actorAdminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('AuthService', () => {
  it('login com senha errada lança InvalidCredentialsException e grava AuditLog LOGIN_FAILED', async () => {
    const { adminId, email } = await createAdminFixture('OPERATOR');

    await expect(authService.login(email, 'senha-errada')).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );

    const auditLog = await prisma.auditLog.findFirst({
      where: { actorAdminUserId: adminId, action: 'LOGIN_FAILED' },
    });
    expect(auditLog).not.toBeNull();
  });

  it('login com e-mail inexistente lança InvalidCredentialsException', async () => {
    const unknownEmail = `nao-existe-${randomUUID()}@test.coins-api.dev`;
    await expect(authService.login(unknownEmail, 'qualquer-senha')).rejects.toBeInstanceOf(
      InvalidCredentialsException,
    );
  });

  it('OPERATOR sem MFA loga direto e recebe tokens (status OK)', async () => {
    const { email, password } = await createAdminFixture('OPERATOR');
    const result = await authService.login(email, password);

    expect(result.status).toBe('OK');
    if (result.status === 'OK') {
      expect(result.accessToken).toEqual(expect.any(String));
      expect(result.refreshToken).toEqual(expect.any(String));
    }
  });

  it('VIEWER sem MFA loga direto (MFA não é obrigatório pra esse cargo)', async () => {
    const { email, password } = await createAdminFixture('VIEWER');
    const result = await authService.login(email, password);
    expect(result.status).toBe('OK');
  });

  it('OWNER sem MFA configurado recebe MFA_SETUP_REQUIRED, nunca tokens diretos', async () => {
    const { email, password } = await createAdminFixture('OWNER');
    const result = await authService.login(email, password);

    expect(result.status).toBe('MFA_SETUP_REQUIRED');
    if (result.status === 'MFA_SETUP_REQUIRED') {
      expect(result.mfaChallengeToken).toEqual(expect.any(String));
    }
  });

  it('MANAGER sem MFA configurado recebe MFA_SETUP_REQUIRED', async () => {
    const { email, password } = await createAdminFixture('MANAGER');
    const result = await authService.login(email, password);
    expect(result.status).toBe('MFA_SETUP_REQUIRED');
  });

  it('completeMfaSetup ativa mfaEnabled e emite tokens (completa o login obrigatório)', async () => {
    const { adminId, email, password } = await createAdminFixture('OWNER');
    const loginResult = await authService.login(email, password);

    if (loginResult.status !== 'MFA_SETUP_REQUIRED') {
      throw new Error('esperado MFA_SETUP_REQUIRED');
    }

    const setup = await mfaService.setup(adminId);
    const code = await generate({ secret: setup.secret });

    const tokens = await authService.completeMfaSetup(adminId, code);
    expect(tokens.accessToken).toEqual(expect.any(String));

    const admin = await prisma.adminUser.findUniqueOrThrow({ where: { id: adminId } });
    expect(admin.mfaEnabled).toBe(true);
  });

  it('admin com mfaEnabled=true recebe MFA_REQUIRED no login; completeMfaLogin emite tokens', async () => {
    const { adminId, email, password } = await createAdminFixture('OPERATOR');
    const setup = await mfaService.setup(adminId);
    await mfaService.enable(adminId, await generate({ secret: setup.secret }));

    const result = await authService.login(email, password);
    expect(result.status).toBe('MFA_REQUIRED');

    if (result.status !== 'MFA_REQUIRED') {
      throw new Error('esperado MFA_REQUIRED');
    }

    const code = await generate({ secret: setup.secret });
    const tokens = await authService.completeMfaLogin(adminId, code);
    expect(tokens.accessToken).toEqual(expect.any(String));
  });

  it('logout revoga o refresh token e refresh subsequente falha', async () => {
    const { email, password } = await createAdminFixture('OPERATOR');
    const result = await authService.login(email, password);

    if (result.status !== 'OK') {
      throw new Error('esperado OK');
    }

    await authService.logout(result.refreshToken);
    await expect(authService.refresh(result.refreshToken)).rejects.toThrow();
  });
});
