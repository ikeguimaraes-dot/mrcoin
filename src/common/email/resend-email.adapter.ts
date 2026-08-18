import { Resend } from 'resend';
import { EmailPort, SendEmailParams } from './email.port';

/** Provedor real de e-mail (produção). O SDK do Resend NÃO lança em erro de API — devolve
 * `{ data: null, error }` — por isso checamos `error` manualmente e lançamos, senão um
 * envio falho pareceria bem-sucedido pra quem chama (login/signup por OTP, convite de admin). */
export class ResendEmailAdapter implements EmailPort {
  private readonly resend: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
  ) {
    this.resend = new Resend(apiKey);
  }

  async send(params: SendEmailParams): Promise<void> {
    const { error } = await this.resend.emails.send({
      from: this.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
    });

    if (error) {
      throw new Error(`Falha ao enviar e-mail via Resend: ${error.name} — ${error.message}`);
    }
  }
}
