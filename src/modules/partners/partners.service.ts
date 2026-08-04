import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PARTNER_LIST_PAGE_SIZE } from './partners.constants';
import { ListPartnersQuery } from './dto/list-partners-query.schema';
import { PartnerNotFoundException } from './exceptions/partner-not-found.exception';
import {
  SAFE_PARTNER_ADMIN_SELECT,
  SAFE_PARTNER_CATALOG_SELECT,
  SafePartnerAdmin,
  SafePartnerCatalog,
} from './safe-partner.util';

/** Partner é global (compartilhado por todas as organizações da plataforma) — nenhuma
 * query aqui filtra por organizationId. Catálogo (app) só mostra ACTIVE; admin vê todos os
 * status, mas nunca pixKey/takeRateBps (ver safe-partner.util.ts). */
@Injectable()
export class PartnersService {
  constructor(private readonly prisma: PrismaService) {}

  async listCatalog(query: ListPartnersQuery): Promise<{ items: SafePartnerCatalog[]; nextCursor: string | null }> {
    const limit = query.limit ?? PARTNER_LIST_PAGE_SIZE;

    const partners = await this.prisma.partner.findMany({
      where: { status: 'ACTIVE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SAFE_PARTNER_CATALOG_SELECT,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = partners.length > limit;
    const page = hasMore ? partners.slice(0, limit) : partners;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }

  async getCatalogById(id: string): Promise<SafePartnerCatalog> {
    const partner = await this.prisma.partner.findFirst({
      where: { id, status: 'ACTIVE' },
      select: SAFE_PARTNER_CATALOG_SELECT,
    });

    if (!partner) {
      throw new PartnerNotFoundException();
    }

    return partner;
  }

  async listForAdmin(query: ListPartnersQuery): Promise<{ items: SafePartnerAdmin[]; nextCursor: string | null }> {
    const limit = query.limit ?? PARTNER_LIST_PAGE_SIZE;

    const partners = await this.prisma.partner.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SAFE_PARTNER_ADMIN_SELECT,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = partners.length > limit;
    const page = hasMore ? partners.slice(0, limit) : partners;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }

  async getForAdmin(id: string): Promise<SafePartnerAdmin> {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      select: SAFE_PARTNER_ADMIN_SELECT,
    });

    if (!partner) {
      throw new PartnerNotFoundException();
    }

    return partner;
  }
}
