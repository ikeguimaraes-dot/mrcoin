import { AuditActorType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';

export const auditLogItemSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  actorType: z.nativeEnum(AuditActorType),
  actorAdminUserId: z.string().nullable(),
  action: z.string(),
  payload: z.unknown(),
  createdAt: z.string().datetime(),
});

export const auditLogListResponseSchema = paginatedResponseSchema(auditLogItemSchema);
export class AuditLogListResponseDto extends createZodDto(auditLogListResponseSchema) {}
