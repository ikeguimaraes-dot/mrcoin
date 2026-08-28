import { AdminRole } from '@prisma/client';

export interface AdminJwtPayload {
  sub: string;
  organizationId: string;
  role: AdminRole;
  type: 'admin';
}

export interface MfaChallengeJwtPayload {
  sub: string;
  type: 'mfa_challenge';
}

export interface UserJwtPayload {
  sub: string;
  type: 'user';
}

export interface PartnerJwtPayload {
  sub: string;
  type: 'partner';
}

/** Assinado/verificado via PLATFORM_JWT_SERVICE (secret dedicado) — nunca o JwtService global. */
export interface PlatformAdminJwtPayload {
  sub: string;
  type: 'platform_admin';
}

export interface PlatformMfaChallengeJwtPayload {
  sub: string;
  type: 'platform_mfa_challenge';
}
