import { CoinBatch, LedgerEntry, LedgerReferenceType, Prisma } from '@prisma/client';
import { LedgerService } from '../ledger/ledger.service';
import { InsufficientCoinStockException } from './exceptions/insufficient-coin-stock.exception';

type TransactionClient = Prisma.TransactionClient;

export interface BatchConsumptionStep {
  batch: CoinBatch;
  amount: number;
}

export interface ExecuteFifoPlanParams {
  walletId: string;
  referenceType: LedgerReferenceType;
  referenceId: string;
  description: string;
  /** Só distribuição preenche isto — outros consumidores (ex.: crédito de curso) passam null. */
  distributionItemId?: string | null;
  idempotencyKeyPrefix: string;
}

/**
 * Consumo FIFO de estoque de CoinBatch por organização — extraído de DistributionsService
 * (onde nasceu) porque agora tem um segundo consumidor (crédito de conclusão de curso,
 * CourseCreditService) com exatamente a mesma necessidade: consumir N coins dos lotes PAID
 * não expirados, do que vence primeiro pro que vence depois, um LedgerEntry por lote tocado,
 * decremento sempre guardado por optimistic lock (regra 4 do CLAUDE.md).
 */

/** Monta o plano FIFO: tira o mínimo entre "o que resta pedir" e "o que o lote tem" de
 * cada lote, na ordem dada (já vem ordenada por expiresAt asc), até fechar o valor total.
 * Retorna `null` se a soma de todos os candidatos não cobre o valor pedido. */
export function planFifoConsumption(candidates: CoinBatch[], amount: number): BatchConsumptionStep[] | null {
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

/** Busca os lotes válidos e monta o plano de consumo FIFO, ou lança
 * InsufficientCoinStockException — chamar ANTES de qualquer escrita que dependa do plano dar
 * certo, pra falhar rápido sem escrita desnecessária (tudo dentro da mesma transação de
 * qualquer forma). */
export async function planFifoOrThrow(
  tx: TransactionClient,
  organizationId: string,
  amount: number,
): Promise<BatchConsumptionStep[]> {
  const candidates = await tx.coinBatch.findMany({
    where: {
      organizationId,
      status: 'PAID',
      remainingCoins: { gt: 0 },
      expiresAt: { gt: new Date() },
    },
    orderBy: { expiresAt: 'asc' },
  });

  const plan = planFifoConsumption(candidates, amount);
  if (!plan) {
    const totalAvailable = candidates.reduce((sum, batch) => sum + batch.remainingCoins, 0);
    throw new InsufficientCoinStockException(organizationId, amount, totalAvailable);
  }

  return plan;
}

/** Executa um plano já montado: decrementa cada lote com guarda otimista e posta um
 * LedgerEntry por lote via LedgerService.post() (regra 1 do CLAUDE.md). */
export async function executeFifoPlan(
  tx: TransactionClient,
  ledgerService: LedgerService,
  plan: BatchConsumptionStep[],
  organizationId: string,
  params: ExecuteFifoPlanParams,
): Promise<LedgerEntry[]> {
  const ledgerEntries: LedgerEntry[] = [];

  for (const step of plan) {
    const decremented = await tx.coinBatch.updateMany({
      where: { id: step.batch.id, remainingCoins: { gte: step.amount } },
      data: { remainingCoins: { decrement: step.amount } },
    });

    if (decremented.count === 0) {
      // Corrida: outro consumo (distribuição, crédito de curso, roleta) tocou esse lote entre
      // o planejamento e aqui.
      throw new InsufficientCoinStockException(organizationId, step.amount, step.batch.remainingCoins);
    }

    const entry = await ledgerService.post(
      {
        walletId: params.walletId,
        type: 'CREDIT',
        amount: step.amount,
        referenceType: params.referenceType,
        referenceId: params.referenceId,
        description: params.description,
        batchId: step.batch.id,
        distributionItemId: params.distributionItemId ?? undefined,
        idempotencyKey: `${params.idempotencyKeyPrefix}:${step.batch.id}`,
      },
      tx,
    );

    ledgerEntries.push(entry);
  }

  return ledgerEntries;
}
