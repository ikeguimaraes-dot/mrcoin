import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { Env } from '../../../config/env.schema';
import { PlatformAdminAuditService } from '../platform-admin-audit.service';
import { ConversionRateService } from '../../settings/conversion-rate.service';
import { createOrganizationWithOwnerInvite } from '../../organizations/create-organization-with-owner';
import { SAFE_ORGANIZATION_SELECT, SafeOrganization } from '../../organizations/safe-organization.util';
import { CreateOrganizationInput } from './dto/create-organization.schema';
import { UpdatePlatformOrganizationInput } from './dto/update-organization.schema';
import { UpdateConversionRateInput } from './dto/conversion-rate.schema';

export interface ConversionRateSummary {
  coinsPerReal: number;
  coinsPerRealScaled: number;
  effectiveSince: Date;
}

export interface OrganizationSummary {
  id: string;
  name: string;
  cnpj: string;
  status: string;
  plan: string;
  adminUserCount: number;
  memberCount: number;
  circulatingBalance: number;
  // null só deveria acontecer numa organização criada fora do caminho normal (nunca em
  // produção — createOrganizationWithOwnerInvite sempre cria a taxa na mesma transação).
  // Fica nullable aqui pra uma organização assim nunca derrubar a listagem inteira.
  conversionRate: ConversionRateSummary | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateOrganizationResult extends SafeOrganization {
  invite: { id: string; expiresAt: Date; inviteLink: string };
  conversionRate: ConversionRateSummary;
}

/**
 * CRUD de Organization pra PlatformAdmin — sempre platform-wide (nunca escopado por
 * organizationId de chamador, ao contrário de OrganizationsService). Criação reaproveita
 * createOrganizationWithOwnerInvite (mesma lógica de bootstrap-owner.ts).
 */
@Injectable()
export class PlatformOrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService<Env, true>,
    private readonly auditService: PlatformAdminAuditService,
    private readonly conversionRateService: ConversionRateService,
  ) {}

  async create(
    platformAdminId: string,
    input: CreateOrganizationInput,
    ip: string | undefined,
  ): Promise<CreateOrganizationResult> {
    const adminPanelUrl = this.configService.get('ADMIN_PANEL_URL', { infer: true });
    const { organization, invite, conversionRate } = await createOrganizationWithOwnerInvite(
      this.prisma,
      input,
      adminPanelUrl,
    );

    await this.auditService.record({
      platformAdminId,
      action: 'ORGANIZATION_CREATED',
      payload: {
        organizationId: organization.id,
        cnpj: organization.cnpj,
        ownerEmail: input.ownerEmail,
        coinsPerReal: conversionRate.coinsPerRealScaled / 100,
      },
      ip,
    });

    return {
      id: organization.id,
      name: organization.name,
      cnpj: organization.cnpj,
      status: organization.status,
      plan: organization.plan,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
      invite: { id: invite.id, expiresAt: invite.expiresAt, inviteLink: invite.inviteLink },
      conversionRate: {
        coinsPerReal: conversionRate.coinsPerRealScaled / 100,
        coinsPerRealScaled: conversionRate.coinsPerRealScaled,
        effectiveSince: conversionRate.createdAt,
      },
    };
  }

  async list(options?: {
    cursor?: string;
    limit?: number;
  }): Promise<{ items: OrganizationSummary[]; nextCursor: string | null }> {
    const limit = options?.limit ?? 20;
    const organizations = await this.prisma.organization.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(options?.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
      select: SAFE_ORGANIZATION_SELECT,
    });

    const hasMore = organizations.length > limit;
    const page = hasMore ? organizations.slice(0, limit) : organizations;
    const last = page[page.length - 1];

    const items = await Promise.all(page.map((organization) => this.toSummary(organization)));

    return { items, nextCursor: hasMore && last ? last.id : null };
  }

  async getById(organizationId: string): Promise<OrganizationSummary> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: SAFE_ORGANIZATION_SELECT,
    });

    if (!organization) {
      throw new NotFoundException();
    }

    return this.toSummary(organization);
  }

  async update(
    platformAdminId: string,
    organizationId: string,
    input: UpdatePlatformOrganizationInput,
    ip: string | undefined,
  ): Promise<OrganizationSummary> {
    const existing = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!existing) {
      throw new NotFoundException();
    }

    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: input,
      select: SAFE_ORGANIZATION_SELECT,
    });

    await this.auditService.record({
      platformAdminId,
      action: 'ORGANIZATION_UPDATED',
      payload: { organizationId, changes: input },
      ip,
    });

    return this.toSummary(organization);
  }

  async getConversionRate(organizationId: string): Promise<ConversionRateSummary> {
    await this.getExistingOrThrow(organizationId);
    const rate = await this.conversionRateService.getCurrentRateForOrganization(organizationId);
    return {
      coinsPerReal: rate.coinsPerRealScaled / 100,
      coinsPerRealScaled: rate.coinsPerRealScaled,
      effectiveSince: rate.createdAt,
    };
  }

  async updateConversionRate(
    platformAdminId: string,
    organizationId: string,
    input: UpdateConversionRateInput,
    ip: string | undefined,
  ): Promise<ConversionRateSummary> {
    await this.getExistingOrThrow(organizationId);

    const previous = await this.conversionRateService.getCurrentRateForOrganization(organizationId);
    const coinsPerRealScaled = Math.round(input.coinsPerReal * 100);
    const updated = await this.conversionRateService.setRateForOrganization(organizationId, coinsPerRealScaled);

    await this.auditService.record({
      platformAdminId,
      action: 'CONVERSION_RATE_UPDATED',
      payload: {
        organizationId,
        previousCoinsPerReal: previous.coinsPerRealScaled / 100,
        newCoinsPerReal: coinsPerRealScaled / 100,
      },
      ip,
    });

    return {
      coinsPerReal: updated.coinsPerRealScaled / 100,
      coinsPerRealScaled: updated.coinsPerRealScaled,
      effectiveSince: updated.createdAt,
    };
  }

  private async getExistingOrThrow(organizationId: string): Promise<void> {
    const existing = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!existing) {
      throw new NotFoundException();
    }
  }

  private async toSummary(organization: SafeOrganization): Promise<OrganizationSummary> {
    const [adminUserCount, memberCount, walletAgg, rate] = await Promise.all([
      this.prisma.adminUser.count({ where: { organizationId: organization.id } }),
      this.prisma.membership.count({ where: { organizationId: organization.id } }),
      this.prisma.wallet.aggregate({
        _sum: { cachedBalance: true },
        where: { membership: { organizationId: organization.id } },
      }),
      // OrNull de propósito: isto alimenta a listagem (list()/getById()/update()) — uma
      // organização sem taxa (não deveria existir fora de teste) não pode derrubar a página
      // inteira com 500. Contextos onde a taxa é obrigatória (compra de lote, endpoint
      // dedicado /conversion-rate) continuam usando a variante que lança.
      this.conversionRateService.getCurrentRateForOrganizationOrNull(organization.id),
    ]);

    return {
      id: organization.id,
      name: organization.name,
      cnpj: organization.cnpj,
      status: organization.status,
      plan: organization.plan,
      adminUserCount,
      memberCount,
      circulatingBalance: walletAgg._sum.cachedBalance ?? 0,
      conversionRate: rate
        ? { coinsPerReal: rate.coinsPerRealScaled / 100, coinsPerRealScaled: rate.coinsPerRealScaled, effectiveSince: rate.createdAt }
        : null,
      createdAt: organization.createdAt,
      updatedAt: organization.updatedAt,
    };
  }
}
