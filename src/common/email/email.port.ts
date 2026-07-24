export const EMAIL_PORT = Symbol('EMAIL_PORT');

export interface SendEmailParams {
  to: string;
  subject: string;
  text: string;
}

/** Abstração de envio de e-mail — troque a implementação (`ConsoleEmailAdapter`) por um
 * provedor real (Resend/SES/etc.) sem tocar em quem consome esta interface. */
export interface EmailPort {
  send(params: SendEmailParams): Promise<void>;
}
