/**
 * Bootstrap do primeiro PlatformAdmin — rodado manualmente, uma vez, por um humano (nunca
 * automatizado, nunca chamado pela API). Diferente de bootstrap-owner.ts (que cria um
 * AdminInvite porque já existe um endpoint público de aceite pra AdminUser), não existe
 * painel/endpoint de aceite pra PlatformAdmin nesta fase — então este script cria a linha
 * diretamente, com uma senha inicial gerada aqui mesmo.
 *
 * MFA não é configurado por este script: mfaEnabled nasce false, e a regra de negócio
 * (PlatformAdminAuthService.login) força MFA_SETUP_REQUIRED sempre que mfaEnabled é false —
 * MFA é obrigatório sem exceção pra PlatformAdmin. No primeiro login, a senha impressa aqui
 * autentica e a pessoa configura o MFA via POST /platform/auth/mfa/setup + mfa/enable.
 *
 * Uso:
 *   pnpm ts-node -r tsconfig-paths/register prisma/bootstrap-platform-admin.ts \
 *     --name "Nome da Pessoa" --email dono@mrcoin.com
 */
import { randomBytes } from 'node:crypto';
import { config } from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/modules/auth/password.util';

config({ quiet: true });

const prisma = new PrismaClient();

interface Args {
  name: string;
  email: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };

  const name = get('--name');
  const email = get('--email');

  if (!name || !email) {
    console.error('Uso: ts-node prisma/bootstrap-platform-admin.ts --name "Nome da Pessoa" --email dono@mrcoin.com');
    process.exit(1);
  }

  return { name, email: email.toLowerCase() };
}

function generateInitialPassword(): string {
  return randomBytes(24).toString('base64url');
}

async function main(): Promise<void> {
  const { name, email } = parseArgs();

  const existing = await prisma.platformAdmin.findUnique({ where: { email } });
  if (existing) {
    console.error(`Já existe um PlatformAdmin com esse e-mail (id: ${existing.id}). Nada foi criado.`);
    process.exit(1);
  }

  const initialPassword = generateInitialPassword();
  const passwordHash = await hashPassword(initialPassword);

  const platformAdmin = await prisma.$transaction(async (tx) => {
    const created = await tx.platformAdmin.create({
      data: { name, email, passwordHash },
    });

    await tx.platformAdminAuditLog.create({
      data: {
        platformAdminId: created.id,
        action: 'BOOTSTRAP_CREATED',
        payload: {},
        ip: 'cli',
      },
    });

    return created;
  });

  console.log('PlatformAdmin criado:', platformAdmin.id, platformAdmin.email);
  console.log('');
  console.log('Senha inicial (só é exibida agora — entregue por um canal seguro):');
  console.log(initialPassword);
  console.log('');
  console.log('No primeiro login (POST /platform/auth/login), a resposta será MFA_SETUP_REQUIRED —');
  console.log('configure o MFA com POST /platform/auth/mfa/setup + /platform/auth/mfa/enable antes');
  console.log('de ter qualquer sessão válida. MFA é obrigatório sem exceção pra PlatformAdmin.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
