import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EMAIL_PORT, EmailPort } from '../../common/email/email.port';
import { OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES } from './users.constants';
import { generateOtpCode, hashOtpCode } from './otp.util';
import { RequestSignupInput } from './dto/request-signup.schema';
import { VerifySignupInput } from './dto/verify-signup.schema';
import { CpfNotInvitedException } from './exceptions/cpf-not-invited.exception';
import { OtpNotFoundException } from './exceptions/otp-not-found.exception';
import { OtpExpiredException } from './exceptions/otp-expired.exception';
import { OtpTooManyAttemptsException } from './exceptions/otp-too-many-attempts.exception';
import { OtpInvalidException } from './exceptions/otp-invalid.exception';
import { RequestMeta, UserTokenPair, UserTokenService } from './user-token.service';

/**
 * Nenhum método aqui loga CPF ou código OTP em claro — só cpfHash/ids quando necessário.
 *
 * Signup só existe como claim de um User PENDING_CLAIM (criado por uma distribuição — ver
 * módulo distributions). Sem conta pendente pra esse CPF (nunca existiu, ou já é ACTIVE —
 * já reivindicada antes), rejeita com CpfNotInvitedException: mesma exceção pros dois casos,
 * pra não vazar se o CPF já tem conta (mesmo princípio anti-enumeração do LoginService).
 * organizationId/membershipType nunca vêm do body — vêm das Memberships que a distribuição
 * já criou, descobertas em verifyOtp.
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly userTokenService: UserTokenService,
    @Inject(EMAIL_PORT) private readonly emailPort: EmailPort,
  ) {}

  async requestOtp(input: RequestSignupInput): Promise<{ expiresAt: Date }> {
    const cpfHash = hashCpf(input.cpf);
    const existingUser = await this.prisma.user.findUnique({ where: { cpfHash } });

    if (!existingUser || existingUser.status !== 'PENDING_CLAIM') {
      throw new CpfNotInvitedException();
    }

    const rawCode = generateOtpCode();
    const codeHash = hashOtpCode(rawCode);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.userSignupRequest.deleteMany({ where: { cpfHash, consumedAt: null } });

    await this.prisma.userSignupRequest.create({
      data: {
        cpfEncrypted: encryptCpf(input.cpf),
        cpfHash,
        name: input.name,
        phone: input.phone,
        email: input.email,
        codeHash,
        expiresAt,
      },
    });

    await this.emailPort.send({
      to: input.email,
      subject: 'Seu código de verificação',
      text: `Seu código é ${rawCode}. Válido por ${OTP_TTL_MINUTES} minutos.`,
    });

    return { expiresAt };
  }

  async verifyOtp(input: VerifySignupInput, meta: RequestMeta = {}): Promise<UserTokenPair> {
    const cpfHash = hashCpf(input.cpf);
    const pending = await this.prisma.userSignupRequest.findFirst({
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
      const updated = await this.prisma.userSignupRequest.update({
        where: { id: pending.id },
        data: { attempts: { increment: 1 } },
      });

      if (updated.attempts >= OTP_MAX_ATTEMPTS) {
        throw new OtpTooManyAttemptsException();
      }
      throw new OtpInvalidException();
    }

    const { userId } = await this.prisma.$transaction(async (tx) => {
      const existingUser = await tx.user.findUnique({ where: { cpfHash: pending.cpfHash } });

      // Estado pode ter mudado entre requestOtp e verify (ex.: claim concluído por outro
      // canal nesse meio-tempo) — trata igual a "não convidado", mesmo guard equivalente do
      // LoginService entre requestOtp/verifyOtp.
      if (!existingUser || existingUser.status !== 'PENDING_CLAIM') {
        throw new CpfNotInvitedException();
      }

      // Só agora, com o OTP confirmado no e-mail que a pessoa acabou de informar, é seguro
      // promover pra ACTIVE e gravar esse contato — nunca antes disso.
      const user = await tx.user.update({
        where: { id: existingUser.id },
        data: { name: pending.name, phone: pending.phone, email: pending.email, status: 'ACTIVE' },
      });

      // Prova o CPF uma vez só, não um vínculo específico — ativa TODAS as memberships
      // pendentes desse CPF de uma vez (podem ser de mais de uma organização, se mais de uma
      // empresa distribuiu antes do claim). Memberships já existem, criadas pelas
      // distribuições; só garante Wallet em cada uma. Se garantir a Wallet de QUALQUER
      // membership falhar, a transação inteira reverte — nenhuma é promovida (nem o User
      // volta a ACTIVE), exatamente como um claim parcial não pode acontecer.
      const memberships = await tx.membership.findMany({ where: { userId: user.id } });
      for (const membership of memberships) {
        await this.ensureWalletForMembership(tx, membership.id);
      }

      await tx.userSignupRequest.update({ where: { id: pending.id }, data: { consumedAt: new Date() } });

      return { userId: user.id };
    });

    return this.userTokenService.issueTokenPair(userId, meta);
  }

  private async ensureWalletForMembership(tx: Prisma.TransactionClient, membershipId: string): Promise<void> {
    const existingWallet = await tx.wallet.findUnique({ where: { membershipId } });
    if (!existingWallet) {
      await tx.wallet.create({ data: { membershipId } });
    }
  }
}
