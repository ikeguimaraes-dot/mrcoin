import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const requestAccountDeletionSchema = z
  .object({
    password: z.string().min(1).max(256),
    confirmDeletion: z.literal(true),
  })
  .strict();
export type RequestAccountDeletionInput = z.infer<typeof requestAccountDeletionSchema>;
export class RequestAccountDeletionDto extends createZodDto(requestAccountDeletionSchema) {}

export const accountDeletionResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['PENDING', 'COMPLETED']),
  requestedAt: z.string().datetime(),
  deadlineAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});
export class AccountDeletionResponseDto extends createZodDto(accountDeletionResponseSchema) {}
export class AccountDeletionStatusDto extends createZodDto(
  z.object({ request: accountDeletionResponseSchema.nullable() }),
) {}

export const completeAccountDeletionSchema = z
  .object({
    // Operador deve conferir a necessidade de conservação antes de concluir.
    retentionReason: z.string().trim().min(20).max(2000),
    confirmReview: z.literal(true),
  })
  .strict();
export class CompleteAccountDeletionDto extends createZodDto(completeAccountDeletionSchema) {}

export class AccountDeletionQueueDto extends createZodDto(
  z.object({
    items: z.array(
      z.object({
        id: z.string(),
        userId: z.string(),
        requestedAt: z.string().datetime(),
        deadlineAt: z.string().datetime(),
        completedAt: z.string().datetime().nullable(),
        notificationSentAt: z.string().datetime().nullable(),
      }),
    ),
    nextCursor: z.string().nullable(),
  }),
) {}

export class AccountDeletionReviewDto extends createZodDto(
  z.object({
    id: z.string(),
    userId: z.string(),
    userName: z.string(),
    contactEmail: z.string().nullable(),
    deadlineAt: z.string().datetime(),
    completedAt: z.string().datetime().nullable(),
    retentionReason: z.string().nullable(),
    ledgerEntries: z.number().int(),
    pendingRedemptions: z.number().int(),
    wallets: z.array(z.object({ organizationName: z.string(), balance: z.number().int() })),
  }),
) {}
