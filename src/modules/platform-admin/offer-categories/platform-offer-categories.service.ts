import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { PlatformAdminAuditService } from '../platform-admin-audit.service';
import {
  CreateOfferCategoryInput,
  ListOfferCategoriesQuery,
  UpdateOfferCategoryInput,
} from './dto/offer-category.schema';

@Injectable()
export class PlatformOfferCategoriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: PlatformAdminAuditService,
  ) {}

  async list(query: ListOfferCategoriesQuery) {
    const items = await this.prisma.offerCategory.findMany({
      where: query.includeInactive === 'true' ? undefined : { active: true },
      orderBy: [{ name: 'asc' }],
    });
    return { items };
  }

  async create(platformAdminId: string, input: CreateOfferCategoryInput, ip?: string) {
    const category = await this.translateUniqueViolation(() =>
      this.prisma.offerCategory.create({ data: input }),
    );
    await this.auditService.record({
      platformAdminId,
      action: 'OFFER_CATEGORY_CREATED',
      payload: { categoryId: category.id },
      ip,
    });
    return category;
  }

  async update(platformAdminId: string, id: string, input: UpdateOfferCategoryInput, ip?: string) {
    await this.findOrThrow(id);
    const category = await this.translateUniqueViolation(() =>
      this.prisma.offerCategory.update({ where: { id }, data: input }),
    );
    await this.auditService.record({
      platformAdminId,
      action: 'OFFER_CATEGORY_UPDATED',
      payload: { categoryId: id, changes: input },
      ip,
    });
    return category;
  }

  async remove(platformAdminId: string, id: string, ip?: string): Promise<void> {
    await this.findOrThrow(id);
    if ((await this.prisma.offer.count({ where: { categoryData: { id } } })) > 0) {
      throw new ConflictException('Categoria em uso; desative-a em vez de removê-la.');
    }
    await this.prisma.offerCategory.delete({ where: { id } });
    await this.auditService.record({
      platformAdminId,
      action: 'OFFER_CATEGORY_DELETED',
      payload: { categoryId: id },
      ip,
    });
  }

  private async findOrThrow(id: string) {
    const category = await this.prisma.offerCategory.findUnique({ where: { id } });
    if (!category) throw new NotFoundException('Categoria de oferta não encontrada.');
    return category;
  }

  private async translateUniqueViolation<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Já existe uma categoria com esse nome ou slug.');
      }
      throw error;
    }
  }
}
