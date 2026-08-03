import { AdminRole } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const inviteAdminSchema = z.object({
  email: z.string().email(),
  role: z.nativeEnum(AdminRole),
});

export type InviteAdminInput = z.infer<typeof inviteAdminSchema>;
export class InviteAdminDto extends createZodDto(inviteAdminSchema) {}
