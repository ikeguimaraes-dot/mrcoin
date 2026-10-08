import { Injectable } from '@nestjs/common';
import { OrganizationValue, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrganizationValueInput } from './dto/create-organization-value.schema';
import { UpdateOrganizationValueInput } from './dto/update-organization-value.schema';
import { ListOrganizationValuesQuery } from './dto/organization-value-response.schema';
import {
  OrganizationValueInUseException,
  OrganizationValueNameTakenException,
  OrganizationValueNotFoundException,
} from './exceptions/organization-value.exceptions';

const UNIQUE_CONSTRAINT_ERROR_CODE = 'P2002';
const FOREIGN_KEY_CONSTRAINT_ERROR_CODE = 'P2003';

/**
 * Valores da cultura de cada organização — a própria empresa define a lista no coins-admin.
 * Todo acesso é escopado pelo organizationId do JWT: valor de outra organização se comporta
 * exatamente como um id inexistente (404).
 *
 * Valor já usado em alguma distribuição não pode ser apagado, só desativado. A checagem
 * explícita dá a mensagem certa no caso comum; o FK Restrict de Distribution.organizationValueId
 * cobre a corrida (distribuição criada entre a checagem e o DELETE) — P2003 vira o mesmo 409.
 */
@Injectable()
export class OrganizationValuesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    query: ListOrganizationValuesQuery,
  ): Promise<{ items: OrganizationValue[] }> {
    const items = await this.prisma.organizationValue.findMany({
      where: { organizationId, ...(query.includeInactive === 'true' ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return { items };
  }

  async create(
    organizationId: string,
    input: CreateOrganizationValueInput,
  ): Promise<OrganizationValue> {
    const sortOrder = input.sortOrder ?? (await this.nextSortOrder(organizationId));

    return this.translateUniqueViolation(() =>
      this.prisma.organizationValue.create({
        data: { organizationId, name: input.name, description: input.description, sortOrder },
      }),
    );
  }

  async update(
    organizationId: string,
    id: string,
    input: UpdateOrganizationValueInput,
  ): Promise<OrganizationValue> {
    await this.findOwnedOrThrow(organizationId, id);

    return this.translateUniqueViolation(() =>
      this.prisma.organizationValue.update({
        where: { id },
        data: {
          name: input.name,
          description: input.description,
          sortOrder: input.sortOrder,
          isActive: input.isActive,
        },
      }),
    );
  }

  async remove(organizationId: string, id: string): Promise<void> {
    await this.findOwnedOrThrow(organizationId, id);

    const usageCount = await this.prisma.distribution.count({ where: { organizationValueId: id } });
    if (usageCount > 0) {
      throw new OrganizationValueInUseException();
    }

    try {
      await this.prisma.organizationValue.delete({ where: { id } });
    } catch (error) {
      if (isPrismaError(error, FOREIGN_KEY_CONSTRAINT_ERROR_CODE)) {
        throw new OrganizationValueInUseException();
      }
      throw error;
    }
  }

  private async findOwnedOrThrow(organizationId: string, id: string): Promise<OrganizationValue> {
    const value = await this.prisma.organizationValue.findFirst({ where: { id, organizationId } });
    if (!value) {
      throw new OrganizationValueNotFoundException();
    }
    return value;
  }

  private async nextSortOrder(organizationId: string): Promise<number> {
    const aggregate = await this.prisma.organizationValue.aggregate({
      where: { organizationId },
      _max: { sortOrder: true },
    });
    return (aggregate._max.sortOrder ?? 0) + 1;
  }

  private async translateUniqueViolation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (isPrismaError(error, UNIQUE_CONSTRAINT_ERROR_CODE)) {
        throw new OrganizationValueNameTakenException();
      }
      throw error;
    }
  }
}

function isPrismaError(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}
