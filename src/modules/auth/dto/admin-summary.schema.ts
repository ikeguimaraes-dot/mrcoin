import { AdminRole, AdminUserStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const adminSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  role: z.nativeEnum(AdminRole),
  status: z.nativeEnum(AdminUserStatus),
  mfaEnabled: z.boolean(),
});
export class AdminSummaryDto extends createZodDto(adminSummarySchema) {}

export const adminProfileSchema = adminSummarySchema.extend({
  organizationId: z.string(),
  lastLoginAt: z.string().datetime().nullable(),
});
export class AdminProfileDto extends createZodDto(adminProfileSchema) {}
