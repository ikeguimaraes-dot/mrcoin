export const OTP_TTL_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_CODE_LENGTH = 6;

export const USER_ACCESS_TOKEN_TTL_DAYS = 30;

/** Mesmo valor do REFRESH_TOKEN_TTL_DAYS do admin (auth.constants.ts) — reaproveita o TTL do
 * mecanismo existente, não só a mecânica de rotação/detecção de reuso. */
export const USER_REFRESH_TOKEN_TTL_DAYS = 30;
