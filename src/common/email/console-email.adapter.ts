import { Injectable, Logger } from '@nestjs/common';
import { EmailPort, SendEmailParams } from './email.port';

/** Stub de dev: só loga o e-mail em vez de enviar de verdade. Nenhum provedor real
 * integrado ainda — trocar por Resend/SES/etc. é uma tarefa isolada. */
@Injectable()
export class ConsoleEmailAdapter implements EmailPort {
  private readonly logger = new Logger(ConsoleEmailAdapter.name);

  send(params: SendEmailParams): Promise<void> {
    this.logger.log(`[EMAIL STUB] para=${params.to} assunto="${params.subject}"\n${params.text}`);
    return Promise.resolve();
  }
}
