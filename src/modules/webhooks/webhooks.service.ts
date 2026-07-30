import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AsaasPaymentWebhookInput } from './dto/asaas-payment-webhook.schema';

const PIX_PAID_EVENT = 'PAYMENT_RECEIVED';

/**
 * Recebe a confirmação de pagamento do Asaas. Nunca chama LedgerService — pagar um lote
 * só libera estoque de coins (CoinBatch PENDING → PAID), não credita nenhuma Wallet.
 *
 * Idempotência: o `updateMany` com `WHERE status = 'PENDING'` é uma guarda atômica no
 * banco (não um `if` na aplicação), então cobre tanto reentregas do Asaas quanto
 * entregas concorrentes do mesmo evento.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handlePixPaymentWebhook(payload: AsaasPaymentWebhookInput): Promise<void> {
    if (payload.event !== PIX_PAID_EVENT) {
      return;
    }

    const batch = await this.prisma.coinBatch.findUnique({
      where: { pspChargeId: payload.payment.id },
    });

    if (!batch) {
      this.logger.warn(`Webhook do Asaas referencia pspChargeId desconhecido: ${payload.payment.id}`);
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      const result = await tx.coinBatch.updateMany({
        where: { id: batch.id, status: 'PENDING' },
        data: { status: 'PAID' },
      });

      if (result.count === 0) {
        return;
      }

      await tx.auditLog.create({
        data: {
          organizationId: batch.organizationId,
          actorType: 'SYSTEM',
          actorAdminUserId: null,
          action: 'BATCH_PAYMENT_CONFIRMED',
          payload: { pspChargeId: payload.payment.id, event: payload.event },
          ip: 'psp-webhook',
        },
      });
    });
  }
}
