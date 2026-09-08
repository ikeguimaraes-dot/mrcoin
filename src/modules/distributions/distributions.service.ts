import { HttpException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { DistributionItem, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { NOTIFICATION_PORT, NotificationPort } from '../../common/notifications/notification.port';
import { LedgerService } from '../ledger/ledger.service';
import { SAFE_LEDGER_ENTRY_SELECT, SafeLedgerEntry, toSafeLedgerEntry } from '../ledger/safe-ledger-entry.util';
import { CreateDistributionInput } from './dto/create-distribution.schema';
import { ListDistributionsQuery } from './dto/list-distributions.schema';
import { InsufficientCoinStockException } from './exceptions/insufficient-coin-stock.exception';
import { IdempotencyConflictException } from './exceptions/idempotency-conflict.exception';
import { DistributionNotPendingException } from './exceptions/distribution-not-pending.exception';
import {
  DISTRIBUTION_ITEM_BATCH_SIZE,
  DISTRIBUTION_LIST_PAGE_SIZE,
  JOB_PROCESS_DISTRIBUTION,
  QUEUE_PROCESS_DISTRIBUTION,
} from './distributions.constants';
import { ensureUserMembershipWallet } from './ensure-user-membership-wallet.util';
import { executeFifoPlan, planFifoOrThrow } from './fifo-batch-consumption.util';
import { listDistributionItems } from './list-distribution-items.util';
import { SAFE_DISTRIBUTION_ITEM_SELECT, SafeDistributionItem } from './safe-distribution-item.util';
import { SAFE_DISTRIBUTION_SELECT, SafeDistribution } from './safe-distribution.util';

interface ProcessDistributionJobData {
  distributionId: string;
}

const DISTRIBUTION_DESCRIPTION = 'Distribuição de coins';

type ExistingDistribution = SafeDistribution & {
  items: (SafeDistributionItem & {
    membership: { user: { cpfHash: string } } | null;
    ledgerEntries: SafeLedgerEntry[];
  })[];
};

export interface DistributeIndividualResult {
  distribution: SafeDistribution;
  item: SafeDistributionItem & { ledgerEntries: SafeLedgerEntry[] };
}

/**
 * Distribuição individual: credita coins pra um CPF consumindo lotes em ordem FIFO (por
 * `expiresAt`) até completar o valor pedido — fraciona entre quantos lotes forem
 * necessários, um LedgerEntry por lote consumido (regra 1 do CLAUDE.md: toda movimentação
 * passa por LedgerService.post()). A idempotência é do PEDIDO inteiro, não de cada entry:
 * `Distribution.idempotencyKey` é o único ponto checado pra replay — se encontrado, a
 * resposta já persistida é devolvida tal e qual, sem recalcular nem retocar nenhum lote.
 *
 * O planejamento/execução FIFO (`planFifoOrThrow`/`executeFifoPlan`, em
 * `fifo-batch-consumption.util.ts`) é compartilhado com a distribuição em massa via CSV
 * (`processBulkDistribution`) e, fora deste módulo, com o crédito de conclusão de curso
 * (`CourseCreditService`) — mesma mecânica de sempre, um lote de cada vez.
 */
@Injectable()
export class DistributionsService {
  private readonly logger = new Logger(DistributionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
    @Inject(NOTIFICATION_PORT) private readonly notificationPort: NotificationPort,
    @InjectQueue(QUEUE_PROCESS_DISTRIBUTION) private readonly processDistributionQueue: Queue<ProcessDistributionJobData>,
  ) {}

  async distributeIndividual(
    organizationId: string,
    adminUserId: string,
    input: CreateDistributionInput,
    idempotencyKey: string,
  ): Promise<DistributeIndividualResult> {
    const existing = await this.prisma.distribution.findUnique({
      where: { idempotencyKey },
      select: {
        ...SAFE_DISTRIBUTION_SELECT,
        items: {
          select: {
            ...SAFE_DISTRIBUTION_ITEM_SELECT,
            membership: { select: { user: { select: { cpfHash: true } } } },
            ledgerEntries: { select: SAFE_LEDGER_ENTRY_SELECT },
          },
        },
      },
    });

    if (existing) {
      return this.replayExisting(existing, organizationId, input, idempotencyKey);
    }

    const cpfHash = hashCpf(input.cpf);

    const { distribution, item, userId } = await this.prisma.$transaction(async (tx) => {
      const plan = await planFifoOrThrow(tx, organizationId, input.amount);

      const { userId: ensuredUserId, membershipId, walletId } = await ensureUserMembershipWallet(tx, {
        cpfEncrypted: encryptCpf(input.cpf),
        cpfHash,
        name: input.name,
        organizationId,
        membershipType: input.membershipType,
        externalRef: input.externalRef,
      });

      const createdDistribution = await tx.distribution.create({
        data: {
          organizationId,
          adminUserId,
          reason: input.reason,
          totalItems: 1,
          successItems: 1,
          failedItems: 0,
          status: 'COMPLETED',
          idempotencyKey,
        },
        select: SAFE_DISTRIBUTION_SELECT,
      });

      const createdItem = await tx.distributionItem.create({
        data: {
          distributionId: createdDistribution.id,
          membershipId,
          amount: input.amount,
          status: 'OK',
        },
        select: SAFE_DISTRIBUTION_ITEM_SELECT,
      });

      const description = input.reason ? `${DISTRIBUTION_DESCRIPTION} — ${input.reason}` : DISTRIBUTION_DESCRIPTION;
      const ledgerEntries = await executeFifoPlan(tx, this.ledgerService, plan, organizationId, {
        walletId,
        referenceType: 'DISTRIBUTION',
        referenceId: createdItem.id,
        description,
        distributionItemId: createdItem.id,
        idempotencyKeyPrefix: `distribution:${idempotencyKey}`,
      });

      return {
        distribution: createdDistribution,
        item: { ...createdItem, ledgerEntries: ledgerEntries.map(toSafeLedgerEntry) },
        userId: ensuredUserId,
      };
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

    // Nunca devolver `items`/`membership` crus aqui: a query busca membership.user.cpfHash só
    // pra validar o replay (paramsMatch acima) — sem esse strip, a resposta vazaria User inteiro
    // (cpfEncrypted, cpfHash, phone, email) e o Membership, ao contrário do caminho feliz acima.
    const { items: _items, ...distribution } = existing;
    const { membership: _membership, ...safeItem } = item;

    return { distribution, item: safeItem };
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

  /** Transição atômica PENDING → PROCESSING — `count === 0` cobre tanto "já confirmada"
   * quanto "não existe nessa org", então só depois disso vale a pena buscar qual dos dois
   * casos é, pra devolver o erro certo. Só enfileira o job depois da transição confirmada. */
  async confirmBulkDistribution(organizationId: string, distributionId: string): Promise<SafeDistribution> {
    const transitioned = await this.prisma.distribution.updateMany({
      where: { id: distributionId, organizationId, status: 'PENDING' },
      data: { status: 'PROCESSING' },
    });

    if (transitioned.count === 0) {
      const existing = await this.prisma.distribution.findFirst({ where: { id: distributionId, organizationId } });
      if (!existing) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distribuição não encontrada.' });
      }
      throw new DistributionNotPendingException(distributionId, existing.status);
    }

    await this.processDistributionQueue.add(JOB_PROCESS_DISTRIBUTION, { distributionId });

    return this.prisma.distribution.findUniqueOrThrow({
      where: { id: distributionId },
      select: SAFE_DISTRIBUTION_SELECT,
    });
  }

  async getDistribution(organizationId: string, distributionId: string): Promise<SafeDistribution> {
    const distribution = await this.prisma.distribution.findFirst({
      where: { id: distributionId, organizationId },
      select: SAFE_DISTRIBUTION_SELECT,
    });

    if (!distribution) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Distribuição não encontrada.' });
    }

    return distribution;
  }

  async listItems(distributionId: string, cursor: string | undefined, limit: number | undefined) {
    return listDistributionItems(this.prisma, distributionId, cursor, limit);
  }

  async listDistributions(
    organizationId: string,
    query: ListDistributionsQuery,
  ): Promise<{ items: SafeDistribution[]; nextCursor: string | null }> {
    const limit = query.limit ?? DISTRIBUTION_LIST_PAGE_SIZE;

    const items = await this.prisma.distribution.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SAFE_DISTRIBUTION_SELECT,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }

  /** Processador do job BullMQ — pagina os itens PENDING em chunks e processa cada chunk em
   * paralelo (Promise.all). Cada item é sua própria transação independente: uma falha numa
   * linha não afeta as outras (regra explícita do pedido), e o loop volta a buscar PENDING
   * a cada iteração — se o worker cair no meio e o BullMQ reenviar o job, ele simplesmente
   * retoma do que ainda estiver PENDING (idempotente por construção). */
  async processBulkDistribution(distributionId: string): Promise<void> {
    const distribution = await this.prisma.distribution.findUniqueOrThrow({ where: { id: distributionId } });

    for (;;) {
      const pendingItems = await this.prisma.distributionItem.findMany({
        where: { distributionId, status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: DISTRIBUTION_ITEM_BATCH_SIZE,
      });

      if (pendingItems.length === 0) {
        break;
      }

      await Promise.all(pendingItems.map((item) => this.processDistributionItem(distribution.organizationId, item)));
    }

    const finalState = await this.prisma.distribution.findUniqueOrThrow({ where: { id: distributionId } });
    await this.prisma.distribution.update({
      where: { id: distributionId },
      data: { status: finalState.failedItems > 0 ? 'COMPLETED_WITH_ERRORS' : 'COMPLETED' },
    });
  }

  /** Processa uma linha: cria/reaproveita User (PENDING_CLAIM se novo, mesma regra da
   * distribuição individual) + Membership + Wallet, credita via FIFO e marca a linha OK —
   * tudo numa transação própria, então qualquer falha desfaz só essa linha. Ao suceder,
   * zera cpfHash/cpfEncrypted da linha (minimização — User já é a fonte canônica a partir
   * daí). Ao falhar, marca FAILED com o motivo e mantém o CPF (única forma de identificar
   * depois qual CPF era essa linha).
   *
   * `maxWait`/`timeout` maiores que o default do Prisma (2s/5s): com um chunk inteiro
   * (`DISTRIBUTION_ITEM_BATCH_SIZE`) processando em paralelo, muitas transações competem
   * pelo mesmo pool de conexões e pela mesma linha de `CoinBatch` — sem folga, o Prisma
   * mata a transação com "Unable to start a transaction in the given time" (P2028) antes
   * dela sequer começar, o que reprovaria linhas válidas só por estarem no fim da fila.
   * Retry limitado (mesmo espírito do MAX_RETRIES do LedgerService pra optimistic lock)
   * cobre tanto esse timeout quanto InsufficientCoinStockException — qualquer outro erro
   * falha a linha na hora, sem repetir. */
  private async processDistributionItem(organizationId: string, item: DistributionItem): Promise<void> {
    const maxAttempts = 3;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const userId = await this.prisma.$transaction(
          async (tx) => {
            if (!item.cpfHash || !item.cpfEncrypted || !item.name || !item.membershipType) {
              throw new Error('Linha PENDING sem dados de CPF completos — estado inconsistente.');
            }

          const plan = await planFifoOrThrow(tx, organizationId, item.amount);

          const { userId: ensuredUserId, membershipId, walletId } = await ensureUserMembershipWallet(tx, {
            cpfEncrypted: item.cpfEncrypted,
            cpfHash: item.cpfHash,
            name: item.name,
            organizationId,
            membershipType: item.membershipType,
            externalRef: item.externalRef,
          });

          await executeFifoPlan(tx, this.ledgerService, plan, organizationId, {
            walletId,
            referenceType: 'DISTRIBUTION',
            referenceId: item.id,
            description: DISTRIBUTION_DESCRIPTION,
            distributionItemId: item.id,
            idempotencyKeyPrefix: `distribution-item:${item.id}`,
          });

          await tx.distributionItem.update({
            where: { id: item.id },
            data: { status: 'OK', membershipId, cpfHash: null, cpfEncrypted: null },
          });

          return ensuredUserId;
          },
          { maxWait: 15_000, timeout: 15_000 },
        );

        await this.prisma.distribution.update({
          where: { id: item.distributionId },
          data: { successItems: { increment: 1 } },
        });

        await this.notifyBestEffort(userId, item.amount);
        return;
      } catch (error) {
        lastError = error;

        if (!isRetryableProcessingError(error) || attempt === maxAttempts) {
          break;
        }
      }
    }

    const message = extractErrorMessage(lastError);

    await this.prisma.distributionItem.update({
      where: { id: item.id },
      data: { status: 'FAILED', errorReason: message },
    });

    await this.prisma.distribution.update({
      where: { id: item.distributionId },
      data: { failedItems: { increment: 1 } },
    });

    this.logger.warn(`Linha ${item.id} da distribuição ${item.distributionId} falhou: ${message}`);
  }
}

const PRISMA_TRANSACTION_TIMEOUT_ERROR_CODE = 'P2028';

/** Erros que valem retry em processDistributionItem: saldo insuficiente (pode ter sido
 * corrida momentânea) e timeout de aquisição de transação do Prisma (fila de conexão sob
 * alta concorrência — ver comentário de processDistributionItem). Qualquer outro erro é
 * definitivo, sem repetir. */
function isRetryableProcessingError(error: unknown): boolean {
  if (error instanceof InsufficientCoinStockException) {
    return true;
  }
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === PRISMA_TRANSACTION_TIMEOUT_ERROR_CODE;
}

/** Extrai uma mensagem legível tanto de exceptions do próprio módulo ({code, message,
 * details}) quanto de erros genéricos — usada como errorReason de uma linha FAILED. */
function extractErrorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null && 'message' in response) {
      return String(response.message);
    }
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Erro desconhecido';
}
