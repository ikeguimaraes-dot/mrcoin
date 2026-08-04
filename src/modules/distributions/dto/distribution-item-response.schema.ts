import { DistributionItemStatus, MembershipType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';
import { ledgerEntryItemSchema } from '../../ledger/dto/ledger-entry-response.schema';
import { distributionSchema } from './distribution-response.schema';

export const distributionItemSchema = z.object({
  id: z.string(),
  distributionId: z.string(),
  membershipId: z.string().nullable(),
  amount: z.number().int(),
  status: z.nativeEnum(DistributionItemStatus),
  errorReason: z.string().nullable(),
  name: z.string().nullable(),
  membershipType: z.nativeEnum(MembershipType).nullable(),
  externalRef: z.string().nullable(),
  createdAt: z.string().datetime(),
});

export const listDistributionItemsResponseSchema = paginatedResponseSchema(distributionItemSchema);
export class ListDistributionItemsResponseDto extends createZodDto(listDistributionItemsResponseSchema) {}

/** Mesmo shape que GET /admin/distributions/:id (progresso) e POST /admin/distributions/csv
 * (preview do upload) devolvem — a distribuição + suas linhas paginadas. */
export const distributionWithItemsResponseSchema = z.object({
  distribution: distributionSchema,
  items: listDistributionItemsResponseSchema,
});
export class DistributionWithItemsResponseDto extends createZodDto(distributionWithItemsResponseSchema) {}

export const distributeIndividualResponseSchema = z.object({
  distribution: distributionSchema,
  item: distributionItemSchema.extend({ ledgerEntries: z.array(ledgerEntryItemSchema) }),
});
export class DistributeIndividualResponseDto extends createZodDto(distributeIndividualResponseSchema) {}
