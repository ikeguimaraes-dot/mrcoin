import { SetMetadata } from '@nestjs/common';
import { AdminRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/** Cargo mínimo exigido — hierárquico, ver RolesGuard (OWNER > MANAGER > OPERATOR > VIEWER). */
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);
