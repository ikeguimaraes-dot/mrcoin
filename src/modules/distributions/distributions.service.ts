import { Inject, Injectable, Logger } from '@nestjs/common';
import { CoinBatch, Distribution, DistributionItem, LedgerEntry, Membership, User } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { NOTIFICATION_PORT, NotificationPort } from '../../common/notifications/notification.port';
import { LedgerService } from '../ledger/ledger.service';
import { CreateDistributionInput } from './dto/create-distribution.schema';
import { InsufficientCoinStockException } from './exceptions/insufficient-coin-stock.exception';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';

const DISTRIBUTION_DESCRIPTION = 'Distribuição de coins';

type ExistingDistribution = Distribution & {
  items: (DistributionItem & {
    membership: (Membership & { user: User }) | null;
    ledgerEntries: LedgerEntry[];
  })[];
};

export interface DistributeIndividualResult {
  distribution: Distribution;
  item: DistributionItem & { ledgerEntries: LedgerEntry[] };
}

interface BatchConsumptionStep {
  batch: CoinBatch;
  amount: number;
}

/**
 * Distribuição individual: credita coins pra um CPF consumindo lotes em ordem FIFO (por
 * `expiresAt`) até completar o valor pedido — fraciona entre quantos lotes forem
 * necessários, um LedgerEntry por lote consumido (regra 1 do CLAUDE.md: toda movimentação
 * passa por LedgerService.post()). A idempotência é do PEDIDO inteiro, não de cada entry:
 * `Distribution.idempotencyKey` é o único ponto checado pra replay — se encontrado, a
 * resposta já persistida é devolvida tal e qual, sem recalcular nem retocar nenhum lote.
 */
@Injectable()
export class DistributionsService {
  private readonly logger = new Logger(DistributionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    @Inject(NOTIFICATION_PORT) private readonly notificationPort: NotificationPort,
  ) {}

  async distributeIndividual(
    organizationId: string,
    adminUserId: string,
    input: CreateDistributionInput,
    idempotencyKey: string,
  ): Promise<DistributeIndividualResult> {
    const existing = await this.prisma.distribution.findUnique({
      where: { idempotencyKey },
      include: { items: { include: { membership: { include: { user: true } }, ledgerEntries: true } } },
    });

    if (existing) {
      return this.replayExisting(existing, organizationId, input, idempotencyKey);
    }

    const cpfHash = hashCpf(input.cpf);

    const { distribution, item, userId } = await this.prisma.$transaction(async (tx) => {
      const candidates = await tx.coinBatch.findMany({
        where: {
          organizationId,
          status: 'PAID',
          remainingCoins: { gt: 0 },
          expiresAt: { gt: new Date() },
        },
        orderBy: { expiresAt: 'asc' },
      });

      const plan = planFifoConsumption(candidates, input.amount);
      if (!plan) {
        const totalAvailable = candidates.reduce((sum, batch) => sum + batch.remainingCoins, 0);
        throw new InsufficientCoinStockException(organizationId, input.amount, totalAvailable);
      }

      const user = await tx.user.upsert({
        where: { cpfHash },
        create: {
          cpfEncrypted: encryptCpf(input.cpf),
          cpfHash,
          name: input.name,
          status: 'PENDING_CLAIM',
        },
        update: {},
      });

      const membership = await tx.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId } },
        create: {
          userId: user.id,
          organizationId,
          type: input.membershipType,
          externalRef: input.externalRef,
        },
        update: {},
      });

      const existingWallet = await tx.wallet.findUnique({ where: { membershipId: membership.id } });
      const wallet = existingWallet ?? (await tx.wallet.create({ data: { membershipId: membership.id } }));

      const createdDistribution = await tx.distribution.create({
        data: {
          organizationId,
          adminUserId,
          totalItems: 1,
          successItems: 1,
          failedItems: 0,
          status: 'COMPLETED',
          idempotencyKey,
        },
      });

      const createdItem = await tx.distributionItem.create({
        data: {
          distributionId: createdDistribution.id,
          membershipId: membership.id,
          amount: input.amount,
          status: 'OK',
        },
      });

      const ledgerEntries: LedgerEntry[] = [];
      for (const step of plan) {
        const decremented = await tx.coinBatch.updateMany({
          where: { id: step.batch.id, remainingCoins: { gte: step.amount } },
          data: { remainingCoins: { decrement: step.amount } },
        });

        if (decremented.count === 0) {
          // Corrida: outra distribuição consumiu esse lote entre a leitura acima e aqui.
          // Toda a transação volta atrás — nada fica parcialmente aplicado, e um retry com
          // a mesma Idempotency-Key é seguro (a Distribution só existiria se tudo tivesse
          // sido reservado com sucesso).
          throw new InsufficientCoinStockException(organizationId, input.amount, step.batch.remainingCoins);
        }

        const entry = await this.ledgerService.post(
          {
            walletId: wallet.id,
            type: 'CREDIT',
            amount: step.amount,
            referenceType: 'DISTRIBUTION',
            referenceId: createdItem.id,
            description: DISTRIBUTION_DESCRIPTION,
            batchId: step.batch.id,
            distributionItemId: createdItem.id,
            idempotencyKey: `distribution:${idempotencyKey}:${step.batch.id}`,
          },
          tx,
        );

        ledgerEntries.push(entry);
      }

      return { distribution: createdDistribution, item: { ...createdItem, ledgerEntries }, userId: user.id };
    });

    await this.notifyBestEffort(userId, input.amount);

    return { distribution, item };
  }

  private replayExisting(
    existing: ExistingDistribution,
    organizationId: string,
    input: CreateDistributionInput,
    idempotencyKey: string,
  ): DistributeIndividualResult {
    const item = existing.items[0];
    const cpfHash = hashCpf(input.cpf);

    const paramsMatch =
      existing.organizationId === organizationId &&
      item?.amount === input.amount &&
      item?.membership?.user.cpfHash === cpfHash;

    if (!paramsMatch || !item) {
      throw new IdempotencyConflictException(idempotencyKey, { distributionId: existing.id });
    }

    return { distribution: existing, item };
  }

  private async notifyBestEffort(userId: string, amount: number): Promise<void> {
    try {
      await this.notificationPort.send({
        userId,
        title: 'Você recebeu coins!',
        body: `Você recebeu ${amount} coins na sua carteira.`,
      });
    } catch (error) {
      this.logger.warn(`Falha ao notificar userId=${userId}: ${String(error)}`);
    }
  }
}

/** Monta o plano FIFO: tira o mínimo entre "o que resta pedir" e "o que o lote tem" de
 * cada lote, na ordem dada (já vem ordenada por expiresAt asc), até fechar o valor total.
 * Retorna `null` se a soma de todos os candidatos não cobre o valor pedido. */
function planFifoConsumption(candidates: CoinBatch[], amount: number): BatchConsumptionStep[] | null {
  const plan: BatchConsumptionStep[] = [];
  let remaining = amount;

  for (const batch of candidates) {
    if (remaining <= 0) break;
    const take = Math.min(batch.remainingCoins, remaining);
    plan.push({ batch, amount: take });
    remaining -= take;
  }

  return remaining > 0 ? null : plan;
}
