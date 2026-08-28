import { Organization, PrismaClient } from '@prisma/client';
import { generateInviteToken } from './invite-token.util';
import { EmailAlreadyInUseException } from './exceptions/email-already-in-use.exception';
import { OrganizationCnpjInUseException } from './exceptions/organization-cnpj-in-use.exception';

export interface CreateOrganizationWithOwnerInput {
  name: string;
  cnpj: string;
  ownerEmail: string;
}

export interface CreateOrganizationWithOwnerResult {
  organization: Organization;
  invite: {
    id: string;
    rawToken: string;
    expiresAt: Date;
    inviteLink: string;
  };
}

/**
 * Cria a Organization real + um AdminInvite "de sistema" (invitedByAdminUserId: null,
 * role: OWNER) — mesma lógica usada por bootstrap-owner.ts (CLI) e pelo CRUD de platform
 * admin (POST /platform/organizations). Recebe o client de Prisma como parâmetro (não é
 * @Injectable()) justamente pra poder rodar tanto dentro do container Nest (PrismaService)
 * quanto fora dele, num script standalone (PrismaClient puro).
 *
 * O aceite continua sendo o MESMO caminho HTTP público de qualquer outro convite
 * (AdminInvitesService.accept), então o hash do token aqui precisa bater com o que
 * generateInviteToken()/hashInviteToken() produzem em todo o resto do módulo.
 */
export async function createOrganizationWithOwnerInvite(
  prisma: PrismaClient,
  input: CreateOrganizationWithOwnerInput,
  adminPanelUrl: string,
): Promise<CreateOrganizationWithOwnerResult> {
  const email = input.ownerEmail.toLowerCase();

  const existingOrg = await prisma.organization.findUnique({ where: { cnpj: input.cnpj } });
  if (existingOrg) {
    throw new OrganizationCnpjInUseException();
  }

  const existingAdmin = await prisma.adminUser.findUnique({ where: { email } });
  if (existingAdmin) {
    throw new EmailAlreadyInUseException();
  }

  const { rawToken, tokenHash, expiresAt } = generateInviteToken();

  const { organization, invite } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name: input.name, cnpj: input.cnpj } });

    const invite = await tx.adminInvite.create({
      data: {
        organizationId: organization.id,
        email,
        role: 'OWNER',
        tokenHash,
        invitedByAdminUserId: null,
        expiresAt,
      },
    });

    return { organization, invite };
  });

  return {
    organization,
    invite: {
      id: invite.id,
      rawToken,
      expiresAt: invite.expiresAt,
      inviteLink: `${adminPanelUrl}/invites/${rawToken}`,
    },
  };
}
