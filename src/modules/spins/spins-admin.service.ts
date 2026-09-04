import { Injectable } from '@nestjs/common';
import { CoinBatch, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { ensureUserMembershipWallet } from '../distributions/ensure-user-membership-wallet.util';
import { InsufficientCoinStockException } from '../distributions/exceptions/insufficient-coin-stock.exception';
import { IdempotencyConflictException } from '../distributions/exceptions/idempotency-conflict.exception';
import { GrantSpinsInput } from './dto/grant-spins.schema';
import { SPIN_RESERVED_AMOUNT } from './spins.constants';

type TransactionClient = Prisma.TransactionClient;

interface SpinReservationStep {
  batchId: string;
  batchExpiresAt: Date;
}

export interface GrantedSpinItem {
  id: string;
  expiresAt: Date;
}

export interface GrantSpinsResult {
  id: string;
  organizationId: string;
  membershipId: string;
  quantity: number;
  reason: string | null;
  createdAt: Date;
  spins: GrantedSpinItem[];
}

type ExistingSpinGrant = Prisma.SpinGrantGetPayload<{
  include: { spins: { select: { id: true; expiresAt: true } }; membership: { select: { user: { select: { cpfHash: true } } } } };
}>;

/**
 * Concessão de giros de roleta — mesmo padrão de auth/idempotência de DistributionsService,
 * mas em vez de creditar um valor decidido pelo admin, RESERVA estoque pro pior caso (1.000
 * coins por giro) e deixa o valor de verdade pra ser sorteado em SpinsService.redeem(). A
 * reserva (decremento real de CoinBatch.remainingCoins, com o mesmo guard otimista da
 * distribuição) é o que garante que todo giro concedido pode ser resgatado depois — só uma
 * checagem sem decremento real não impede duas concessões concorrentes de prometer o mesmo
 * estoque duas vezes (ver plano da feature).
 */
@Injectable()
export class SpinsAdminService {
  constructor(private readonly prisma: PrismaService) {}

  async grant(
    organizationId: string,
    adminUserId: string,
    input: GrantSpinsInput,
    idempotencyKey: string,
  ): Promise<GrantSpinsResult> {
    const existing = await this.prisma.spinGrant.findUnique({
      where: { idempotencyKey },
      include: {
        spins: { select: { id: true, expiresAt: true } },
        membership: { select: { user: { select: { cpfHash: true } } } },
      },
    });

    if (existing) {
      return this.replayExisting(existing, organizationId, input, idempotencyKey);
    }

    const cpfHash = hashCpf(input.cpf);

    const result = await this.prisma.$transaction(async (tx) => {
      const { membershipId } = await ensureUserMembershipWallet(tx, {
        cpfEncrypted: encryptCpf(input.cpf),
        cpfHash,
        name: input.name,
        organizationId,
        membershipType: input.membershipType,
        externalRef: input.externalRef,
      });

      const plan = await this.planSpinReservationsOrThrow(tx, organizationId, input.quantity);

      const spinGrant = await tx.spinGrant.create({
        data: {
          organizationId,
          adminUserId,
          membershipId,
          quantity: input.quantity,
          reason: input.reason,
          idempotencyKey,
        },
      });

      const spins = await this.executeSpinReservations(tx, plan, organizationId, membershipId, spinGrant.id);

      return { spinGrant, spins };
    });

    return {
      id: result.spinGrant.id,
      organizationId: result.spinGrant.organizationId,
      membershipId: result.spinGrant.membershipId,
      quantity: result.spinGrant.quantity,
      reason: result.spinGrant.reason,
      createdAt: result.spinGrant.createdAt,
      spins: result.spins.map((spin) => ({ id: spin.id, expiresAt: spin.expiresAt })),
    };
  }

  /** Monta o plano de reserva: pra cada uma das `quantity` unidades, o próximo lote (FIFO por
   * expiresAt) com espaço pra mais um bloco de SPIN_RESERVED_AMOUNT — um único lote pode
   * financiar vários giros da mesma concessão se tiver espaço. Lança
   * InsufficientCoinStockException se não der pra completar as `quantity` reservas com lotes
   * de 1.000+ sozinhos (ver plano — decisão de não fracionar a reserva de um giro entre
   * lotes). Puro dry-run: não escreve nada, só simula em memória sobre o snapshot lido aqui —
   * a garantia de verdade vem do guard otimista em executeSpinReservations. */
  private async planSpinReservationsOrThrow(
    tx: TransactionClient,
    organizationId: string,
    quantity: number,
  ): Promise<SpinReservationStep[]> {
    const candidates = await tx.coinBatch.findMany({
      where: {
        organizationId,
        status: 'PAID',
        remainingCoins: { gte: SPIN_RESERVED_AMOUNT },
        expiresAt: { gt: new Date() },
      },
      orderBy: { expiresAt: 'asc' },
    });

    const plan: SpinReservationStep[] = [];
    const localRemaining = new Map<string, number>(candidates.map((batch) => [batch.id, batch.remainingCoins]));

    for (const batch of candidates) {
      while (plan.length < quantity && (localRemaining.get(batch.id) ?? 0) >= SPIN_RESERVED_AMOUNT) {
        plan.push({ batchId: batch.id, batchExpiresAt: batch.expiresAt });
        localRemaining.set(batch.id, (localRemaining.get(batch.id) ?? 0) - SPIN_RESERVED_AMOUNT);
      }
      if (plan.length >= quantity) break;
    }

    if (plan.length < quantity) {
      const totalAvailable = this.totalAvailableForSpins(candidates);
      throw new InsufficientCoinStockException(organizationId, quantity * SPIN_RESERVED_AMOUNT, totalAvailable);
    }

    return plan;
  }

  /** Executa o plano: decrementa cada lote com guard otimista (`count === 0` = corrida —
   * outra concessão/distribuição consumiu o lote entre o planejamento e aqui) e cria a linha
   * Spin correspondente. */
  private async executeSpinReservations(
    tx: TransactionClient,
    plan: SpinReservationStep[],
    organizationId: string,
    membershipId: string,
    spinGrantId: string,
  ) {
    const spins = [];

    for (const step of plan) {
      const decremented = await tx.coinBatch.updateMany({
        where: { id: step.batchId, remainingCoins: { gte: SPIN_RESERVED_AMOUNT } },
        data: { remainingCoins: { decrement: SPIN_RESERVED_AMOUNT } },
      });

      if (decremented.count === 0) {
        throw new InsufficientCoinStockException(organizationId, SPIN_RESERVED_AMOUNT, 0);
      }

      const spin = await tx.spin.create({
        data: {
          spinGrantId,
          organizationId,
          membershipId,
          reservedBatchId: step.batchId,
          expiresAt: step.batchExpiresAt,
        },
      });

      spins.push(spin);
    }

    return spins;
  }

  private totalAvailableForSpins(candidates: CoinBatch[]): number {
    return candidates.reduce((sum, batch) => sum + Math.floor(batch.remainingCoins / SPIN_RESERVED_AMOUNT) * SPIN_RESERVED_AMOUNT, 0);
  }

  private replayExisting(
    existing: ExistingSpinGrant,
    organizationId: string,
    input: GrantSpinsInput,
    idempotencyKey: string,
  ): GrantSpinsResult {
    const cpfHash = hashCpf(input.cpf);
    const paramsMatch =
      existing.organizationId === organizationId &&
      existing.quantity === input.quantity &&
      existing.membership.user.cpfHash === cpfHash;

    if (!paramsMatch) {
      throw new IdempotencyConflictException(idempotencyKey, { spinGrantId: existing.id });
    }

    return {
      id: existing.id,
      organizationId: existing.organizationId,
      membershipId: existing.membershipId,
      quantity: existing.quantity,
      reason: existing.reason,
      createdAt: existing.createdAt,
      spins: existing.spins.map((spin) => ({ id: spin.id, expiresAt: spin.expiresAt })),
    };
  }
}
