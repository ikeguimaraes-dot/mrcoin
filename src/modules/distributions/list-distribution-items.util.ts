import { PrismaService } from '../../prisma/prisma.service';
import { DISTRIBUTION_ITEM_PAGE_SIZE } from './distributions.constants';
import { SAFE_DISTRIBUTION_ITEM_SELECT, SafeDistributionItem } from './safe-distribution-item.util';

/** Paginação por cursor dos itens de uma Distribution, em ordem de linha do CSV (a mais
 * antiga primeiro) — compartilhado entre a resposta do upload e o GET de progresso. */
export async function listDistributionItems(
  prisma: PrismaService,
  distributionId: string,
  cursor: string | undefined,
  limit: number = DISTRIBUTION_ITEM_PAGE_SIZE,
): Promise<{ items: SafeDistributionItem[]; nextCursor: string | null }> {
  const items = await prisma.distributionItem.findMany({
    where: { distributionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit + 1,
    select: SAFE_DISTRIBUTION_ITEM_SELECT,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > limit;
  const page = hasMore ? items.slice(0, limit) : items;
  const last = page[page.length - 1];

  return { items: page, nextCursor: hasMore && last ? last.id : null };
}
