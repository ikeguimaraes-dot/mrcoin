import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EMAIL_PORT, EmailPort } from '../../common/email/email.port';
import { OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES, USER_ACCESS_TOKEN_TTL_DAYS } from './users.constants';
import { generateOtpCode, hashOtpCode } from './otp.util';
import { RequestLoginInput } from './dto/request-login.schema';
import { VerifyLoginInput } from './dto/verify-login.schema';
import { SignupSession } from './signup.service';
import { AccountNotFoundException } from './exceptions/account-not-found.exception';
import { NoVerifiedContactException } from './exceptions/no-verified-contact.exception';
import { OtpNotFoundException } from './exceptions/otp-not-found.exception';
import { OtpExpiredException } from './exceptions/otp-expired.exception';
import { OtpTooManyAttemptsException } from './exceptions/otp-too-many-attempts.exception';
import { OtpInvalidException } from './exceptions/otp-invalid.exception';

/**
 * Login não cria nem vincula nada — só prova posse do CPF via OTP e devolve sessão.
 * Sem organizationId (diferente do signup): quem já tem conta pode ter vínculo com mais de
 * uma organização, resolvida depois via GET /memberships. O e-mail de destino é sempre o
 * já cadastrado no User — nunca aceito do request (não existe request de e-mail aqui, login
 * só recebe CPF), mesmo princípio anti-sequestro do SignupService.
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(EMAIL_PORT) private readonly emailPort: EmailPort,
  ) {}

  async requestOtp(input: RequestLoginInput): Promise<{ expiresAt: Date }> {
    const cpfHash = hashCpf(input.cpf);
    const user = await this.prisma.user.findUnique({ where: { cpfHash } });

    // Mesma exceção (mesmo status/code) pra CPF inexistente e pra PENDING_CLAIM — não vaza
    // se o CPF já tem conta. PENDING_CLAIM precisa terminar o cadastro pelo link da
    // organização (é isso que prova o contato e promove pra ACTIVE), não pelo login.
    if (!user || user.status !== 'ACTIVE') {
      throw new AccountNotFoundException();
    }

    if (!user.email) {
      throw new NoVerifiedContactException();
    }

    const rawCode = generateOtpCode();
    const codeHash = hashOtpCode(rawCode);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.userLoginRequest.deleteMany({ where: { cpfHash, consumedAt: null } });
    await this.prisma.userLoginRequest.create({ data: { cpfHash, codeHash, expiresAt } });

    await this.emailPort.send({
      to: user.email,
      subject: 'Seu código de acesso',
      text: `Seu código é ${rawCode}. Válido por ${OTP_TTL_MINUTES} minutos.`,
    });

    return { expiresAt };
  }

  async verifyOtp(input: VerifyLoginInput): Promise<SignupSession> {
    const cpfHash = hashCpf(input.cpf);
    const pending = await this.prisma.userLoginRequest.findFirst({
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
      const updated = await this.prisma.userLoginRequest.update({
        where: { id: pending.id },
        data: { attempts: { increment: 1 } },
      });

      if (updated.attempts >= OTP_MAX_ATTEMPTS) {
        throw new OtpTooManyAttemptsException();
      }
      throw new OtpInvalidException();
    }

    // Estado pode ter mudado entre requestOtp e verify (ex: conta desativada nesse meio
    // tempo) — trata igual a "não encontrada", mesma resposta de sempre.
    const user = await this.prisma.user.findUnique({ where: { cpfHash } });
    if (!user || user.status !== 'ACTIVE') {
      throw new AccountNotFoundException();
    }

    await this.prisma.userLoginRequest.update({ where: { id: pending.id }, data: { consumedAt: new Date() } });

    const expiresIn = USER_ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60;
    const accessToken = await this.jwtService.signAsync({ sub: user.id, type: 'user' }, { expiresIn });

    return { accessToken, expiresIn };
  }
}
