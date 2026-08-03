import { Injectable, NotFoundException } from '@nestjs/common';
import { Membership, MembershipStatus, MembershipType, Prisma, User, UserStatus, Wallet } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { hashCpf } from '../../common/crypto/cpf-crypto.util';
import { LedgerService } from '../ledger/ledger.service';
import { MEMBER_LIST_PAGE_SIZE } from './members.constants';
import { ListMembersQuery } from './dto/list-members-query.schema';
import { ListMemberEntriesQuery } from './dto/list-member-entries-query.schema';

export interface MemberItem {
  membershipId: string;
  userId: string;
  name: string;
  membershipStatus: MembershipStatus;
  userStatus: UserStatus;
  membershipType: MembershipType;
  walletBalance: number;
  createdAt: Date;
}

type MembershipWithRelations = Membership & { user: User; wallet: Wallet | null };

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledgerService: LedgerService,
  ) {}

  async listMembers(
    organizationId: string,
    query: ListMembersQuery,
  ): Promise<{ items: MemberItem[]; nextCursor: string | null }> {
    const limit = query.limit ?? MEMBER_LIST_PAGE_SIZE;
    const where: Prisma.MembershipWhereInput = {
      organizationId,
      ...(query.cpf ? { user: { cpfHash: hashCpf(query.cpf) } } : {}),
    };

    const memberships = await this.prisma.membership.findMany({
      where,
      include: { user: true, wallet: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = memberships.length > limit;
    const page = hasMore ? memberships.slice(0, limit) : memberships;
    const last = page[page.length - 1];

    return { items: page.map(toMemberItem), nextCursor: hasMore && last ? last.id : null };
  }

  /** 404 (não 403) em cross-org de propósito — não vaza existência de membro de outra org
   * (mesmo padrão de DistributionsService.getDistribution). Sem checar membershipStatus:
   * diferente do self-service do app (WalletsService.resolveWalletId, que só deixa ACTIVE
   * passar), visão de admin precisa alcançar membro INACTIVE também. */
  async getMember(organizationId: string, membershipId: string): Promise<MemberItem> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
      include: { user: true, wallet: true },
    });

    if (!membership) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Membro não encontrado.' });
    }

    return toMemberItem(membership);
  }

  async getMemberEntries(
    organizationId: string,
    membershipId: string,
    query: ListMemberEntriesQuery,
  ) {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId },
      include: { wallet: true },
    });

    if (!membership) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Membro não encontrado.' });
    }

    if (!membership.wallet) {
      return { items: [], nextCursor: null };
    }

    return this.ledgerService.getEntries(membership.wallet.id, {
      cursor: query.cursor,
      limit: query.limit,
    });
  }
}

function toMemberItem(membership: MembershipWithRelations): MemberItem {
  return {
    membershipId: membership.id,
    userId: membership.userId,
    name: membership.user.name,
    membershipStatus: membership.status,
    userStatus: membership.user.status,
    membershipType: membership.type,
    walletBalance: membership.wallet?.cachedBalance ?? 0,
    createdAt: membership.createdAt,
  };
}
