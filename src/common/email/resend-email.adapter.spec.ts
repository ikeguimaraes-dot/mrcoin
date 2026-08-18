import { ResendEmailAdapter } from './resend-email.adapter';

const sendMock = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: { send: sendMock },
  })),
}));

describe('ResendEmailAdapter', () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it('envia com from/to/subject/text corretos', async () => {
    sendMock.mockResolvedValue({ data: { id: 'email-123' }, error: null });
    const adapter = new ResendEmailAdapter('re_fake_key', 'onboarding@resend.dev');

    await adapter.send({ to: 'usuario@teste.dev', subject: 'Seu código', text: 'Código: 123456' });

    expect(sendMock).toHaveBeenCalledWith({
      from: 'onboarding@resend.dev',
      to: 'usuario@teste.dev',
      subject: 'Seu código',
      text: 'Código: 123456',
    });
  });

  it('lança erro quando a API do Resend devolve error — o SDK não lança sozinho', async () => {
    sendMock.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'Domínio do remetente não verificado' },
    });
    const adapter = new ResendEmailAdapter('re_fake_key', 'onboarding@resend.dev');

    await expect(
      adapter.send({ to: 'usuario@teste.dev', subject: 'Seu código', text: 'Código: 123456' }),
    ).rejects.toThrow('Domínio do remetente não verificado');
  });
});
