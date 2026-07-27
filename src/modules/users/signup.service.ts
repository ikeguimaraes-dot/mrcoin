import { createHash, randomInt } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EMAIL_PORT, EmailPort } from '../../common/email/email.port';
import {
  NON_EXISTENT_USER_ID_PLACEHOLDER,
  OTP_CODE_LENGTH,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  USER_ACCESS_TOKEN_TTL_DAYS,
} from './users.constants';
import { RequestSignupInput } from './dto/request-signup.schema';
import { VerifySignupInput } from './dto/verify-signup.schema';
import { MembershipAlreadyExistsException } from './exceptions/membership-already-exists.exception';
import { OtpNotFoundException } from './exceptions/otp-not-found.exception';
import { OtpExpiredException } from './exceptions/otp-expired.exception';
import { OtpTooManyAttemptsException } from './exceptions/otp-too-many-attempts.exception';
import { OtpInvalidException } from './exceptions/otp-invalid.exception';

export interface SignupSession {
  accessToken: string;
  expiresIn: number;
}

/**
 * Nenhum método aqui loga CPF ou código OTP em claro — só cpfHash/ids quando necessário.
 * O e-mail de destino do OTP nunca vem do corpo da requisição quando o CPF já tem User
 * cadastrado (ver decisão de segurança no plano da sessão): evita que alguém que só sabe o
 * CPF de terceiro sequestre a identidade digitando o próprio e-mail.
 */
@Injectable()
export class SignupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    @Inject(EMAIL_PORT) private readonly emailPort: EmailPort,
  ) {}

  async requestOtp(input: RequestSignupInput): Promise<{ expiresAt: Date }> {
    const organization = await this.prisma.organization.findUnique({ where: { id: input.organizationId } });
    if (!organization) {
      throw new NotFoundException();
    }

    const cpfHash = hashCpf(input.cpf);
    const existingUser = await this.prisma.user.findUnique({ where: { cpfHash } });

    // Sempre faz a query de Membership (mesmo sem existingUser, com um id que nunca bate) —
    // iguala o número de round-trips ao banco nos dois caminhos, pra não vazar "esse CPF já
    // existe?" por timing entre os dois cenários que devolvem a mesma resposta HTTP.
    const existingMembership = await this.prisma.membership.findUnique({
      where: {
        userId_organizationId: {
          userId: existingUser?.id ?? NON_EXISTENT_USER_ID_PLACEHOLDER,
          organizationId: input.organizationId,
        },
      },
    });

    if (existingUser && existingMembership) {
      throw new MembershipAlreadyExistsException();
    }

    const targetEmail = existingUser ? existingUser.email : input.email;
    if (!targetEmail) {
      throw new Error('Usuário existente sem e-mail cadastrado — estado inconsistente.');
    }

    const rawCode = randomInt(0, 10 ** OTP_CODE_LENGTH).toString().padStart(OTP_CODE_LENGTH, '0');
    const codeHash = this.hashCode(rawCode);
    const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);

    await this.prisma.userSignupRequest.deleteMany({
      where: { cpfHash, organizationId: input.organizationId, consumedAt: null },
    });

    await this.prisma.userSignupRequest.create({
      data: {
        cpfEncrypted: encryptCpf(input.cpf),
        cpfHash,
        name: input.name,
        phone: input.phone,
        email: input.email,
        organizationId: input.organizationId,
        membershipType: input.membershipType,
        externalRef: input.externalRef,
        codeHash,
        expiresAt,
      },
    });

    await this.emailPort.send({
      to: targetEmail,
      subject: 'Seu código de verificação',
      text: `Seu código é ${rawCode}. Válido por ${OTP_TTL_MINUTES} minutos.`,
    });

    return { expiresAt };
  }

  async verifyOtp(input: VerifySignupInput): Promise<SignupSession> {
    const cpfHash = hashCpf(input.cpf);
    const pending = await this.prisma.userSignupRequest.findFirst({
      where: { cpfHash, organizationId: input.organizationId, consumedAt: null },
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

    const codeHash = this.hashCode(input.code);

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
      const user = await tx.user.upsert({
        where: { cpfHash: pending.cpfHash },
        create: {
          cpfEncrypted: pending.cpfEncrypted,
          cpfHash: pending.cpfHash,
          name: pending.name,
          phone: pending.phone,
          email: pending.email,
        },
        update: {},
      });

      const membership = await tx.membership.create({
        data: {
          userId: user.id,
          organizationId: pending.organizationId,
          type: pending.membershipType,
          externalRef: pending.externalRef,
        },
      });

      await tx.wallet.create({ data: { membershipId: membership.id } });
      await tx.userSignupRequest.update({ where: { id: pending.id }, data: { consumedAt: new Date() } });

      return { userId: user.id };
    });

    const expiresIn = USER_ACCESS_TOKEN_TTL_DAYS * 24 * 60 * 60;
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, type: 'user' },
      { expiresIn },
    );

    return { accessToken, expiresIn };
  }

  private hashCode(rawCode: string): string {
    return createHash('sha256').update(rawCode).digest('hex');
  }
}
