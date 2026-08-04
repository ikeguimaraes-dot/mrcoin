import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const meResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  cpfMasked: z.string(),
  notificationsEnabled: z.boolean(),
});
export class MeResponseDto extends createZodDto(meResponseSchema) {}
