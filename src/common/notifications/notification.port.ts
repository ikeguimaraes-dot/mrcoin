export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');

export interface SendNotificationParams {
  userId: string;
  title: string;
  body: string;
}

/** Abstração de notificação ao usuário final (push/e-mail/o que vier depois) — troque a
 * implementação (`ConsoleNotificationAdapter`) por um provedor real (FCM/APNs/etc.) sem
 * tocar em quem consome esta interface. */
export interface NotificationPort {
  send(params: SendNotificationParams): Promise<void>;
}
