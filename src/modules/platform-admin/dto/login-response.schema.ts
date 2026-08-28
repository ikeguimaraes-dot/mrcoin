import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Sem variante 'OK': MFA é obrigatório sem exceção pra PlatformAdmin (ver
// PlatformAdminAuthService.login) — login nunca devolve token pair direto, sempre passa
// por mfa/verify ou mfa/enable primeiro.
export const loginResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('MFA_REQUIRED'), mfaChallengeToken: z.string() }),
  z.object({ status: z.literal('MFA_SETUP_REQUIRED'), mfaChallengeToken: z.string() }),
]);
export const LoginResponseDto = createZodDto(loginResponseSchema);
Object.defineProperty(LoginResponseDto, 'name', { value: 'PlatformAdminLoginResponseDto' });
