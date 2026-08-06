export const PARTNER_LIST_PAGE_SIZE = 20;

/** Mesmos valores do TokenService de admin (auth.constants.ts) — access curto + refresh
 * longo com rotação, mecânica simplificada como o UserTokenService (sem organizationId,
 * sem AuditLog: Partner não tem organização). */
export const PARTNER_ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const PARTNER_REFRESH_TOKEN_TTL_DAYS = 30;
