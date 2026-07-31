import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminRole, AdminUser } from '@prisma/client';
import { Env } from '../../config/env.schema';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLE_RANK } from '../../common/guards/roles.guard';
import { redactSensitiveFields } from '../../common/audit/redact.util';
import { EMAIL_PORT, EmailPort } from '../../common/email/email.port';
import { hashPassword } from '../auth/password.util';
import { RequestMeta, TokenPair, TokenService } from '../auth/token.service';
import { MFA_MANDATORY_ROLES } from '../auth/auth.constants';
import { ADMIN_INVITE_TTL_DAYS } from './organizations.constants';
import { InviteAdminInput } from './dto/invite-admin.schema';
import { AcceptInviteInput } from './dto/accept-invite.schema';
import { ChangeRoleInput } from './dto/change-role.schema';
import { InviteTokenInvalidException } from './exceptions/invite-token-invalid.exception';
import { InviteExpiredException } from './exceptions/invite-expired.exception';
import { InviteAlreadyUsedException } from './exceptions/invite-already-used.exception';
import { CannotAssignHigherRoleException } from './exceptions/cannot-assign-higher-role.exception';
import { EmailAlreadyInUseException } from './exceptions/email-already-in-use.exception';
import { CannotModifyHigherRankException } from './exceptions/cannot-modify-higher-rank.exception';
import { CannotModifySelfException } from './exceptions/cannot-modify-self.exception';

export interface CallerIdentity {
  id: string;
  organizationId: string;
  role: AdminRole;
}

export interface InviteResult {
  id: string;
  email: string;
  role: AdminRole;
  expiresAt: Date;
  inviteLink: string;
}

export type AcceptInviteResult =
  | { status: 'MFA_SETUP_REQUIRED'; mfaChallengeToken: string }
  | ({ status: 'OK' } & TokenPair);

/** Convite, aceite, troca de papel e desativação de AdminUser — sempre escopados pela
 * organização do chamador (nunca aceita organizationId vindo do cliente). */
@Injectable()
export class AdminInvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
    private readonly tokenService: TokenService,
    @Inject(EMAIL_PORT) private readonly emailPort: EmailPort,
  ) {}

  async invite(caller: CallerIdentity, input: InviteAdminInput): Promise<InviteResult> {
    if (ROLE_RANK[input.role] > ROLE_RANK[caller.role]) {
      throw new CannotAssignHigherRoleException();
    }

    const email = input.email.toLowerCase();
    const existingAdmin = await this.prisma.adminUser.findUnique({ where: { email } });

    if (existingAdmin) {
      throw new EmailAlreadyInUseException();
    }

    const rawToken = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + ADMIN_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

    const invite = await this.prisma.adminInvite.create({
      data: {
        organizationId: caller.organizationId,
        email,
        role: input.role,
        tokenHash,
        invitedByAdminUserId: caller.id,
        expiresAt,
      },
    });

    const inviteLink = `${this.configService.get('ADMIN_PANEL_URL', { infer: true })}/invites/${rawToken}`;

    await this.emailPort.send({
      to: email,
      subject: 'Você foi convidado para o coins-admin',
      text: `Você foi convidado com o papel ${input.role}. Aceite em: ${inviteLink} (expira em ${ADMIN_INVITE_TTL_DAYS} dias)`,
    });

    return { id: invite.id, email: invite.email, role: invite.role, expiresAt: invite.expiresAt, inviteLink };
  }

  async accept(rawToken: string, input: AcceptInviteInput, meta: RequestMeta = {}): Promise<AcceptInviteResult> {
    const tokenHash = this.hashToken(rawToken);
    const invite = await this.prisma.adminInvite.findUnique({ where: { tokenHash } });

    if (!invite) {
      throw new InviteTokenInvalidException();
    }

    if (invite.acceptedAt || invite.revokedAt) {
      throw new InviteAlreadyUsedException();
    }

    if (invite.expiresAt < new Date()) {
      throw new InviteExpiredException();
    }

    const passwordHash = await hashPassword(input.password);

    const admin = await this.prisma.$transaction(async (tx) => {
      const created = await tx.adminUser.create({
        data: {
          organizationId: invite.organizationId,
          name: input.name,
          email: invite.email,
          passwordHash,
          role: invite.role,
        },
      });

      await tx.adminInvite.update({ where: { id: invite.id }, data: { acceptedAt: new Date() } });

      await tx.auditLog.create({
        data: {
          organizationId: invite.organizationId,
          actorAdminUserId: created.id,
          action: 'ADMIN_INVITE_ACCEPTED',
          payload: redactSensitiveFields({ inviteId: invite.id, ...input }),
          ip: meta.ip ?? 'unknown',
        },
      });

      return created;
    });

    // OWNER/MANAGER nunca saem daqui com uma sessão válida sem MFA configurado — mesma
    // regra que AuthService.login() já aplica pra quem já tem conta. Sem isso, aceitar um
    // convite desses papéis furava a obrigatoriedade de MFA do CLAUDE.md.
    if (MFA_MANDATORY_ROLES.includes(admin.role)) {
      return {
        status: 'MFA_SETUP_REQUIRED',
        mfaChallengeToken: await this.tokenService.issueMfaChallengeToken(admin.id),
      };
    }

    const tokens = await this.tokenService.issueTokenPair(admin, meta);
    return { status: 'OK', ...tokens };
  }

  async changeRole(caller: CallerIdentity, targetAdminId: string, input: ChangeRoleInput): Promise<AdminUser> {
    if (targetAdminId === caller.id) {
      throw new CannotModifySelfException();
    }

    await this.getTargetInOrg(caller.organizationId, targetAdminId);

    return this.prisma.adminUser.update({
      where: { id: targetAdminId },
      data: { role: input.role },
    });
  }

  async deactivate(caller: CallerIdentity, targetAdminId: string): Promise<AdminUser> {
    if (targetAdminId === caller.id) {
      throw new CannotModifySelfException();
    }

    const target = await this.getTargetInOrg(caller.organizationId, targetAdminId);

    if (ROLE_RANK[target.role] >= ROLE_RANK[caller.role]) {
      throw new CannotModifyHigherRankException();
    }

    return this.prisma.adminUser.update({
      where: { id: targetAdminId },
      data: { status: 'INACTIVE' },
    });
  }

  private async getTargetInOrg(organizationId: string, adminUserId: string): Promise<AdminUser> {
    const target = await this.prisma.adminUser.findUnique({ where: { id: adminUserId } });

    if (!target || target.organizationId !== organizationId) {
      throw new NotFoundException();
    }

    return target;
  }

  private hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }
}
