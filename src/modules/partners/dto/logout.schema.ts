import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const partnerLogoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export type PartnerLogoutInput = z.infer<typeof partnerLogoutSchema>;
export class PartnerLogoutDto extends createZodDto(partnerLogoutSchema) {}
