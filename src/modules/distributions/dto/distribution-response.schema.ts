import { DistributionStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';

export const distributionSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  adminUserId: z.string(),
  csvFileUrl: z.string().nullable(),
  reason: z.string().nullable(),
  totalItems: z.number().int(),
  successItems: z.number().int(),
  failedItems: z.number().int(),
  status: z.nativeEnum(DistributionStatus),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export class DistributionResponseDto extends createZodDto(distributionSchema) {}

export const listDistributionsResponseSchema = paginatedResponseSchema(distributionSchema);
export class ListDistributionsResponseDto extends createZodDto(listDistributionsResponseSchema) {}
