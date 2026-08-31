import { BadRequestException, Injectable } from '@nestjs/common';
import { CoinBatch } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService, PixChargeResult } from '../billing/billing.service';
import { ConversionRateService } from '../settings/conversion-rate.service';
import { BATCH_LIST_PAGE_SIZE, MIN_BATCH_PRICE_IN_CENTS } from './batches.constants';
import { CreateBatchInput } from './dto/create-batch.schema';
import { ListBatchesQuery } from './dto/list-batches.schema';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { SAFE_COIN_BATCH_SELECT, SafeCoinBatch, toSafeCoinBatch } from './safe-coin-batch.util';

export interface CreateBatchResult {
  batch: SafeCoinBatch;
  pix: Pick<PixChargeResult, 'qrCodeImage' | 'copyPasteCode' | 'expirationDate'> | null;
}

/** Ciclo de vida do CoinBatch. Nunca chama LedgerService: pagar um lote só libera
 * estoque de coins (CoinBatch.status/remainingCoins) — o crédito na Wallet de um
 * Membership específico acontece depois, na distribuição (fora deste módulo). */
@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly conversionRateService: ConversionRateService,
  ) {}

  async createPendingBatch(
    organizationId: string,
    input: CreateBatchInput,
    idempotencyKey: string,
  ): Promise<CreateBatchResult> {
    const existing = await this.prisma.coinBatch.findUnique({ where: { idempotencyKey } });

    if (existing) {
      return this.replayExisting(existing, organizationId, input, idempotencyKey);
    }

    const expiresAt = addMonths(new Date(), input.validityMonths);

    const rate = await this.conversionRateService.getCurrentRateForOrganization(organizationId);
    const priceInCents = Math.round((input.totalCoins * 10000) / rate.coinsPerRealScaled);

    if (priceInCents < MIN_BATCH_PRICE_IN_CENTS) {
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: `totalCoins resulta num preço de R$${(priceInCents / 100).toFixed(2)} com a taxa de conversão vigente — abaixo do mínimo de R$${(MIN_BATCH_PRICE_IN_CENTS / 100).toFixed(2)}. Aumente a quantidade de coins.`,
      });
    }

    const charge = await this.billingService.createChargeForOrganization(
      organizationId,
      priceInCents,
      'Compra de lote de coins',
      idempotencyKey,
    );

    const batch = await this.prisma.coinBatch.create({
      data: {
        organizationId,
        totalCoins: input.totalCoins,
        remainingCoins: input.totalCoins,
        priceInCents,
        status: 'PENDING',
        expiresAt,
        pspChargeId: charge.pspChargeId,
        idempotencyKey,
      },
      select: SAFE_COIN_BATCH_SELECT,
    });

    return {
      batch,
      pix: {
        qrCodeImage: charge.qrCodeImage,
        copyPasteCode: charge.copyPasteCode,
        expirationDate: charge.expirationDate,
      },
    };
  }

  async listBatches(
    organizationId: string,
    query: ListBatchesQuery,
  ): Promise<{ items: SafeCoinBatch[]; nextCursor: string | null }> {
    const limit = query.limit ?? BATCH_LIST_PAGE_SIZE;

    const batches = await this.prisma.coinBatch.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SAFE_COIN_BATCH_SELECT,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = batches.length > limit;
    const page = hasMore ? batches.slice(0, limit) : batches;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }

  private async replayExisting(
    existing: CoinBatch,
    organizationId: string,
    input: CreateBatchInput,
    idempotencyKey: string,
  ): Promise<CreateBatchResult> {
    const paramsMatch =
      existing.organizationId === organizationId && existing.totalCoins === input.totalCoins;

    if (!paramsMatch) {
      throw new IdempotencyConflictException(idempotencyKey, { batchId: existing.id });
    }

    const pix = existing.pspChargeId ? await this.billingService.refetchQrCode(existing.pspChargeId) : null;

    return { batch: toSafeCoinBatch(existing), pix };
  }
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}
