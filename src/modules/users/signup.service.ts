import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EMAIL_PORT, EmailPort } from '../../common/email/email.port';
import {
  NON_EXISTENT_USER_ID_PLACEHOLDER,
  OTP_MAX_ATTEMPTS,
  OTP_TTL_MINUTES,
  USER_ACCESS_TOKEN_TTL_DAYS,
} from './users.constants';
import { generateOtpCode, hashOtpCode } from './otp.util';
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
 * ACTIVE (já reivindicado antes): evita que alguém que só sabe o CPF de terceiro sequestre
 * a identidade digitando o próprio e-mail. Exceção deliberada: um User PENDING_CLAIM (criado
 * por uma distribuição, sem nenhum contato verificado — ver módulo distributions) não tem
 * e-mail confiável nenhum pra reusar, então o OTP vai pro e-mail que a própria pessoa está
 * informando agora; é isso que prova posse do contato e promove a conta pra ACTIVE.
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

    if (existingUser && existingUser.status === 'ACTIVE' && existingMembership) {
      throw new MembershipAlreadyExistsException();
    }

    const targetEmail = existingUser && existingUser.status === 'ACTIVE' ? existingUser.email : input.email;
    if (!targetEmail) {
      throw new Error('Usuário existente sem e-mail cadastrado — estado inconsistente.');
    }

    const rawCode = generateOtpCode();
    const codeHash = hashOtpCode(rawCode);
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

      // PENDING_CLAIM: a conta já existe (criada por uma distribuição), mas sem contato
      // verificado nenhum. Só agora, com o OTP confirmado no e-mail que a pessoa acabou de
      // informar, é seguro promover pra ACTIVE e gravar esse contato — nunca antes disso.
      const user =
        existingUser && existingUser.status === 'PENDING_CLAIM'
          ? await tx.user.update({
              where: { id: existingUser.id },
              data: { name: pending.name, phone: pending.phone, email: pending.email, status: 'ACTIVE' },
            })
          : await tx.user.upsert({
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

      // Find-or-create: uma distribuição anterior pode já ter criado Membership+Wallet
      // pra essa organização (é exatamente o caso PENDING_CLAIM); se veio de outra
      // organização, ainda não existe e é criada aqui, como antes.
      const membership = await tx.membership.upsert({
        where: { userId_organizationId: { userId: user.id, organizationId: pending.organizationId } },
        create: {
          userId: user.id,
          organizationId: pending.organizationId,
          type: pending.membershipType,
          externalRef: pending.externalRef,
        },
        update: {},
      });

      const existingWallet = await tx.wallet.findUnique({ where: { membershipId: membership.id } });
      if (!existingWallet) {
        await tx.wallet.create({ data: { membershipId: membership.id } });
      }

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
}
