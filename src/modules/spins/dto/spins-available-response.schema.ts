import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const spinsAvailableResponseSchema = z.object({
  availableSpins: z.number().int().nonnegative(),
});

export class SpinsAvailableResponseDto extends createZodDto(spinsAvailableResponseSchema) {}
