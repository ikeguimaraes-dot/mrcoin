import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AsaasSignatureGuard } from '../../common/guards/asaas-signature.guard';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { WebhooksService } from './webhooks.service';
import { AsaasPaymentWebhookInput, asaasPaymentWebhookSchema } from './dto/asaas-payment-webhook.schema';

/** Endpoint público (sem JWT) — autenticado só pela assinatura do PSP. Fora do Swagger
 * público porque não é consumido por nenhum dos três clientes da plataforma. */
@ApiExcludeController()
@Controller('webhooks/psp')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Post('payment')
  @HttpCode(200)
  @UseGuards(AsaasSignatureGuard)
  async handlePayment(@Body(new ZodValidationPipe(asaasPaymentWebhookSchema)) body: AsaasPaymentWebhookInput) {
    await this.webhooksService.handlePixPaymentWebhook(body);
    return { received: true };
  }
}
