import { AdminJwtPayload, PartnerJwtPayload, UserJwtPayload } from './jwt-payload.types';

declare global {
  namespace Express {
    interface Request {
      admin?: AdminJwtPayload;
      user?: UserJwtPayload;
      partner?: PartnerJwtPayload;
      organizationId?: string;
      /** Setado pelo MfaChallengeGuard — id do AdminUser dono do challenge em andamento. */
      mfaChallengeAdminId?: string;
      /** Setado pelo MfaSetupGuard — id do AdminUser (sessão completa ou challenge). */
      mfaSetupAdminId?: string;
    }
  }
}
