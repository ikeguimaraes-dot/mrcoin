import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { tokenPairSchema } from './token-pair.schema';

export const loginResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('MFA_REQUIRED'), mfaChallengeToken: z.string() }),
  z.object({ status: z.literal('MFA_SETUP_REQUIRED'), mfaChallengeToken: z.string() }),
  z.object({ status: z.literal('OK') }).merge(tokenPairSchema),
]);
// União não aceita `class X extends createZodDto(...) {}` — TS recusa "extends" quando o
// tipo da instância é uma união de objetos (exige objeto único ou interseção). Mesmo recurso
// que o próprio nestjs-zod usa internamente pra .Output: cria a classe e renomeia via
// defineProperty, já que o nome da classe interna vira o nome do schema no OpenAPI gerado.
export const LoginResponseDto = createZodDto(loginResponseSchema);
Object.defineProperty(LoginResponseDto, 'name', { value: 'LoginResponseDto' });
