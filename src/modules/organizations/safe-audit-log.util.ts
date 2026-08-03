import { Prisma } from '@prisma/client';

/** Shape de AuditLog seguro pra sair em resposta HTTP — nunca ip (PII do ator). `payload`
 * fica: a redação de campos sensíveis dentro dele é responsabilidade de quem grava
 * (redactSensitiveFields), não deste endpoint de leitura. */
export const SAFE_AUDIT_LOG_SELECT = {
  id: true,
  organizationId: true,
  actorType: true,
  actorAdminUserId: true,
  action: true,
  payload: true,
  createdAt: true,
} satisfies Prisma.AuditLogSelect;

export type SafeAuditLog = Prisma.AuditLogGetPayload<{ select: typeof SAFE_AUDIT_LOG_SELECT }>;
