import { Injectable } from '@nestjs/common';
import { BatchStatus, CoinBatch } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformAdminAuditService } from '../platform-admin-audit.service';
import { BatchNotFoundException } from './exceptions/batch-not-found.exception';
import { BatchDecisionConflictException } from './exceptions/batch-decision-conflict.exception';
import { ListPlatformBatchesQuery } from './dto/list-platform-batches-query.schema';
import { RejectBatchInput } from './dto/reject-batch.schema';

export interface PlatformBatchItem {
  id: string;
  organizationId: string;
  organizationName: string;
  totalCoins: number;
  priceInCents: number;
  status: BatchStatus;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const PLATFORM_BATCH_LIST_PAGE_SIZE = 20;

type BatchWithOrganization = CoinBatch & { organization: { name: string } };

/**
 * Aprovação/recusa nunca chama LedgerService — só libera (ou não) o estoque do lote
 * (CoinBatch.status), exatamente como o webhook do Asaas já fazia. Nenhuma Wallet é
 * tocada aqui.
 *
 * Idempotência: repetir a MESMA decisão (aprovar um já PAID, recusar um já REJECTED) é um
 * no-op que devolve o estado atual, sem novo audit log. Decidir o OPOSTO de uma decisão já
 * tomada (aprovar um REJECTED, ou vice-versa) é erro de verdade (409), não replay.
 * `updateMany` guardado por `status: 'PENDING'` é o que resolve a corrida entre duas
 * decisões concorrentes: só quem realmente mudou uma linha (`count === 1`) grava audit log —
 * o perdedor da corrida só relê o estado final, sem se atribuir uma ação que não aconteceu.
 */
@Injectable()
export class PlatformBatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  async list(query: ListPlatformBatchesQuery): Promise<{ items: PlatformBatchItem[]; nextCursor: string | null }> {
    const limit = query.limit ?? PLATFORM_BATCH_LIST_PAGE_SIZE;

    const rows = await this.prisma.coinBatch.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: { organization: { select: { name: true } } },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const items = page.map((row) => this.toItem(row));
    const last = page[page.length - 1];

    return { items, nextCursor: hasMore && last ? last.id : null };
  }

  async approve(platformAdminId: string, batchId: string, ip: string | undefined): Promise<PlatformBatchItem> {
    const batch = await this.findOrThrow(batchId);

    if (batch.status === 'PAID') {
      return this.toItem(batch);
    }
    if (batch.status !== 'PENDING') {
      throw new BatchDecisionConflictException(batch.status);
    }

    const result = await this.prisma.coinBatch.updateMany({
      where: { id: batchId, status: 'PENDING' },
      data: { status: 'PAID', approvedByPlatformAdminId: platformAdminId },
    });

    if (result.count === 1) {
      await this.auditService.record({
        platformAdminId,
        action: 'BATCH_APPROVED',
        payload: {
          batchId,
          organizationId: batch.organizationId,
          priceInCents: batch.priceInCents,
          totalCoins: batch.totalCoins,
        },
        ip,
      });
    }

    return this.toItem(await this.findOrThrow(batchId));
  }

  async reject(
    platformAdminId: string,
    batchId: string,
    input: RejectBatchInput,
    ip: string | undefined,
  ): Promise<PlatformBatchItem> {
    const batch = await this.findOrThrow(batchId);

    if (batch.status === 'REJECTED') {
      return this.toItem(batch);
    }
    if (batch.status !== 'PENDING') {
      throw new BatchDecisionConflictException(batch.status);
    }

    const result = await this.prisma.coinBatch.updateMany({
      where: { id: batchId, status: 'PENDING' },
      data: { status: 'REJECTED', rejectedByPlatformAdminId: platformAdminId, rejectionReason: input.reason ?? null },
    });

    if (result.count === 1) {
      await this.auditService.record({
        platformAdminId,
        action: 'BATCH_REJECTED',
        payload: { batchId, organizationId: batch.organizationId, reason: input.reason ?? null },
        ip,
      });
    }

    return this.toItem(await this.findOrThrow(batchId));
  }

  private async findOrThrow(batchId: string): Promise<BatchWithOrganization> {
    const batch = await this.prisma.coinBatch.findUnique({
      where: { id: batchId },
      include: { organization: { select: { name: true } } },
    });
    if (!batch) {
      throw new BatchNotFoundException();
    }
    return batch;
  }

  private toItem(batch: BatchWithOrganization): PlatformBatchItem {
    return {
      id: batch.id,
      organizationId: batch.organizationId,
      organizationName: batch.organization.name,
      totalCoins: batch.totalCoins,
      priceInCents: batch.priceInCents,
      status: batch.status,
      rejectionReason: batch.rejectionReason,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
    };
  }
}
