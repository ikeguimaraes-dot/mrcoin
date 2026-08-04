import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { OFFER_LIST_PAGE_SIZE } from './offers.constants';
import { ListOffersQuery } from './dto/list-offers-query.schema';
import { OfferNotFoundException } from './exceptions/offer-not-found.exception';
import { SAFE_OFFER_CATALOG_SELECT, SafeOfferCatalog } from './safe-offer.util';

/** Catálogo de ofertas do coins-app — disponibilidade em DUAS camadas, sempre juntas: a
 * oferta precisa estar ACTIVE E dentro da janela de validade, E o parceiro dono dela precisa
 * estar ACTIVE. Uma oferta ACTIVE de um parceiro INACTIVE nunca aparece; uma oferta com
 * validUntil no passado nunca aparece, mesmo ACTIVE. */
@Injectable()
export class OffersService {
  constructor(private readonly prisma: PrismaService) {}

  async listCatalog(query: ListOffersQuery): Promise<{ items: SafeOfferCatalog[]; nextCursor: string | null }> {
    const limit = query.limit ?? OFFER_LIST_PAGE_SIZE;
    const where = this.availabilityWhere(query.partnerId);

    const offers = await this.prisma.offer.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: SAFE_OFFER_CATALOG_SELECT,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });

    const hasMore = offers.length > limit;
    const page = hasMore ? offers.slice(0, limit) : offers;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }

  async getCatalogById(id: string): Promise<SafeOfferCatalog> {
    const offer = await this.prisma.offer.findFirst({
      where: { id, ...this.availabilityWhere() },
      select: SAFE_OFFER_CATALOG_SELECT,
    });

    if (!offer) {
      throw new OfferNotFoundException();
    }

    return offer;
  }

  private availabilityWhere(partnerId?: string): Prisma.OfferWhereInput {
    const now = new Date();

    return {
      status: 'ACTIVE',
      partner: { status: 'ACTIVE' },
      OR: [{ validFrom: null }, { validFrom: { lte: now } }],
      AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: now } }] }],
      ...(partnerId ? { partnerId } : {}),
    };
  }
}
