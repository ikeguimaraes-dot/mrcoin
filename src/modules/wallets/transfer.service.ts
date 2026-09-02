import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Transfer } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { InsufficientBalanceException } from '../ledger/exceptions/insufficient-balance.exception';
import { TransactionPinService } from '../users/transaction-pin.service';
import { WalletsService } from './wallets.service';
import { IdempotencyConflictException } from '../ledger/exceptions/idempotency-conflict.exception';
import { RecipientNotFoundException } from './exceptions/recipient-not-found.exception';
import { SelfTransferException } from './exceptions/self-transfer.exception';
import { TransferDailyLimitExceededException } from './exceptions/transfer-daily-limit-exceeded.exception';
import { CreateTransferInput } from './dto/create-transfer.schema';
import {
  RECIPIENT_SEARCH_MAX_RESULTS,
  TRANSFER_DAILY_LIMIT_COINS,
  TRANSFER_DAILY_LIMIT_WINDOW_HOURS,
} from './transfer.constants';

export interface RecipientListItem {
  membershipId: string;
  name: string;
}

export interface TransferResult {
  id: string;
  amount: number;
  recipientMembershipId: string;
  recipientName: string;
  createdAt: Date;
}

/**
 * Transferência entre membros da MESMA organização — produto validado juridicamente (ver
 * CLAUDE.md "O que NÃO fazer"). Mesma ordem de validação já estabelecida em
 * RedemptionsService.create(): tudo que é checagem "grátis" primeiro (destinatário,
 * auto-transferência, saldo, limite diário), PIN por último — não faz sentido pedir PIN de
 * uma transferência que já ia falhar por outro motivo.
 */
@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    private readonly walletsService: WalletsService,
    private readonly transactionPinService: TransactionPinService,
  ) {}

  /** Busca parcial por nome, só membros ACTIVE da mesma org, nunca o próprio remetente. */
  async searchRecipients(userId: string, organizationId: string, query: string): Promise<RecipientListItem[]> {
    const { membershipId: senderMembershipId } = await this.walletsService.resolveWalletId(userId, organizationId);

    const memberships = await this.prisma.membership.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        id: { not: senderMembershipId },
        user: { name: { contains: query, mode: 'insensitive' } },
      },
      select: { id: true, user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } },
      take: RECIPIENT_SEARCH_MAX_RESULTS,
    });

    return memberships.map((membership) => ({ membershipId: membership.id, name: membership.user.name }));
  }

  async create(userId: string, input: CreateTransferInput, idempotencyKey: string): Promise<TransferResult> {
    const existing = await this.prisma.transfer.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.toMembershipId !== input.recipientMembershipId || existing.amount !== input.amount) {
        throw new IdempotencyConflictException(idempotencyKey, { transferId: existing.id });
      }
      return this.toResult(existing);
    }

    const { membershipId: senderMembershipId, walletId: senderWalletId } = await this.walletsService.resolveWalletId(
      userId,
      input.organizationId,
    );

    if (input.recipientMembershipId === senderMembershipId) {
      throw new SelfTransferException();
    }

    const recipientMembership = await this.prisma.membership.findFirst({
      where: { id: input.recipientMembershipId, organizationId: input.organizationId, status: 'ACTIVE' },
      include: { wallet: true, user: { select: { name: true } } },
    });
    if (!recipientMembership || !recipientMembership.wallet) {
      throw new RecipientNotFoundException();
    }

    const { cachedBalance } = await this.ledgerService.getBalance(senderWalletId);
    if (cachedBalance < input.amount) {
      throw new InsufficientBalanceException(senderWalletId, input.amount, cachedBalance);
    }

    const windowStart = new Date(Date.now() - TRANSFER_DAILY_LIMIT_WINDOW_HOURS * 60 * 60 * 1000);
    const sentTodayAgg = await this.prisma.transfer.aggregate({
      _sum: { amount: true },
      where: { fromMembershipId: senderMembershipId, createdAt: { gte: windowStart } },
    });
    const alreadySent = sentTodayAgg._sum.amount ?? 0;
    if (alreadySent + input.amount > TRANSFER_DAILY_LIMIT_COINS) {
      throw new TransferDailyLimitExceededException(TRANSFER_DAILY_LIMIT_COINS, alreadySent, input.amount);
    }

    await this.transactionPinService.verifyPin(userId, input.transactionPin);

    const sender = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true } });

    // transferId determinístico a partir da Idempotency-Key do cliente — mesmo raciocínio
    // já usado em RedemptionsService.create(): duas requisições concorrentes (ou um retry)
    // com a mesma chave calculam o mesmo id, então uma corrida bate no guard de idempotência
    // do LedgerService (referenceId divergente) em vez de reconciliar.
    const transferId = createHash('sha256').update(`transfer:${idempotencyKey}`).digest('hex');

    const { debitEntry, creditEntry } = await this.ledgerService.transferBetweenWallets({
      fromWalletId: senderWalletId,
      toWalletId: recipientMembership.wallet.id,
      amount: input.amount,
      referenceId: transferId,
      debitDescription: `Transferência enviada para ${recipientMembership.user.name}`,
      creditDescription: `Transferência recebida de ${sender.name}`,
      debitIdempotencyKey: `transfer-debit:${idempotencyKey}`,
      creditIdempotencyKey: `transfer-credit:${idempotencyKey}`,
    });

    // upsert: se o processo já tivesse criado essa linha numa tentativa anterior (crash entre
    // o débito/crédito e este insert), não duplica nem falha — mesmo padrão de
    // RedemptionsService pro crash entre debitar e criar a linha.
    const transfer = await this.prisma.transfer.upsert({
      where: { id: transferId },
      create: {
        id: transferId,
        fromMembershipId: senderMembershipId,
        toMembershipId: recipientMembership.id,
        amount: input.amount,
        idempotencyKey,
        debitLedgerEntryId: debitEntry.id,
        creditLedgerEntryId: creditEntry.id,
      },
      update: {},
    });

    return {
      id: transfer.id,
      amount: transfer.amount,
      recipientMembershipId: recipientMembership.id,
      recipientName: recipientMembership.user.name,
      createdAt: transfer.createdAt,
    };
  }

  private async toResult(transfer: Transfer): Promise<TransferResult> {
    const recipient = await this.prisma.membership.findUniqueOrThrow({
      where: { id: transfer.toMembershipId },
      select: { user: { select: { name: true } } },
    });

    return {
      id: transfer.id,
      amount: transfer.amount,
      recipientMembershipId: transfer.toMembershipId,
      recipientName: recipient.user.name,
      createdAt: transfer.createdAt,
    };
  }
}
