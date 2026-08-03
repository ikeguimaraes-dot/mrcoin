import { AdminRole } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const changeRoleSchema = z.object({
  role: z.nativeEnum(AdminRole),
});

export type ChangeRoleInput = z.infer<typeof changeRoleSchema>;
export class ChangeRoleDto extends createZodDto(changeRoleSchema) {}
