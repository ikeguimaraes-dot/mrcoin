/**
 * Bootstrap do primeiro OWNER de uma organização nova — rodado manualmente, uma vez, por
 * um humano (nunca automatizado, nunca chamado pela API). Não existe endpoint público de
 * criação de Organization (decisão da Sessão 6, mantida de propósito); esta é a única
 * forma de sair de um banco vazio pra ter alguém com acesso.
 *
 * Cria a Organization real + um AdminInvite "de sistema" (invitedByAdminUserId: null,
 * role: OWNER) e imprime o link de aceite. Segue o MESMO caminho HTTP público que
 * qualquer outro convite (POST /organizations/admins/invites/:token/accept) — a pessoa
 * define a própria senha ali, e por ser OWNER, o aceite devolve MFA_SETUP_REQUIRED, nunca
 * uma sessão pronta (ver AdminInvitesService.accept — Sessão 11). O link expira em
 * ADMIN_INVITE_TTL_DAYS dias, igual qualquer convite; não é um segredo permanente.
 *
 * Uso:
 *   pnpm ts-node -r tsconfig-paths/register prisma/bootstrap-owner.ts \
 *     --name "Empresa Cliente Ltda" --cnpj 12345678000199 --email dono@empresa.com
 *
 * Nunca roda `prisma db seed` (cria dados fictícios) contra um banco de produção — este
 * script é o substituto correto pra esse cenário.
 */
import { randomBytes, createHash } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
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

function hashToken(rawToken: string): string {
  // Mesmo algoritmo de AdminInvitesService.hashToken — precisa bater pro accept() achar o convite.
  return createHash('sha256').update(rawToken).digest('hex');
}

async function main(): Promise<void> {
  const { name, cnpj, email } = parseArgs();

  const existingOrg = await prisma.organization.findUnique({ where: { cnpj } });
  if (existingOrg) {
    console.error(`Já existe uma Organization com esse CNPJ (id: ${existingOrg.id}). Nada foi criado.`);
    process.exit(1);
  }

  const existingAdmin = await prisma.adminUser.findUnique({ where: { email } });
  if (existingAdmin) {
    console.error(`Já existe um AdminUser com esse e-mail (id: ${existingAdmin.id}). Nada foi criado.`);
    process.exit(1);
  }

  const rawToken = randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + ADMIN_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

  const { organization, invite } = await prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data: { name, cnpj } });

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

  const adminPanelUrl = process.env.ADMIN_PANEL_URL ?? 'http://localhost:3001';
  const inviteLink = `${adminPanelUrl}/invites/${rawToken}`;

  console.log('Organization criada:', organization.id, organization.name);
  console.log('Convite de OWNER criado:', invite.id, `(expira em ${ADMIN_INVITE_TTL_DAYS} dias, em ${expiresAt.toISOString()})`);
  console.log('');
  console.log('Entregue este link pro dono real por um canal seguro (não é enviado por e-mail automaticamente):');
  console.log(inviteLink);
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
