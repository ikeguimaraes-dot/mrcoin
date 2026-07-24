import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AdminSummary {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  mfaEnabled: boolean;
}

export interface AdminProfile extends AdminSummary {
  organizationId: string;
  lastLoginAt: Date | null;
}

/**
 * Leitura de AdminUser sempre escopada por organizationId recebido explicitamente (o
 * chamador — controller — é quem garante que esse valor vem do JWT via TenantGuard,
 * nunca de query/body). Nunca aceita organizationId como parâmetro de busca livre.
 */
@Injectable()
export class AdminDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async listByOrganization(
    organizationId: string,
    options?: { cursor?: string; limit?: number },
  ): Promise<{ items: AdminSummary[]; nextCursor: string | null }> {
    const limit = options?.limit ?? 20;
    const admins = await this.prisma.adminUser.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: { id: true, name: true, email: true, role: true, status: true, mfaEnabled: true },
    });

    const hasMore = admins.length > limit;
    const page = hasMore ? admins.slice(0, limit) : admins;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }

  getProfile(adminUserId: string): Promise<AdminProfile> {
    return this.prisma.adminUser.findUniqueOrThrow({
      where: { id: adminUserId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        mfaEnabled: true,
        organizationId: true,
        lastLoginAt: true,
      },
    });
  }
}
