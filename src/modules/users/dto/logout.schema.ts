import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const logoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export type LogoutInput = z.infer<typeof logoutSchema>;
export class UserLogoutDto extends createZodDto(logoutSchema) {}
