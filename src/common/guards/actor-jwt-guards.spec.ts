import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AdminJwtGuard } from './admin-jwt.guard';
import { UserJwtGuard } from './user-jwt.guard';
import { PartnerJwtGuard } from './partner-jwt.guard';

const jwtService = new JwtService({ secret: 'test-secret-test-secret-test-secret-32' });

interface FakeRequest {
  headers: { authorization?: string };
  admin?: unknown;
  user?: unknown;
  partner?: unknown;
}

function buildContext(token?: string): { context: ExecutionContext; request: FakeRequest } {
  const request: FakeRequest = { headers: { authorization: token ? `Bearer ${token}` : undefined } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { context, request };
}

describe('AdminJwtGuard / UserJwtGuard / PartnerJwtGuard', () => {
  it('AdminJwtGuard aceita type=admin e anexa request.admin', async () => {
    const guard = new AdminJwtGuard(jwtService);
    const token = await jwtService.signAsync({
      sub: 'admin-1',
      organizationId: 'org-1',
      role: 'OWNER',
      type: 'admin',
    });
    const { context, request } = buildContext(token);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.admin).toMatchObject({ sub: 'admin-1', type: 'admin' });
  });

  it('AdminJwtGuard rejeita token com type diferente de admin', async () => {
    const guard = new AdminJwtGuard(jwtService);
    const token = await jwtService.signAsync({ sub: 'user-1', type: 'user' });
    const { context } = buildContext(token);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('UserJwtGuard aceita type=user e anexa request.user', async () => {
    const guard = new UserJwtGuard(jwtService);
    const token = await jwtService.signAsync({ sub: 'user-1', type: 'user' });
    const { context, request } = buildContext(token);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toMatchObject({ sub: 'user-1', type: 'user' });
  });

  it('UserJwtGuard rejeita token com type=admin', async () => {
    const guard = new UserJwtGuard(jwtService);
    const token = await jwtService.signAsync({
      sub: 'admin-1',
      organizationId: 'org-1',
      role: 'OWNER',
      type: 'admin',
    });
    const { context } = buildContext(token);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('PartnerJwtGuard aceita type=partner e anexa request.partner', async () => {
    const guard = new PartnerJwtGuard(jwtService);
    const token = await jwtService.signAsync({ sub: 'partner-1', type: 'partner' });
    const { context, request } = buildContext(token);

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.partner).toMatchObject({ sub: 'partner-1', type: 'partner' });
  });

  it('rejeita quando não há header Authorization', async () => {
    const guard = new AdminJwtGuard(jwtService);
    const { context } = buildContext();

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
