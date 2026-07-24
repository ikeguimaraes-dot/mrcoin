import { Injectable } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateOrganizationInput } from './dto/update-organization.schema';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  getById(organizationId: string): Promise<Organization> {
    return this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
  }

  update(organizationId: string, input: UpdateOrganizationInput): Promise<Organization> {
    return this.prisma.organization.update({
      where: { id: organizationId },
      data: input,
    });
  }
}
