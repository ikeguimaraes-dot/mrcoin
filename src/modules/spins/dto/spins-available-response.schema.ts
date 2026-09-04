import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const spinsAvailableResponseSchema = z.object({
  availableSpins: z.number().int().nonnegative(),
  /** SPIN_SECTORS na mesma ordem usada por POST /spins/redeem pra sortear — índice = posição
   * física da roleta. Contrato explícito pro app nunca precisar hardcodar essa ordem. */
  sectors: z.array(z.number().int().positive()).length(8),
});

export class SpinsAvailableResponseDto extends createZodDto(spinsAvailableResponseSchema) {}
