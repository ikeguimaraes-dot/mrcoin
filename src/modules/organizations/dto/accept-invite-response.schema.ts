import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { tokenPairSchema } from '../../auth/dto/token-pair.schema';

export const acceptInviteResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('MFA_SETUP_REQUIRED'), mfaChallengeToken: z.string() }),
  z.object({ status: z.literal('OK') }).merge(tokenPairSchema),
]);
// Mesmo motivo do LoginResponseDto (auth/dto/login-response.schema.ts): união não aceita
// `extends`, então a classe é criada e renomeada via defineProperty em vez de subclassada.
export const AcceptInviteResponseDto = createZodDto(acceptInviteResponseSchema);
Object.defineProperty(AcceptInviteResponseDto, 'name', { value: 'AcceptInviteResponseDto' });
