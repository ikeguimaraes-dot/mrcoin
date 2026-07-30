import { Injectable, Logger } from '@nestjs/common';
import { NotificationPort, SendNotificationParams } from './notification.port';

/** Stub de dev: só loga a notificação em vez de enviar de verdade. Nenhum provedor real
 * integrado ainda — trocar por FCM/APNs/etc. é uma tarefa isolada. */
@Injectable()
export class ConsoleNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(ConsoleNotificationAdapter.name);

  send(params: SendNotificationParams): Promise<void> {
    this.logger.log(`[NOTIFICATION STUB] userId=${params.userId} título="${params.title}"\n${params.body}`);
    return Promise.resolve();
  }
}
