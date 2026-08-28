import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PlatformAdminJwtGuard } from './platform-admin-jwt.guard';
import { AdminJwtGuard } from '../../../common/guards/admin-jwt.guard';
import { PartnerJwtGuard } from '../../../common/guards/partner-jwt.guard';
import { UserJwtGuard } from '../../../common/guards/user-jwt.guard';

// Dois secrets DIFERENTES — reproduz o isolamento real de PLATFORM_ADMIN_JWT_SECRET vs
// JWT_ACCESS_SECRET (não são a mesma instância de JwtService em produção).
const platformJwtService = new JwtService({ secret: 'platform-secret-platform-secret-32-chars' });
const sharedJwtService = new JwtService({ secret: 'shared-secret-shared-secret-32-chars-xx' });

interface FakeRequest {
  headers: { authorization?: string };
  admin?: unknown;
  user?: unknown;
  partner?: unknown;
  platformAdmin?: unknown;
}

function buildContext(token?: string): { context: ExecutionContext; request: FakeRequest } {
  const request: FakeRequest = { headers: { authorization: token ? `Bearer ${token}` : undefined } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('PlatformAdminJwtGuard — isolamento total dos outros três tiers', () => {
  it('aceita type=platform_admin assinado com o secret de plataforma e anexa request.platformAdmin', async () => {
    const guard = new PlatformAdminJwtGuard(platformJwtService);
    const token = await platformJwtService.signAsync({ sub: 'platform-admin-1', type: 'platform_admin' });
    const { context, request } = buildContext(token);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.platformAdmin).toMatchObject({ sub: 'platform-admin-1', type: 'platform_admin' });
  });

  it('rejeita token com type diferente de platform_admin (mesmo secret)', async () => {
    const guard = new PlatformAdminJwtGuard(platformJwtService);
    const token = await platformJwtService.signAsync({ sub: 'x', type: 'platform_mfa_challenge' });
    const { context } = buildContext(token);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita um token de AdminUser válido (assinado com o secret compartilhado, type=admin forjado ou não)', async () => {
    const guard = new PlatformAdminJwtGuard(platformJwtService);
    const adminToken = await sharedJwtService.signAsync({
      sub: 'admin-1',
      organizationId: 'org-1',
      role: 'OWNER',
      type: 'admin',
    });
    const { context: adminCtx } = buildContext(adminToken);
    await expect(guard.canActivate(adminCtx)).rejects.toBeInstanceOf(UnauthorizedException);

    // Mesmo se alguém conseguisse forjar a claim `type: platform_admin` num token assinado
    // com o secret errado, a verificação de assinatura já falha antes de olhar pro type.
    const forgedToken = await sharedJwtService.signAsync({ sub: 'admin-1', type: 'platform_admin' });
    const { context: forgedCtx } = buildContext(forgedToken);
    await expect(guard.canActivate(forgedCtx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita um token de Partner válido (secret compartilhado)', async () => {
    const guard = new PlatformAdminJwtGuard(platformJwtService);
    const token = await sharedJwtService.signAsync({ sub: 'partner-1', type: 'partner' });
    const { context } = buildContext(token);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejeita quando não há header Authorization', async () => {
    const guard = new PlatformAdminJwtGuard(platformJwtService);
    const { context } = buildContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('AdminJwtGuard / PartnerJwtGuard / UserJwtGuard rejeitam token de PlatformAdmin', () => {
  it('AdminJwtGuard rejeita um token de PlatformAdmin válido (secret dedicado, não o compartilhado)', async () => {
    const guard = new AdminJwtGuard(sharedJwtService);
    const token = await platformJwtService.signAsync({ sub: 'platform-admin-1', type: 'platform_admin' });
    const { context } = buildContext(token);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('PartnerJwtGuard rejeita um token de PlatformAdmin válido', async () => {
    const guard = new PartnerJwtGuard(sharedJwtService);
    const token = await platformJwtService.signAsync({ sub: 'platform-admin-1', type: 'platform_admin' });
    const { context } = buildContext(token);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('UserJwtGuard rejeita um token de PlatformAdmin válido', async () => {
    const guard = new UserJwtGuard(sharedJwtService);
    const token = await platformJwtService.signAsync({ sub: 'platform-admin-1', type: 'platform_admin' });
    const { context } = buildContext(token);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
