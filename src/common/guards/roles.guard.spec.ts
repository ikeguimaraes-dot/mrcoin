import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole } from '@prisma/client';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from '../decorators/roles.decorator';

const reflector = new Reflector();
const guard = new RolesGuard(reflector);

function buildContext(callerRole: AdminRole | undefined, requiredRoles: AdminRole[]): ExecutionContext {
  class DummyController {}
  function dummyHandler(): void {}
  Reflect.defineMetadata(ROLES_KEY, requiredRoles, dummyHandler);

  const request = { admin: callerRole ? { role: callerRole } : undefined };

  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => dummyHandler,
    getClass: () => DummyController,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('@Roles(MANAGER) permite OWNER (hierarquia — cargo maior sempre passa)', () => {
    expect(guard.canActivate(buildContext('OWNER', ['MANAGER']))).toBe(true);
  });

  it('@Roles(MANAGER) permite MANAGER (match exato)', () => {
    expect(guard.canActivate(buildContext('MANAGER', ['MANAGER']))).toBe(true);
  });

  it('@Roles(MANAGER) bloqueia OPERATOR', () => {
    expect(() => guard.canActivate(buildContext('OPERATOR', ['MANAGER']))).toThrow(ForbiddenException);
  });

  it('@Roles(MANAGER) bloqueia VIEWER', () => {
    expect(() => guard.canActivate(buildContext('VIEWER', ['MANAGER']))).toThrow(ForbiddenException);
  });

  it('sem @Roles(), qualquer admin autenticado passa', () => {
    expect(guard.canActivate(buildContext('VIEWER', []))).toBe(true);
  });

  it('bloqueia quando request.admin não existe, mesmo com @Roles([VIEWER])', () => {
    expect(() => guard.canActivate(buildContext(undefined, ['VIEWER']))).toThrow(ForbiddenException);
  });
});
