import { AdminRole } from '@prisma/client';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const MFA_CHALLENGE_TTL_SECONDS = 5 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

export const TOTP_ISSUER = 'Coins';

/** OWNER e MANAGER nunca ficam com sessão válida sem MFA configurado — vale tanto pro
 * login normal (AuthService) quanto pro aceite de convite (AdminInvitesService), única
 * fonte de verdade pra não os dois lugares divergirem. */
export const MFA_MANDATORY_ROLES: AdminRole[] = ['OWNER', 'MANAGER'];
