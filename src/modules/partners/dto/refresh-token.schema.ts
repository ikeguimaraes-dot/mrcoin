import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const partnerRefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export type PartnerRefreshTokenInput = z.infer<typeof partnerRefreshTokenSchema>;
export class PartnerRefreshTokenDto extends createZodDto(partnerRefreshTokenSchema) {}
