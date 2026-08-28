/**
 * Token de injeção da instância dedicada de JwtService do PlatformAdmin (secret
 * PLATFORM_ADMIN_JWT_SECRET, separado do JwtService global usado por AdminUser/Partner/
 * User). Ver PlatformAdminModule pra o factory provider.
 */
export const PLATFORM_JWT_SERVICE = Symbol('PLATFORM_JWT_SERVICE');
