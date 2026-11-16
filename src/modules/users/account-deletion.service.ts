import { createHash, randomBytes, randomInt } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccountDeletionRequest } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { EMAIL_PORT, EmailPort } from '../../common/email/email.port';
import { encryptCpf } from '../../common/crypto/cpf-crypto.util';
import { databaseTable } from '../../common/database/table-reference.util';
import { releasePendingSpin } from '../spins/release-pending-spin.util';
import { verifyPassword } from '../auth/password.util';
import { RequestAccountDeletionInput } from './dto/account-deletion.schema';

const DELETION_DEADLINE_MS = 7 * 24 * 60 * 60 * 1000;
const SUPPORT_EMAIL = 'ricardo@orkestri.net';

function response(request: AccountDeletionRequest) {
  return {
    id: request.id,
    status: request.completedAt ? ('COMPLETED' as const) : ('PENDING' as const),
    requestedAt: request.requestedAt.toISOString(),
    deadlineAt: request.deadlineAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
  };
}

@Injectable()
export class AccountDeletionService {
  private readonly logger = new Logger(AccountDeletionService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PORT) private readonly email: EmailPort,
  ) {}

  async getStatus(userId: string) {
    const request = await this.prisma.accountDeletionRequest.findUnique({ where: { userId } });
    return request ? response(request) : null;
  }

  async request(userId: string, input: RequestAccountDeletionInput) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (
      !input.confirmDeletion ||
      user.status !== 'ACTIVE' ||
      !user.passwordHash ||
      !(await verifyPassword(user.passwordHash, input.password))
    ) {
      throw new UnprocessableEntityException({
        code: 'INVALID_DELETION_CONFIRMATION',
        message: 'Confira sua senha e confirme a exclusão.',
      });
    }
    // UNIQUE(userId) + upsert: concorrência ou repetição nunca prorroga o prazo.
    const request = await this.prisma.accountDeletionRequest.upsert({
      where: { userId },
      create: { userId, deadlineAt: new Date(Date.now() + DELETION_DEADLINE_MS) },
      update: {},
    });
    // O registro persistido é a fonte de verdade, mesmo se o envio de e-mail falhar.
    // GET da fila de plataforma permite identificar e atender os pedidos sem depender do e-mail.
    await this.sendBestEffort({
      to: SUPPORT_EMAIL,
      subject: `Pedido de exclusão Mr. Coin — ${request.id}`,
      text: `Protocolo: ${request.id}\nPrazo: ${request.deadlineAt.toISOString()}\nConsulte a fila autenticada de exclusão na plataforma. Não responda a este aviso com credenciais ou documentos.`,
    });
    if (user.email) {
      await this.sendBestEffort({
        to: user.email,
        subject: 'Pedido de exclusão recebido — Mr. Coin',
        text: `Seu pedido foi recebido. Protocolo: ${request.id}. Prazo de conclusão: ${request.deadlineAt.toISOString()}. A exclusão será processada em até 7 dias corridos. Você receberá a confirmação por e-mail. Ter saldo não impede a exclusão. Dúvidas: ${SUPPORT_EMAIL}.`,
      });
    }
    return response(request);
  }

  async listPending(cursor?: string) {
    const requests = await this.prisma.accountDeletionRequest.findMany({
      where: {
        OR: [{ completedAt: null }, { completedAt: { not: null }, notificationSentAt: null }],
      },
      orderBy: [{ deadlineAt: 'asc' }, { id: 'asc' }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        userId: true,
        requestedAt: true,
        deadlineAt: true,
        completedAt: true,
        notificationSentAt: true,
      },
    });
    return {
      items: requests.slice(0, 50),
      nextCursor: requests.length > 50 ? (requests[49]?.id ?? null) : null,
    };
  }

  async review(id: string) {
    const request = await this.prisma.accountDeletionRequest.findUnique({
      where: { id },
      include: {
        user: {
          include: {
            memberships: { include: { organization: { select: { name: true } }, wallet: true } },
          },
        },
      },
    });
    if (!request)
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' });
    const membershipIds = request.user.memberships.map((membership) => membership.id);
    const walletIds = request.user.memberships.flatMap((membership) =>
      membership.wallet ? [membership.wallet.id] : [],
    );
    const [ledgerEntries, pendingRedemptions] = await Promise.all([
      this.prisma.ledgerEntry.count({ where: { walletId: { in: walletIds } } }),
      this.prisma.redemption.count({
        where: { membershipId: { in: membershipIds }, status: 'CONFIRMED' },
      }),
    ]);
    return {
      id: request.id,
      userId: request.userId,
      userName: request.user.name,
      contactEmail: request.user.email ?? request.notificationEmail,
      deadlineAt: request.deadlineAt.toISOString(),
      completedAt: request.completedAt?.toISOString() ?? null,
      retentionReason: request.retentionReason,
      ledgerEntries,
      pendingRedemptions,
      wallets: request.user.memberships
        .filter((membership) => membership.wallet)
        .map((membership) => ({
          organizationName: membership.organization.name,
          balance: membership.wallet!.cachedBalance,
        })),
    };
  }

  async complete(id: string, platformAdminId: string, retentionReason: string, ip?: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      // A exclusão é administrativa e serializada por pedido; repetição não apaga outra conta.
      await tx.$queryRaw`SELECT "id" FROM ${databaseTable('AccountDeletionRequest')} WHERE "id" = ${id} FOR UPDATE`;
      const request = await tx.accountDeletionRequest.findUnique({
        where: { id },
        include: { user: true },
      });
      if (!request)
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' });
      if (request.completedAt) return request;
      const user = request.user;
      const memberships = await tx.membership.findMany({
        where: { userId: user.id },
        select: { id: true },
      });
      const membershipIds = memberships.map((membership) => membership.id);

      // Nenhuma movimentação de saldo nem alteração do ledger: a revisão de retenção é
      // obrigatória e o histórico de operações permanece protegido por sua cadeia de hashes.
      await tx.userRefreshToken.deleteMany({ where: { userId: user.id } });
      await tx.device.deleteMany({ where: { userId: user.id } });
      await tx.userSignupRequest.deleteMany({ where: { cpfHash: user.cpfHash } });
      await tx.userPasswordResetRequest.deleteMany({ where: { cpfHash: user.cpfHash } });
      await tx.distributionItem.updateMany({
        where: { OR: [{ membershipId: { in: membershipIds } }, { cpfHash: user.cpfHash }] },
        data: { name: null, cpfHash: null, cpfEncrypted: null, externalRef: null },
      });
      await tx.membership.updateMany({
        where: { userId: user.id },
        data: { status: 'INACTIVE', externalRef: null },
      });
      const pendingSpins = await tx.spin.findMany({
        where: { membershipId: { in: membershipIds }, status: 'PENDING' },
        select: { id: true, reservedBatchId: true },
      });
      for (const spin of pendingSpins) await releasePendingSpin(tx, spin);
      await tx.courseCompletion.deleteMany({ where: { membershipId: { in: membershipIds } } });
      await tx.quizAttempt.deleteMany({ where: { membershipId: { in: membershipIds } } });
      await tx.lessonCompletion.deleteMany({ where: { membershipId: { in: membershipIds } } });
      await tx.user.update({
        where: { id: user.id },
        data: {
          status: 'DELETED',
          name: 'Conta excluída',
          email: null,
          phone: null,
          passwordHash: null,
          transactionPinHash: null,
          notificationsEnabled: false,
          cpfHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
          cpfEncrypted: encryptCpf(randomInt(10_000_000_000, 100_000_000_000).toString()),
        },
      });
      const completed = await tx.accountDeletionRequest.update({
        where: { id },
        data: {
          completedAt: new Date(),
          completedById: platformAdminId,
          retentionReason,
          notificationEmail: user.email,
        },
      });
      await tx.platformAdminAuditLog.create({
        data: {
          platformAdminId,
          action: 'ACCOUNT_DELETION_COMPLETED',
          payload: { requestId: id, retainedOperations: true },
          ip: ip ?? 'unknown',
        },
      });
      return completed;
    });

    if (result.notificationEmail && !result.notificationSentAt) {
      const sent = await this.sendBestEffort({
        to: result.notificationEmail,
        subject: 'Exclusão de conta concluída — Mr. Coin',
        text: `Sua conta foi excluída. Protocolo: ${result.id}. Dados de identificação e acesso foram removidos ou substituídos. Registros conservados e justificativa: ${result.retentionReason}. Não há recuperação automática do saldo após a exclusão. Dúvidas: ${SUPPORT_EMAIL}.`,
      });
      if (sent)
        await this.prisma.accountDeletionRequest.update({
          where: { id: result.id },
          data: { notificationEmail: null, notificationSentAt: new Date() },
        });
    } else if (!result.notificationEmail && !result.notificationSentAt) {
      await this.prisma.accountDeletionRequest.update({
        where: { id: result.id },
        data: { notificationSentAt: new Date() },
      });
    }
    return response(result);
  }

  private async sendBestEffort(message: {
    to: string;
    subject: string;
    text: string;
  }): Promise<boolean> {
    try {
      await this.email.send(message);
      return true;
    } catch {
      this.logger.warn('Falha na notificação de exclusão; o pedido permanece na fila autenticada.');
      return false;
    }
  }
}
