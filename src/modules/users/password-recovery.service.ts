import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EMAIL_PORT, EmailPort } from '../../common/email/email.port';
import { hashPassword } from '../auth/password.util';
import { OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES } from './users.constants';
import { generateOtpCode, hashOtpCode } from './otp.util';
import { RequestPasswordRecoveryInput } from './dto/request-password-recovery.schema';
import { ConfirmPasswordRecoveryInput } from './dto/confirm-password-recovery.schema';
import { AccountNotFoundException } from './exceptions/account-not-found.exception';
import { NoVerifiedContactException } from './exceptions/no-verified-contact.exception';
import { OtpNotFoundException } from './exceptions/otp-not-found.exception';
import { OtpExpiredException } from './exceptions/otp-expired.exception';
import { OtpTooManyAttemptsException } from './exceptions/otp-too-many-attempts.exception';
import { OtpInvalidException } from './exceptions/otp-invalid.exception';
import { RequestMeta, UserTokenPair, UserTokenService } from './user-token.service';

/**
 * Recuperação/definição de senha — mesmo mecanismo de OTP que o login usava antes desta
 * feature (prova posse do CPF via e-mail já cadastrado), agora só com esse propósito. Serve
 * IGUAL pra "esqueci minha senha" e "nunca defini uma senha": confirm() escreve
 * passwordHash incondicionalmente, sem branch de "primeira vez" — ver LoginService pra por
 * quê isso importa pra anti-enumeração (CPF sem senha não pode ser distinguível de senha
 * errada no login).
 */
@Injectable()
export class PasswordRecoveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userTokenService: UserTokenService,
    @Inject(EMAIL_PORT) private readonly emailPort: EmailPort,
  ) {}

  async requestOtp(input: RequestPasswordRecoveryInput): Promise<{ expiresAt: Date }> {
    const cpfHash = hashCpf(input.cpf);
    const user = await this.prisma.user.findUnique({ where: { cpfHash } });

    // Mesma exceção pra CPF inexistente e pra PENDING_CLAIM — não vaza se o CPF já tem
    // conta. CPF não é tratado como segredo nesta etapa (mesmo precedente já aceito hoje
    // pelo signup/login), só a resposta de LOGIN precisa ser totalmente genérica.
    if (!user || user.status !== 'ACTIVE') {
      throw new AccountNotFoundException();
    }

    if (!user.email) {
      throw new NoVerifiedContactException();
    }

    const rawCode = generateOtpCode();
    const codeHash = hashOtpCode(rawCode);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.userPasswordResetRequest.deleteMany({ where: { cpfHash, consumedAt: null } });
    await this.prisma.userPasswordResetRequest.create({ data: { cpfHash, codeHash, expiresAt } });

    await this.emailPort.send({
      to: user.email,
      subject: 'Código para redefinir sua senha',
      text: `Seu código é ${rawCode}. Válido por ${OTP_TTL_MINUTES} minutos.`,
    });

    return { expiresAt };
  }

  async confirm(input: ConfirmPasswordRecoveryInput, meta: RequestMeta = {}): Promise<UserTokenPair> {
    const cpfHash = hashCpf(input.cpf);
    const pending = await this.prisma.userPasswordResetRequest.findFirst({
      where: { cpfHash, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });

    if (!pending) {
      throw new OtpNotFoundException();
    }

    if (pending.expiresAt < new Date()) {
      throw new OtpExpiredException();
    }

    if (pending.attempts >= OTP_MAX_ATTEMPTS) {
      throw new OtpTooManyAttemptsException();
    }

    const codeHash = hashOtpCode(input.code);

    if (codeHash !== pending.codeHash) {
      const updated = await this.prisma.userPasswordResetRequest.update({
        where: { id: pending.id },
        data: { attempts: { increment: 1 } },
      });

      if (updated.attempts >= OTP_MAX_ATTEMPTS) {
        throw new OtpTooManyAttemptsException();
      }
      throw new OtpInvalidException();
    }

    // Estado pode ter mudado entre requestOtp e confirm (ex: conta desativada nesse meio
    // tempo) — trata igual a "não encontrada", mesma resposta de sempre.
    const user = await this.prisma.user.findUnique({ where: { cpfHash } });
    if (!user || user.status !== 'ACTIVE') {
      throw new AccountNotFoundException();
    }

    const passwordHash = await hashPassword(input.newPassword);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
      this.prisma.userPasswordResetRequest.update({ where: { id: pending.id }, data: { consumedAt: new Date() } }),
    ]);

    return this.userTokenService.issueTokenPair(user.id, meta);
  }
}
