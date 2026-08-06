import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const partnerLoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export type PartnerLoginInput = z.infer<typeof partnerLoginSchema>;
export class PartnerLoginDto extends createZodDto(partnerLoginSchema) {}
