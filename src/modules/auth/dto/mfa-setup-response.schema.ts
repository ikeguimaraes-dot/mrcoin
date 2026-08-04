import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const mfaSetupResponseSchema = z.object({
  secret: z.string(),
  otpauthUrl: z.string(),
  qrCodeDataUrl: z.string(),
});
export class MfaSetupResponseDto extends createZodDto(mfaSetupResponseSchema) {}
