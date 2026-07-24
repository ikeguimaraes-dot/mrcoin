import { AdminRole } from '@prisma/client';
import { z } from 'zod';

export const inviteAdminSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(AdminRole),
});

export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;
