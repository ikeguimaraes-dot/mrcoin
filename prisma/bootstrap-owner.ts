/**
 * Bootstrap do primeiro OWNER de uma organização nova — rodado manualmente, uma vez, por
 * um humano (nunca automatizado, nunca chamado pela API). Não existe endpoint público de
 * criação de Organization; POST /platform/organizations (Sessão 13) expõe a mesma lógica,
 * mas atrás de @PlatformAdminAuth() — este script continua existindo pro bootstrap
 * zero-a-um, antes de existir qualquer PlatformAdmin, ou em ambientes sem acesso HTTP.
 *
 * Cria a Organization real + um AdminInvite "de sistema" (invitedByAdminUserId: null,
 * role: OWNER) e imprime o link de aceite, via createOrganizationWithOwnerInvite()
 * (src/modules/organizations/create-organization-with-owner.ts) — mesma função usada por
 * POST /platform/organizations, pra não duplicar a lógica de criação de org+convite.
 * Segue o MESMO caminho HTTP público que qualquer outro convite
 * (POST /organizations/admins/invites/:token/accept) — a pessoa define a própria senha ali,
 * e por ser OWNER, o aceite devolve MFA_SETUP_REQUIRED, nunca uma sessão pronta (ver
 * AdminInvitesService.accept — Sessão 11). O link expira em ADMIN_INVITE_TTL_DAYS dias,
 * igual qualquer convite; não é um segredo permanente.
 *
 * Uso:
 *   pnpm ts-node -r tsconfig-paths/register prisma/bootstrap-owner.ts \
 *     --name "Empresa Cliente Ltda" --cnpj 12345678000199 --email dono@empresa.com
 *
 * Nunca roda `prisma db seed` (cria dados fictícios) contra um banco de produção — este
 * script é o substituto correto pra esse cenário.
 */
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { createOrganizationWithOwnerInvite } from '../src/modules/organizations/create-organization-with-owner';
import { EmailAlreadyInUseException } from '../src/modules/organizations/exceptions/email-already-in-use.exception';
import { OrganizationCnpjInUseException } from '../src/modules/organizations/exceptions/organization-cnpj-in-use.exception';
import { ADMIN_INVITE_TTL_DAYS } from '../src/modules/organizations/organizations.constants';

config({ quiet: true });

const prisma = new PrismaClient();

interface Args {
  name: string;
  cnpj: string;
  email: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const name = get('--name');
  const cnpj = get('--cnpj');
  const email = get('--email');

  if (!name || !cnpj || !email) {
    console.error(
      'Uso: ts-node prisma/bootstrap-owner.ts --name "Empresa Ltda" --cnpj 12345678000199 --email dono@empresa.com',
    );
    process.exit(1);
  }

  return { name, cnpj, email: email.toLowerCase() };
}

async function main(): Promise<void> {
  const { name, cnpj, email } = parseArgs();
  const adminPanelUrl = process.env.ADMIN_PANEL_URL ?? 'http://localhost:3001';

  let result;
  try {
    result = await createOrganizationWithOwnerInvite(prisma, { name, cnpj, ownerEmail: email }, adminPanelUrl);
  } catch (error) {
    if (error instanceof OrganizationCnpjInUseException || error instanceof EmailAlreadyInUseException) {
      console.error(error.message, 'Nada foi criado.');
      process.exit(1);
    }
    throw error;
  }

  const { organization, invite } = result;

  console.log('Organization criada:', organization.id, organization.name);
  console.log(
    'Convite de OWNER criado:',
    invite.id,
    `(expira em ${ADMIN_INVITE_TTL_DAYS} dias, em ${invite.expiresAt.toISOString()})`,
  );
  console.log('');
  console.log('Entregue este link pro dono real por um canal seguro (não é enviado por e-mail automaticamente):');
  console.log(invite.inviteLink);
  console.log('');
  console.log('Ao aceitar, a pessoa define a própria senha e recebe MFA_SETUP_REQUIRED — precisa');
  console.log('configurar MFA (POST /auth/mfa/setup + /auth/mfa/enable) antes de ter qualquer sessão válida.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
