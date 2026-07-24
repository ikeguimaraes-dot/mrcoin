import { AdminRole } from '@prisma/client';
import { z } from 'zod';

export const changeRoleSchema = z.object({
  role: z.nativeEnum(AdminRole),
});

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
