import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { InsufficientBalanceException } from '../ledger/exceptions/insufficient-balance.exception';
import { WalletsService } from '../wallets/wallets.service';
import { TransactionPinService } from '../users/transaction-pin.service';
import { offerAvailabilityWhere } from '../offers/offer-availability.util';
import { OfferNotFoundException } from '../offers/exceptions/offer-not-found.exception';
import { CreateRedemptionInput } from './dto/create-redemption.schema';
import { ConfirmRedemptionInput } from './dto/confirm-redemption.schema';
import { REDEMPTION_CODE_GENERATION_MAX_ATTEMPTS } from './redemptions.constants';
import { generatePickupCode } from './redemption-code.util';
import { RedemptionNotFoundException } from './exceptions/redemption-not-found.exception';
import { RedemptionLimitReachedException } from './exceptions/redemption-limit-reached.exception';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { SAFE_REDEMPTION_SELECT, SafeRedemption } from './safe-redemption.util';
import { PartnerRedemptionConfirmResponseDto } from './dto/partner-redemption-confirm-response.schema';
import { extractFirstName } from './partner-redemption.util';

const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/**
 * Resgate é compra instantânea (regra do produto — ver plano da Sessão 22): `create()` já
 * debita, com PIN de transação validado antes do débito. Não existe mais estado "aguardando
 * parceiro" nem expiração — o que falta depois da compra é só entrega física, marcada em
 * `deliver()`. As garantias inegociáveis que existiam em `confirm()` (reuso de
 * Idempotency-Key não debita 2x, saldo checado atomicamente, só o dono confirma) continuam
 * valendo, só que agora dentro de `create()`.
 */
@Injectable()
export class RedemptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly walletsService: WalletsService,
    private readonly transactionPinService: TransactionPinService,
  ) {}

  async create(userId: string, input: CreateRedemptionInput, idempotencyKey: string): Promise<SafeRedemption> {
    const existing = await this.prisma.redemption.findUnique({
      where: { idempotencyKey },
      select: SAFE_REDEMPTION_SELECT,
    });
    if (existing) {
      this.assertIdempotentReplayMatches(existing, input, idempotencyKey);
      return existing;
    }

    const { membershipId, walletId } = await this.walletsService.resolveWalletId(userId, input.organizationId);

    const offer = await this.prisma.offer.findFirst({
      where: { id: input.offerId, ...offerAvailabilityWhere() },
      select: { id: true, partnerId: true, title: true, costInCoins: true, perUserLimit: true },
    });
    if (!offer) {
      throw new OfferNotFoundException();
    }

    if (offer.perUserLimit !== null) {
      const count = await this.prisma.redemption.count({
        where: { membershipId, offerId: offer.id, status: { in: ['CONFIRMED', 'DELIVERED'] } },
      });
      if (count >= offer.perUserLimit) {
        throw new RedemptionLimitReachedException();
      }
    }

    // Pré-checagem de saldo ANTES de pedir/validar o PIN — não faz sentido cobrar uma
    // tentativa de PIN de um pedido que já ia falhar por saldo. A garantia atômica de
    // verdade continua dentro da transação do LedgerService.post() (regra 4 do CLAUDE.md).
    const { cachedBalance } = await this.ledgerService.getBalance(walletId);
    if (cachedBalance < offer.costInCoins) {
      throw new InsufficientBalanceException(walletId, offer.costInCoins, cachedBalance);
    }

    await this.transactionPinService.verifyPin(userId, input.transactionPin);

    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: offer.partnerId },
      select: { name: true },
    });

    // redemptionId DETERMINÍSTICO a partir da Idempotency-Key do cliente (não randomUUID) —
    // vira o `id` explícito da linha E o `referenceId` do ledger entry, permitindo debitar
    // ANTES da linha existir. Precisa ser determinístico: duas requisições concorrentes (ou
    // um retry) com a MESMA Idempotency-Key têm que calcular o MESMO redemptionId, senão a
    // 2ª bate no guard de idempotência do próprio LedgerService (referenceId divergente pra
    // uma chave já usada) em vez de reconciliar. Sem `tx` no post() — mesmo motivo de
    // sempre, preserva o retry de optimistic lock do próprio LedgerService.
    const redemptionId = createHash('sha256').update(`redemption:${idempotencyKey}`).digest('hex');
    const entry = await this.ledgerService.post({
      walletId,
      type: 'DEBIT',
      amount: offer.costInCoins,
      referenceType: 'REDEMPTION',
      referenceId: redemptionId,
      description: `Resgate — ${offer.title ?? partner.name}`,
      idempotencyKey: `redemption-create:${idempotencyKey}`,
    });

    const now = new Date();
    for (let attempt = 0; attempt < REDEMPTION_CODE_GENERATION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.redemption.create({
          data: {
            id: redemptionId,
            membershipId,
            walletId,
            partnerId: offer.partnerId,
            offerId: offer.id,
            amount: offer.costInCoins,
            pickupCode: generatePickupCode(),
            qrPayload: randomBytes(32).toString('hex'),
            idempotencyKey,
            status: 'CONFIRMED',
            confirmedAt: now,
            ledgerEntryId: entry.id,
          },
          select: SAFE_REDEMPTION_SELECT,
        });
      } catch (error) {
        // `id` colide junto com `idempotencyKey` (os dois são determinísticos a partir da
        // mesma Idempotency-Key do cliente) — uma corrida entre duas requisições com a
        // mesma chave sempre bate nas duas juntas ou em nenhuma; tratamento idêntico.
        if (this.isUniqueViolationOn(error, 'idempotencyKey') || this.isUniqueViolationOn(error, 'id')) {
          const raced = await this.prisma.redemption.findUniqueOrThrow({
            where: { idempotencyKey },
            select: SAFE_REDEMPTION_SELECT,
          });
          this.assertIdempotentReplayMatches(raced, input, idempotencyKey);
          return raced;
        }
        if (this.isUniqueViolationOn(error, 'pickupCode') || this.isUniqueViolationOn(error, 'qrPayload')) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Não foi possível gerar um código de retirada único após múltiplas tentativas.');
  }

  async getById(userId: string, id: string): Promise<SafeRedemption> {
    const redemption = await this.prisma.redemption.findUnique({
      where: { id },
      include: { membership: { select: { userId: true } } },
    });

    if (!redemption || redemption.membership.userId !== userId) {
      throw new RedemptionNotFoundException();
    }

    return this.prisma.redemption.findUniqueOrThrow({ where: { id }, select: SAFE_REDEMPTION_SELECT });
  }

  /** Marca entrega física — nunca move coins, nunca checa saldo. Idempotente: chamar de
   * novo num resgate já DELIVERED só devolve o estado atual, sem erro. Só o parceiro dono
   * (404 se não bate, nunca revela resgate de outro parceiro). */
  async deliver(
    partnerId: string,
    input: ConfirmRedemptionInput,
  ): Promise<{ redemption: SafeRedemption; alreadyDelivered: boolean }> {
    const redemption = input.pickupCode
      ? await this.prisma.redemption.findUnique({ where: { pickupCode: input.pickupCode } })
      : await this.prisma.redemption.findUnique({ where: { qrPayload: input.qrPayload as string } });

    if (!redemption || redemption.partnerId !== partnerId) {
      throw new RedemptionNotFoundException();
    }

    return this.transitionToDelivered(redemption.id, 'PARTNER', partnerId);
  }

  /** Equivalente de deliver() pro platform admin — sem restrição de parceiro dono (marca
   * entrega de qualquer resgate), busca por id OU pickupCode OU qrPayload. */
  async deliverByPlatformAdmin(
    platformAdminId: string,
    input: { redemptionId?: string; pickupCode?: string; qrPayload?: string },
  ): Promise<{ redemption: SafeRedemption; alreadyDelivered: boolean }> {
    const redemption = input.redemptionId
      ? await this.prisma.redemption.findUnique({ where: { id: input.redemptionId } })
      : input.pickupCode
        ? await this.prisma.redemption.findUnique({ where: { pickupCode: input.pickupCode } })
        : await this.prisma.redemption.findUnique({ where: { qrPayload: input.qrPayload as string } });

    if (!redemption) {
      throw new RedemptionNotFoundException();
    }

    return this.transitionToDelivered(redemption.id, 'PLATFORM_ADMIN', platformAdminId);
  }

  private async transitionToDelivered(
    redemptionId: string,
    deliveredByType: 'PARTNER' | 'PLATFORM_ADMIN',
    deliveredById: string,
  ): Promise<{ redemption: SafeRedemption; alreadyDelivered: boolean }> {
    const current = await this.prisma.redemption.findUniqueOrThrow({
      where: { id: redemptionId },
      select: { status: true },
    });

    if (current.status === 'DELIVERED') {
      return {
        redemption: await this.prisma.redemption.findUniqueOrThrow({ where: { id: redemptionId }, select: SAFE_REDEMPTION_SELECT }),
        alreadyDelivered: true,
      };
    }

    const now = new Date();
    await this.prisma.redemption.updateMany({
      where: { id: redemptionId, status: 'CONFIRMED' },
      data: { status: 'DELIVERED', deliveredAt: now, deliveredByType, deliveredById },
    });

    return {
      redemption: await this.prisma.redemption.findUniqueOrThrow({ where: { id: redemptionId }, select: SAFE_REDEMPTION_SELECT }),
      alreadyDelivered: false,
    };
  }

  /**
   * Wrapper de deliver() só pra moldar a resposta que o portal do parceiro recebe. Busca
   * offerTitle e o primeiro nome do cliente à parte porque SAFE_REDEMPTION_SELECT nunca
   * inclui membershipId (não faz sentido sair em resposta HTTP), então não dá pra chegar no
   * User a partir do retorno de deliver().
   */
  async deliverForPartner(partnerId: string, input: ConfirmRedemptionInput): Promise<PartnerRedemptionConfirmResponseDto> {
    const { redemption } = await this.deliver(partnerId, input);

    const [offer, redemptionWithCustomer] = await Promise.all([
      redemption.offerId
        ? this.prisma.offer.findUnique({ where: { id: redemption.offerId }, select: { title: true } })
        : Promise.resolve(null),
      this.prisma.redemption.findUniqueOrThrow({
        where: { id: redemption.id },
        select: { membership: { select: { user: { select: { name: true } } } } },
      }),
    ]);

    return {
      id: redemption.id,
      amount: redemption.amount,
      // O status do Prisma inclui PENDING/EXPIRED só por causa da migração aditiva do enum
      // (ver schema.prisma) — a aplicação nunca escreve nenhum dos dois, então aqui só pode
      // ser CONFIRMED ou DELIVERED de verdade.
      status: redemption.status as 'CONFIRMED' | 'DELIVERED',
      confirmedAt: redemption.confirmedAt ? redemption.confirmedAt.toISOString() : null,
      deliveredAt: redemption.deliveredAt ? redemption.deliveredAt.toISOString() : null,
      offerTitle: offer?.title ?? null,
      customerFirstName: extractFirstName(redemptionWithCustomer.membership.user.name),
    };
  }

  private assertIdempotentReplayMatches(
    existing: SafeRedemption,
    input: CreateRedemptionInput,
    idempotencyKey: string,
  ): void {
    if (existing.offerId !== input.offerId) {
      throw new IdempotencyConflictException(idempotencyKey, { redemptionId: existing.id });
    }
  }

  private isUniqueViolationOn(error: unknown, field: string): boolean {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== UNIQUE_CONSTRAINT_ERROR_CODE) {
      return false;
    }
    const target = error.meta?.target;
    return Array.isArray(target) && target.includes(field);
  }
}
