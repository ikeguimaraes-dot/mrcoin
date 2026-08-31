import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ConversionRateService } from '../settings/conversion-rate.service';
import { UpdateOrganizationInput } from './dto/update-organization.schema';
import { SAFE_ORGANIZATION_SELECT, SafeOrganization } from './safe-organization.util';

export interface OrganizationWithConversionRate extends SafeOrganization {
  conversionRate: { coinsPerReal: number; effectiveSince: Date };
}

@Injectable()
export class OrganizationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly conversionRateService: ConversionRateService,
  ) {}

  async getById(organizationId: string): Promise<OrganizationWithConversionRate> {
    const [organization, rate] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: SAFE_ORGANIZATION_SELECT,
      }),
      this.conversionRateService.getCurrentRateForOrganization(organizationId),
    ]);

    return {
      ...organization,
      conversionRate: { coinsPerReal: rate.coinsPerRealScaled / 100, effectiveSince: rate.createdAt },
    };
  }

  async update(organizationId: string, input: UpdateOrganizationInput): Promise<OrganizationWithConversionRate> {
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: input,
      select: SAFE_ORGANIZATION_SELECT,
    });

    // Reusa getById em vez de duplicar a busca da taxa — update() não mexe na taxa, só
    // devolve o snapshot completo (org + taxa vigente) de novo, mesmo shape de getById.
    return this.getById(organizationId);
  }
}
