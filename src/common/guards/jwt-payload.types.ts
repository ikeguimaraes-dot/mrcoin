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
