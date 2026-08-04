import { AdminRole } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const inviteResultResponseSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: z.nativeEnum(AdminRole),
  expiresAt: z.string().datetime(),
  inviteLink: z.string(),
});
export class InviteResultResponseDto extends createZodDto(inviteResultResponseSchema) {}
