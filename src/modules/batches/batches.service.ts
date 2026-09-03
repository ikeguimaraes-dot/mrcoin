import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CoinBatch } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { ConversionRateService } from '../settings/conversion-rate.service';
import { Env } from '../../config/env.schema';
import { BATCH_LIST_PAGE_SIZE, MIN_BATCH_PRICE_IN_CENTS } from './batches.constants';
import { CreateBatchInput } from './dto/create-batch.schema';
import { ListBatchesQuery } from './dto/list-batches.schema';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { SAFE_COIN_BATCH_SELECT, SafeCoinBatch, toSafeCoinBatch } from './safe-coin-batch.util';

export type PixInfo =
  | { method: 'ASAAS'; qrCodeImage: string; copyPasteCode: string; expirationDate: string }
  | { method: 'MANUAL'; pixKey: string; amountInCents: number };

export interface CreateBatchResult {
  batch: SafeCoinBatch;
  pix: PixInfo | null;
}

/**
 * Ciclo de vida do CoinBatch. Nunca chama LedgerService: pagar/aprovar um lote só libera
 * estoque de coins (CoinBatch.status/remainingCoins) — o crédito na Wallet de um
 * Membership específico acontece depois, na distribuição (fora deste módulo).
 *
 * ASAAS_ENABLED=false (padrão — compra de lote virou aprovação manual pela plataforma):
 * não chama o PSP, o lote nasce PENDING sem pspChargeId, e a resposta traz a chave Pix
 * fixa da mrcoin + o valor exato em vez de um QR dinâmico. O código do Asaas continua
 * intacto e é usado sem alteração quando ASAAS_ENABLED=true (rollback/caso específico).
 */
@Injectable()
export class BatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billingService: BillingService,
    private readonly conversionRateService: ConversionRateService,
    private readonly config: ConfigService<Env, true>,
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

    const asaasEnabled = this.config.get('ASAAS_ENABLED', { infer: true });

    const { pspChargeId, pix } = asaasEnabled
      ? await this.createViaAsaas(organizationId, priceInCents, idempotencyKey)
      : { pspChargeId: null, pix: this.manualPix(priceInCents) };

    const batch = await this.prisma.coinBatch.create({
      data: {
        organizationId,
        totalCoins: input.totalCoins,
        remainingCoins: input.totalCoins,
        priceInCents,
        status: 'PENDING',
        expiresAt,
        pspChargeId,
        idempotencyKey,
      },
      select: SAFE_COIN_BATCH_SELECT,
    });

    return { batch, pix };
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

  private async createViaAsaas(
    organizationId: string,
    priceInCents: number,
    idempotencyKey: string,
  ): Promise<{ pspChargeId: string; pix: PixInfo }> {
    const charge = await this.billingService.createChargeForOrganization(
      organizationId,
      priceInCents,
      'Compra de lote de coins',
      idempotencyKey,
    );

    return {
      pspChargeId: charge.pspChargeId,
      pix: {
        method: 'ASAAS',
        qrCodeImage: charge.qrCodeImage,
        copyPasteCode: charge.copyPasteCode,
        expirationDate: charge.expirationDate,
      },
    };
  }

  private manualPix(priceInCents: number): PixInfo {
    return {
      method: 'MANUAL',
      pixKey: this.config.get('MRCOIN_PIX_KEY', { infer: true }),
      amountInCents: priceInCents,
    };
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

    // O modo é decidido pelo que o lote JÁ tem (pspChargeId presente = nasceu via Asaas),
    // não pela flag atual — evita reconsultar o PSP errado se ASAAS_ENABLED mudar entre a
    // criação original e o replay.
    const pix = existing.pspChargeId
      ? ({ method: 'ASAAS', ...(await this.billingService.refetchQrCode(existing.pspChargeId)) } satisfies PixInfo)
      : this.manualPix(existing.priceInCents);

    return { batch: toSafeCoinBatch(existing), pix };
  }
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}
