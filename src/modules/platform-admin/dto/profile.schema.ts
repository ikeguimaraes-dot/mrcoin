import { PlatformAdminStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const platformAdminProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  status: z.nativeEnum(PlatformAdminStatus),
  mfaEnabled: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
});
export class PlatformAdminProfileDto extends createZodDto(platformAdminProfileSchema) {}
