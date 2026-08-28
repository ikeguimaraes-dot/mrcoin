import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Trilha de auditoria própria do PlatformAdmin (PlatformAdminAuditLog) — a tabela
 * AuditLog exige organizationId e não serve pra um ator platform-wide. platformAdminId
 * nulo registra tentativa de login com e-mail desconhecido, sem FK.
 */
@Injectable()
export class PlatformAdminAuditService {
  constructor(private readonly prisma: PrismaService) {}

  record(params: {
    platformAdminId: string | null;
    action: string;
    payload?: Prisma.InputJsonValue;
    ip?: string;
  }): Promise<unknown> {
    return this.prisma.platformAdminAuditLog.create({
      data: {
        platformAdminId: params.platformAdminId,
        action: params.action,
        payload: params.payload ?? {},
        ip: params.ip ?? 'unknown',
      },
    });
  }
}
