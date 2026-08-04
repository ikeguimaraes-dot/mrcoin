import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { MembershipType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EMAIL_PORT, EmailPort } from '../../common/email/email.port';
import { NON_EXISTENT_USER_ID_PLACEHOLDER, OTP_MAX_ATTEMPTS, OTP_TTL_MINUTES } from './users.constants';
import { generateOtpCode, hashOtpCode } from './otp.util';
import { RequestSignupInput } from './dto/request-signup.schema';
import { VerifySignupInput } from './dto/verify-signup.schema';
import { MembershipAlreadyExistsException } from './exceptions/membership-already-exists.exception';
import { OrganizationRequiredException } from './exceptions/organization-required.exception';
import { OtpNotFoundException } from './exceptions/otp-not-found.exception';
import { OtpExpiredException } from './exceptions/otp-expired.exception';
import { OtpTooManyAttemptsException } from './exceptions/otp-too-many-attempts.exception';
import { OtpInvalidException } from './exceptions/otp-invalid.exception';
import { RequestMeta, UserTokenPair, UserTokenService } from './user-token.service';

/**
 * Nenhum método aqui loga CPF ou código OTP em claro — só cpfHash/ids quando necessário.
 * O e-mail de destino do OTP nunca vem do corpo da requisição quando o CPF já tem User
 * ACTIVE (já reivindicado antes): evita que alguém que só sabe o CPF de terceiro sequestre
 * a identidade digitando o próprio e-mail. Exceção deliberada: um User PENDING_CLAIM (criado
 * por uma distribuição, sem nenhum contato verificado — ver módulo distributions) não tem
 * e-mail confiável nenhum pra reusar, então o OTP vai pro e-mail que a própria pessoa está
 * informando agora; é isso que prova posse do contato e promove a conta pra ACTIVE.
 *
 * organizationId/membershipType são opcionais no corpo: omitidos = claim de um User
 * PENDING_CLAIM (a pessoa está provando o CPF, não escolhendo organização — a Membership já
 * existe, criada pela distribuição). Sem PENDING_CLAIM pra esse CPF, os dois campos são
 * obrigatórios (pessoa nova, ou ACTIVE somando outra organização).
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
    const isClaim = existingUser?.status === 'PENDING_CLAIM';

    if (!isClaim) {
      // Sem PENDING_CLAIM pra esse CPF: precisa saber a qual organização a pessoa está se
      // associando (schema já garante os dois vêm juntos quando organizationId é informado).
      if (!input.organizationId || !input.membershipType) {
        throw new OrganizationRequiredException();
      }

      const organization = await this.prisma.organization.findUnique({ where: { id: input.organizationId } });
      if (!organization) {
        throw new NotFoundException();
      }
    }

    // Sempre faz a query de Membership (mesmo sem existingUser/organizationId, com um id que
    // nunca bate) — iguala o número de round-trips ao banco nos cenários que devolvem a
    // mesma resposta HTTP, mesma técnica de sempre.
    const existingMembership = input.organizationId
      ? await this.prisma.membership.findUnique({
          where: {
            userId_organizationId: {
              userId: existingUser?.id ?? NON_EXISTENT_USER_ID_PLACEHOLDER,
              organizationId: input.organizationId,
            },
          },
        })
      : null;

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

    await this.prisma.userSignupRequest.deleteMany({ where: { cpfHash, consumedAt: null } });

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
      const isClaim = existingUser?.status === 'PENDING_CLAIM';

      // PENDING_CLAIM: a conta já existe (criada por uma distribuição), mas sem contato
      // verificado nenhum. Só agora, com o OTP confirmado no e-mail que a pessoa acabou de
      // informar, é seguro promover pra ACTIVE e gravar esse contato — nunca antes disso.
      const user = isClaim
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

      if (isClaim) {
        // Claim: prova o CPF uma vez só, não um vínculo específico — ativa TODAS as
        // memberships pendentes desse CPF de uma vez (podem ser de mais de uma organização,
        // se mais de uma empresa distribuiu antes do claim). Memberships já existem, criadas
        // pelas distribuições; só garante Wallet em cada uma. organizationId do pending (se
        // por acaso veio preenchido) é ignorado aqui de propósito. Se garantir a Wallet de
        // QUALQUER membership falhar, a transação inteira reverte — nenhuma é promovida
        // (nem o User volta a ACTIVE), exatamente como um claim parcial não pode acontecer.
        const memberships = await tx.membership.findMany({ where: { userId: user.id } });
        for (const membership of memberships) {
          await this.ensureWalletForMembership(tx, membership.id);
        }
      } else {
        // Fresh signup ou ACTIVE somando outra organização: organizationId/membershipType
        // são obrigatórios aqui (garantidos pelo requestOtp) — cria/reaproveita só essa
        // membership específica, como antes.
        const membership = await tx.membership.upsert({
          where: { userId_organizationId: { userId: user.id, organizationId: pending.organizationId as string } },
          create: {
            userId: user.id,
            organizationId: pending.organizationId as string,
            type: pending.membershipType as MembershipType,
            externalRef: pending.externalRef,
          },
          update: {},
        });

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
