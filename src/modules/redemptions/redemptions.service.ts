import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { WalletsService } from '../wallets/wallets.service';
import { offerAvailabilityWhere } from '../offers/offer-availability.util';
import { OfferNotFoundException } from '../offers/exceptions/offer-not-found.exception';
import { CreateRedemptionInput } from './dto/create-redemption.schema';
import { ConfirmRedemptionInput } from './dto/confirm-redemption.schema';
import { REDEMPTION_CODE_GENERATION_MAX_ATTEMPTS, REDEMPTION_TTL_MINUTES } from './redemptions.constants';
import { generateRedemptionCode } from './redemption-code.util';
import { RedemptionNotFoundException } from './exceptions/redemption-not-found.exception';
import { RedemptionExpiredException } from './exceptions/redemption-expired.exception';
import { RedemptionLimitReachedException } from './exceptions/redemption-limit-reached.exception';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { SAFE_REDEMPTION_SELECT, SafeRedemption } from './safe-redemption.util';
import { PartnerRedemptionConfirmResponseDto } from './dto/partner-redemption-confirm-response.schema';
import { extractFirstName } from './partner-redemption.util';

const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';

/**
 * Criar um Redemption NUNCA move coins (regra 8 do CLAUDE.md) — só o `confirm()` debita, via
 * LedgerService.post(). As 3 garantias inegociáveis (ver plano da Sessão 17): reuso de
 * confirmação não debita 2x (idempotencyKey determinística `redemption:${id}`, mecanismo já
 * pronto do LedgerService), saldo checado atomicamente na confirmação via o optimistic lock
 * que já existe na wallet (post() chamado SEM tx, pra manter o retry automático do próprio
 * LedgerService em conflito de versão), e só o parceiro dono confirma (checado antes de
 * qualquer mudança de estado, 404 se não bate — nunca revela resgate de outro parceiro).
 */
@Injectable()
export class RedemptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly walletsService: WalletsService,
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
      select: { id: true, partnerId: true, costInCoins: true, perUserLimit: true },
    });
    if (!offer) {
      throw new OfferNotFoundException();
    }

    if (offer.perUserLimit !== null) {
      const count = await this.prisma.redemption.count({
        where: { membershipId, offerId: offer.id, status: { in: ['PENDING', 'CONFIRMED'] } },
      });
      if (count >= offer.perUserLimit) {
        throw new RedemptionLimitReachedException();
      }
    }

    const expiresAt = new Date(Date.now() + REDEMPTION_TTL_MINUTES * 60 * 1000);

    for (let attempt = 0; attempt < REDEMPTION_CODE_GENERATION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.redemption.create({
          data: {
            membershipId,
            walletId,
            partnerId: offer.partnerId,
            offerId: offer.id,
            amount: offer.costInCoins,
            code: generateRedemptionCode(),
            qrPayload: randomBytes(32).toString('hex'),
            idempotencyKey,
            expiresAt,
          },
          select: SAFE_REDEMPTION_SELECT,
        });
      } catch (error) {
        if (this.isUniqueViolationOn(error, 'idempotencyKey')) {
          const raced = await this.prisma.redemption.findUniqueOrThrow({
            where: { idempotencyKey },
            select: SAFE_REDEMPTION_SELECT,
          });
          this.assertIdempotentReplayMatches(raced, input, idempotencyKey);
          return raced;
        }
        if (this.isUniqueViolationOn(error, 'code') || this.isUniqueViolationOn(error, 'qrPayload')) {
          continue;
        }
        throw error;
      }
    }

    throw new Error('Não foi possível gerar um código de resgate único após múltiplas tentativas.');
  }

  async getById(userId: string, id: string): Promise<SafeRedemption> {
    const redemption = await this.prisma.redemption.findUnique({
      where: { id },
      include: { membership: { select: { userId: true } } },
    });

    if (!redemption || redemption.membership.userId !== userId) {
      throw new RedemptionNotFoundException();
    }

    if (redemption.status === 'PENDING' && redemption.expiresAt < new Date()) {
      await this.prisma.redemption.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
    }

    return this.prisma.redemption.findUniqueOrThrow({ where: { id }, select: SAFE_REDEMPTION_SELECT });
  }

  async confirm(partnerId: string, input: ConfirmRedemptionInput): Promise<SafeRedemption> {
    const redemption = input.code
      ? await this.prisma.redemption.findUnique({ where: { code: input.code } })
      : await this.prisma.redemption.findUnique({ where: { qrPayload: input.qrPayload as string } });

    if (!redemption || redemption.partnerId !== partnerId) {
      throw new RedemptionNotFoundException();
    }

    const idempotencyKey = `redemption:${redemption.id}`;

    // Self-healing: se o débito já aconteceu (ex: crash entre o post() e o updateMany() de
    // status numa tentativa anterior), reconcilia o status sem debitar de novo — cobre esse
    // caso independente do que `status` diz agora (mesmo se ficou errado como EXPIRED).
    const existingEntry = await this.prisma.ledgerEntry.findUnique({ where: { idempotencyKey } });
    if (existingEntry) {
      await this.prisma.redemption.updateMany({
        where: { id: redemption.id, status: { not: 'CONFIRMED' } },
        data: { status: 'CONFIRMED', confirmedAt: existingEntry.createdAt, ledgerEntryId: existingEntry.id },
      });
      return this.prisma.redemption.findUniqueOrThrow({ where: { id: redemption.id }, select: SAFE_REDEMPTION_SELECT });
    }

    const now = new Date();
    if (redemption.status !== 'PENDING' || redemption.expiresAt < now) {
      if (redemption.status === 'PENDING') {
        await this.prisma.redemption.updateMany({
          where: { id: redemption.id, status: 'PENDING' },
          data: { status: 'EXPIRED' },
        });
      }
      throw new RedemptionExpiredException();
    }

    const offer = redemption.offerId
      ? await this.prisma.offer.findUnique({ where: { id: redemption.offerId }, select: { title: true, perUserLimit: true } })
      : null;

    if (offer?.perUserLimit != null) {
      const confirmedCount = await this.prisma.redemption.count({
        where: { membershipId: redemption.membershipId, offerId: redemption.offerId, status: 'CONFIRMED' },
      });
      if (confirmedCount >= offer.perUserLimit) {
        throw new RedemptionLimitReachedException();
      }
    }

    const partner = await this.prisma.partner.findUniqueOrThrow({
      where: { id: redemption.partnerId },
      select: { name: true },
    });

    // Sem `tx`: LedgerService gerencia a própria transação + retry em conflito de optimistic
    // lock (ver plano da Sessão 17 — passar tx aqui perderia esse retry automático).
    const entry = await this.ledgerService.post({
      walletId: redemption.walletId,
      type: 'DEBIT',
      amount: redemption.amount,
      referenceType: 'REDEMPTION',
      referenceId: redemption.id,
      description: `Resgate — ${offer?.title ?? partner.name}`,
      idempotencyKey,
    });

    await this.prisma.redemption.updateMany({
      where: { id: redemption.id, status: 'PENDING' },
      data: { status: 'CONFIRMED', confirmedAt: now, ledgerEntryId: entry.id },
    });

    return this.prisma.redemption.findUniqueOrThrow({ where: { id: redemption.id }, select: SAFE_REDEMPTION_SELECT });
  }

  /**
   * Wrapper de confirm() só pra moldar a resposta que o portal do parceiro recebe — a
   * lógica de débito em si (as 3 garantias inegociáveis) fica inteiramente em confirm(),
   * intocada. Busca offerTitle e o primeiro nome do cliente à parte porque SAFE_REDEMPTION_SELECT
   * nunca inclui membershipId (não faz sentido sair em resposta HTTP), então não dá pra
   * chegar no User a partir do retorno de confirm().
   */
  async confirmForPartner(partnerId: string, input: ConfirmRedemptionInput): Promise<PartnerRedemptionConfirmResponseDto> {
    const redemption = await this.confirm(partnerId, input);

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
      status: redemption.status,
      confirmedAt: redemption.confirmedAt ? redemption.confirmedAt.toISOString() : null,
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
