import { MembershipType, Prisma } from '@prisma/client';

export interface EnsureUserMembershipWalletInput {
  cpfEncrypted: string;
  cpfHash: string;
  name: string;
  organizationId: string;
  membershipType: MembershipType;
  externalRef?: string | null;
}

export interface EnsuredUserMembershipWallet {
  userId: string;
  membershipId: string;
  walletId: string;
}

/**
 * Upsert de User (PENDING_CLAIM se novo) + Membership + Wallet a partir de um CPF — mesmo
 * caminho que qualquer forma de creditar coins pra alguém precisa (distribuição individual,
 * distribuição via CSV, concessão de giro de roleta). Reaproveitado em vez de duplicado:
 * antes desta extração, `DistributionsService.distributeIndividual` e
 * `processDistributionItem` tinham essa lógica repetida quase igual.
 */
export async function ensureUserMembershipWallet(
  tx: Prisma.TransactionClient,
  input: EnsureUserMembershipWalletInput,
): Promise<EnsuredUserMembershipWallet> {
  const user = await tx.user.upsert({
    where: { cpfHash: input.cpfHash },
    create: {
      cpfEncrypted: input.cpfEncrypted,
      cpfHash: input.cpfHash,
      name: input.name,
      status: 'PENDING_CLAIM',
    },
    update: {},
  });

  const membership = await tx.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: input.organizationId } },
    create: {
      userId: user.id,
      organizationId: input.organizationId,
      type: input.membershipType,
      externalRef: input.externalRef ?? undefined,
    },
    update: {},
  });

  const existingWallet = await tx.wallet.findUnique({ where: { membershipId: membership.id } });
  const wallet = existingWallet ?? (await tx.wallet.create({ data: { membershipId: membership.id } }));

  return { userId: user.id, membershipId: membership.id, walletId: wallet.id };
}
