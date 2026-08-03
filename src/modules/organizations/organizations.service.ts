import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateOrganizationInput } from './dto/update-organization.schema';
import { SAFE_ORGANIZATION_SELECT, SafeOrganization } from './safe-organization.util';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  getById(organizationId: string): Promise<SafeOrganization> {
    return this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: SAFE_ORGANIZATION_SELECT,
    });
  }

  update(organizationId: string, input: UpdateOrganizationInput): Promise<SafeOrganization> {
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: input,
      select: SAFE_ORGANIZATION_SELECT,
    });
  }
}
