import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { hashPassword } from '../../auth/password.util';
import { PlatformAdminAuditService } from '../platform-admin-audit.service';
import { PartnerTokenService } from '../../partners/partner-token.service';
import { generatePartnerPassword } from '../../partners/partner-credential.util';
import { PartnerCnpjAlreadyInUseException } from '../../partners/exceptions/partner-cnpj-in-use.exception';
import { PartnerEmailAlreadyInUseException } from '../../partners/exceptions/partner-email-in-use.exception';
import { PartnerNotFoundException } from '../../partners/exceptions/partner-not-found.exception';
import { SAFE_PARTNER_PLATFORM_SELECT, SafePartnerPlatform } from '../../partners/safe-partner.util';
import { CreatePartnerInput } from './dto/create-partner.schema';
import { UpdatePlatformPartnerInput } from './dto/update-partner.schema';

export interface PartnerSummary extends SafePartnerPlatform {
  offerCount: number;
  confirmedRedemptionCount: number;
}

export interface CreatePartnerResult extends SafePartnerPlatform {
  credential: { password: string };
}

/**
 * CRUD de Partner pra PlatformAdmin — Partner é platform-wide (sem organizationId), sem
 * fluxo de convite/aceite como Organization/AdminInvite: a senha nasce no servidor e volta
 * uma única vez na resposta HTTP (create e reset-password), nunca persistida em claro nem
 * logada.
 */
@Injectable()
export class PlatformPartnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: PlatformAdminAuditService,
    private readonly partnerTokenService: PartnerTokenService,
  ) {}

  async create(platformAdminId: string, input: CreatePartnerInput, ip: string | undefined): Promise<CreatePartnerResult> {
    const contactEmail = input.contactEmail.toLowerCase();

    const existingByCnpj = await this.prisma.partner.findUnique({ where: { cnpj: input.cnpj } });
    if (existingByCnpj) {
      throw new PartnerCnpjAlreadyInUseException();
    }

    const existingByEmail = await this.prisma.partner.findFirst({ where: { contactEmail } });
    if (existingByEmail) {
      throw new PartnerEmailAlreadyInUseException();
    }

    const password = generatePartnerPassword();
    const passwordHash = await hashPassword(password);

    const partner = await this.prisma.partner.create({
      data: {
        name: input.name,
        cnpj: input.cnpj,
        category: input.category,
        takeRateBps: input.takeRateBps,
        pixKey: input.pixKey,
        contactEmail,
        contactPhone: input.contactPhone,
        latitude: input.latitude,
        longitude: input.longitude,
        passwordHash,
      },
      select: SAFE_PARTNER_PLATFORM_SELECT,
    });

    await this.auditService.record({
      platformAdminId,
      action: 'PARTNER_CREATED',
      payload: { partnerId: partner.id, cnpj: partner.cnpj, contactEmail },
      ip,
    });

    return { ...partner, credential: { password } };
  }

  async list(options?: {
    cursor?: string;
    limit?: number;
  }): Promise<{ items: PartnerSummary[]; nextCursor: string | null }> {
    const limit = options?.limit ?? 20;
    const partners = await this.prisma.partner.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: SAFE_PARTNER_PLATFORM_SELECT,
    });

    const hasMore = partners.length > limit;
    const page = hasMore ? partners.slice(0, limit) : partners;
    const last = page[page.length - 1];

    const items = await Promise.all(page.map((partner) => this.toSummary(partner)));

    return { items, nextCursor: hasMore && last ? last.id : null };
  }

  async getById(partnerId: string): Promise<PartnerSummary> {
    const partner = await this.prisma.partner.findUnique({
      where: { id: partnerId },
      select: SAFE_PARTNER_PLATFORM_SELECT,
    });

    if (!partner) {
      throw new PartnerNotFoundException();
    }

    return this.toSummary(partner);
  }

  async update(
    platformAdminId: string,
    partnerId: string,
    input: UpdatePlatformPartnerInput,
    ip: string | undefined,
  ): Promise<PartnerSummary> {
    const existing = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!existing) {
      throw new PartnerNotFoundException();
    }

    const partner = await this.prisma.partner.update({
      where: { id: partnerId },
      data: input,
      select: SAFE_PARTNER_PLATFORM_SELECT,
    });

    await this.auditService.record({
      platformAdminId,
      action: 'PARTNER_UPDATED',
      payload: { partnerId, changes: input },
      ip,
    });

    return this.toSummary(partner);
  }

  async resetPassword(
    platformAdminId: string,
    partnerId: string,
    ip: string | undefined,
  ): Promise<{ credential: { password: string } }> {
    const existing = await this.prisma.partner.findUnique({ where: { id: partnerId } });
    if (!existing) {
      throw new PartnerNotFoundException();
    }

    const password = generatePartnerPassword();
    const passwordHash = await hashPassword(password);

    await this.prisma.partner.update({ where: { id: partnerId }, data: { passwordHash } });
    await this.partnerTokenService.revokeAllForPartner(partnerId);

    await this.auditService.record({
      platformAdminId,
      action: 'PARTNER_PASSWORD_RESET',
      payload: { partnerId },
      ip,
    });

    return { credential: { password } };
  }

  private async toSummary(partner: SafePartnerPlatform): Promise<PartnerSummary> {
    const [offerCount, confirmedRedemptionCount] = await Promise.all([
      this.prisma.offer.count({ where: { partnerId: partner.id } }),
      // DELIVERED é uma continuação de um CONFIRMED (já debitado) — conta igual.
      this.prisma.redemption.count({ where: { partnerId: partner.id, status: { in: ['CONFIRMED', 'DELIVERED'] } } }),
    ]);

    return { ...partner, offerCount, confirmedRedemptionCount };
  }
}
