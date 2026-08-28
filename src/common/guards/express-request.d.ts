import { AdminJwtPayload, PartnerJwtPayload, PlatformAdminJwtPayload, UserJwtPayload } from './jwt-payload.types';

declare global {
  namespace Express {
    interface Request {
      admin?: AdminJwtPayload;
      user?: UserJwtPayload;
      partner?: PartnerJwtPayload;
      platformAdmin?: PlatformAdminJwtPayload;
      organizationId?: string;
      /** Setado pelo MfaChallengeGuard — id do AdminUser dono do challenge em andamento. */
      mfaChallengeAdminId?: string;
      /** Setado pelo MfaSetupGuard — id do AdminUser (sessão completa ou challenge). */
      mfaSetupAdminId?: string;
      /** Setado pelo PlatformMfaChallengeGuard — id do PlatformAdmin dono do challenge em andamento. */
      platformMfaChallengeId?: string;
      /** Setado pelo PlatformMfaSetupGuard — id do PlatformAdmin (sessão completa ou challenge). */
      platformMfaSetupId?: string;
    }
  }
}
