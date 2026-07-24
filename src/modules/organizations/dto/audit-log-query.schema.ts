import { z } from 'zod';

export const auditLogQuerySchema = z.object({
  action: z.string().min(1).optional(),
  actorAdminUserId: z.string().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
