import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { InsufficientCoinStockException } from '../distributions/exceptions/insufficient-coin-stock.exception';
import { executeFifoPlan, planFifoOrThrow } from '../distributions/fifo-batch-consumption.util';
import { COURSE_COMPLETION_REWARD_COINS } from './courses.constants';

const COURSE_COMPLETION_DESCRIPTION = 'Conclusão de curso';

/**
 * Credita o prêmio de uma CourseCompletion aprovada. Chamado de dois lugares: na hora, por
 * CoursesService logo após a aprovação (caminho feliz); e pelo job credit-course-completions,
 * pra quem ficou PENDING por falta de estoque no momento da aprovação. Nunca lança por
 * estoque insuficiente — devolve `false` e deixa PENDING, porque a aprovação em si nunca pode
 * ser perdida (ver plano da feature).
 *
 * Ordem importa pra correção sob corrida: o `updateMany` que reivindica a linha
 * (`creditStatus: PENDING` → `CREDITED`) roda ANTES de tocar no ledger, não depois. Isso não
 * é só estética — dentro de uma transação, esse UPDATE pega lock de linha no Postgres, então
 * uma segunda chamada concorrente pra MESMA CourseCompletion (o job e o caminho "na hora"
 * podem colidir) fica bloqueada até a primeira transação terminar; se a primeira falhar (ex.:
 * estoque insuficiente), a transação inteira desfaz e a linha volta pra PENDING igual estava.
 * Se tivesse feito o crédito no ledger primeiro e o `updateMany` de guarda depois (como em
 * outras transições idempotentes desta base), duas chamadas concorrentes poderiam cada uma
 * postar seu próprio LedgerEntry ANTES de qualquer uma delas checar a guarda — dobraria o
 * crédito. Aqui não dá pra usar aquele padrão porque o "movimento" (LedgerService.post) é
 * caro/falível, ao contrário de uma simples troca de status.
 */
@Injectable()
export class CourseCreditService {
  private readonly logger = new Logger(CourseCreditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  async tryCredit(courseCompletionId: string): Promise<boolean> {
    const completion = await this.prisma.courseCompletion.findUniqueOrThrow({
      where: { id: courseCompletionId },
      include: { membership: { include: { wallet: true } } },
    });

    if (completion.creditStatus === 'CREDITED') {
      return true;
    }

    if (!completion.membership.wallet) {
      this.logger.error(`CourseCompletion ${courseCompletionId} sem Wallet — estado inconsistente.`);
      return false;
    }

    const walletId = completion.membership.wallet.id;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.courseCompletion.updateMany({
          where: { id: completion.id, creditStatus: 'PENDING' },
          data: { creditStatus: 'CREDITED' },
        });

        if (claimed.count === 0) {
          // Já creditada por outra chamada concorrente (ou entre a leitura acima e aqui).
          return true;
        }

        const plan = await planFifoOrThrow(tx, completion.organizationId, COURSE_COMPLETION_REWARD_COINS);
        // Pode fracionar em mais de um LedgerEntry (lote com pouco saldo bem na hora) — por
        // isso não guardamos um ledgerEntryId único; a ligação é via referenceType+referenceId
        // (ver comentário do model no schema).
        await executeFifoPlan(tx, this.ledgerService, plan, completion.organizationId, {
          walletId,
          referenceType: 'COURSE_COMPLETION',
          referenceId: completion.id,
          description: COURSE_COMPLETION_DESCRIPTION,
          idempotencyKeyPrefix: `course-completion:${completion.id}`,
        });

        await tx.courseCompletion.update({
          where: { id: completion.id },
          data: { creditedAt: new Date() },
        });

        return true;
      });
    } catch (error) {
      if (error instanceof InsufficientCoinStockException) {
        return false;
      }
      throw error;
    }
  }
}
