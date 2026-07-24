import { Injectable } from '@nestjs/common';
import { AuditLog, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AUDIT_LOG_PAGE_SIZE } from './organizations.constants';
import { AuditLogQuery } from './dto/audit-log-query.schema';

/** Leitura de AuditLog sempre escopada por organizationId recebido explicitamente (o
 * controller garante que vem do JWT via TenantGuard, nunca de query livre). */
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    query: AuditLogQuery,
  ): Promise<{ items: AuditLog[]; nextCursor: string | null }> {
    const limit = query.limit ?? AUDIT_LOG_PAGE_SIZE;
    const where: Prisma.AuditLogWhereInput = {
      organizationId,
      ...(query.action ? { action: query.action } : {}),
      ...(query.actorAdminUserId ? { actorAdminUserId: query.actorAdminUserId } : {}),
      ...(query.from || query.to
        ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
        : {}),
    };

    const entries = await this.prisma.auditLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = entries.length > limit;
    const page = hasMore ? entries.slice(0, limit) : entries;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }
}
