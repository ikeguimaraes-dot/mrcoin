import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MembershipListItem } from './dto/membership-list-response.schema';

@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async listMemberships(userId: string): Promise<MembershipListItem[]> {
    const memberships = await this.prisma.membership.findMany({
      where: { userId },
      include: { organization: true, wallet: true },
      orderBy: { createdAt: 'asc' },
    });

    return memberships.map((membership) => ({
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      membershipType: membership.type,
      membershipStatus: membership.status,
      walletBalance: membership.wallet?.cachedBalance ?? 0,
    }));
  }
}
