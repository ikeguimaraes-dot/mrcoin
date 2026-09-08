import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const organizationQuerySchema = z.object({
  organizationId: z.string().min(1),
});

export type OrganizationQuery = z.infer<typeof organizationQuerySchema>;
export class OrganizationQueryDto extends createZodDto(organizationQuerySchema) {}
