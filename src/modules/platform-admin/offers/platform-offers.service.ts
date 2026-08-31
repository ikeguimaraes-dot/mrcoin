import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformAdminAuditService } from '../platform-admin-audit.service';
import { OfferNotFoundException } from '../../offers/exceptions/offer-not-found.exception';
import { PartnerNotFoundException } from '../../partners/exceptions/partner-not-found.exception';
import { SAFE_OFFER_PLATFORM_SELECT, SafeOfferPlatform } from '../../offers/safe-offer.util';
import { CreateOfferInput } from './dto/create-offer.schema';
import { UpdatePlatformOfferInput } from './dto/update-offer.schema';

/**
 * CRUD de Offer pra PlatformAdmin — sem credencial/convite (diferente de organizations e
 * partners), a única validação de negócio extra é a integridade referencial: toda oferta
 * pertence a um Partner existente.
 */
@Injectable()
export class PlatformOffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  async create(
    platformAdminId: string,
    input: CreateOfferInput,
    ip: string | undefined,
  ): Promise<SafeOfferPlatform> {
    const partner = await this.prisma.partner.findUnique({ where: { id: input.partnerId } });
    if (!partner) {
      throw new PartnerNotFoundException();
    }

    const offer = await this.prisma.offer.create({
      data: {
        partnerId: input.partnerId,
        title: input.title,
        description: input.description,
        category: input.category,
        costInCoins: input.costInCoins,
        imageUrl: input.imageUrl,
        validFrom: input.validFrom,
        validUntil: input.validUntil,
        perUserLimit: input.perUserLimit,
      },
      select: SAFE_OFFER_PLATFORM_SELECT,
    });

    await this.auditService.record({
      platformAdminId,
      action: 'OFFER_CREATED',
      payload: { offerId: offer.id, partnerId: offer.partnerId },
      ip,
    });

    return offer;
  }

  async list(options?: {
    cursor?: string;
    limit?: number;
    partnerId?: string;
  }): Promise<{ items: SafeOfferPlatform[]; nextCursor: string | null }> {
    const limit = options?.limit ?? 20;
    const offers = await this.prisma.offer.findMany({
      where: options?.partnerId ? { partnerId: options.partnerId } : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: SAFE_OFFER_PLATFORM_SELECT,
    });

    const hasMore = offers.length > limit;
    const page = hasMore ? offers.slice(0, limit) : offers;
    const last = page[page.length - 1];

    return { items: page, nextCursor: hasMore && last ? last.id : null };
  }

  async getById(offerId: string): Promise<SafeOfferPlatform> {
    const offer = await this.prisma.offer.findUnique({
      where: { id: offerId },
      select: SAFE_OFFER_PLATFORM_SELECT,
    });

    if (!offer) {
      throw new OfferNotFoundException();
    }

    return offer;
  }

  async update(
    platformAdminId: string,
    offerId: string,
    input: UpdatePlatformOfferInput,
    ip: string | undefined,
  ): Promise<SafeOfferPlatform> {
    const existing = await this.prisma.offer.findUnique({ where: { id: offerId } });
    if (!existing) {
      throw new OfferNotFoundException();
    }

    const offer = await this.prisma.offer.update({
      where: { id: offerId },
      data: input,
      select: SAFE_OFFER_PLATFORM_SELECT,
    });

    await this.auditService.record({
      platformAdminId,
      action: 'OFFER_UPDATED',
      payload: { offerId, changes: input },
      ip,
    });

    return offer;
  }
}
