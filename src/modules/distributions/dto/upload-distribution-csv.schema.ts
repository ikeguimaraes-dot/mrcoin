import { MembershipType } from '@prisma/client';
import { z } from 'zod';

export const uploadDistributionCsvSchema = z.object({
  membershipType: z.nativeEnum(MembershipType),
});

export type UploadDistributionCsvInput = z.infer<typeof uploadDistributionCsvSchema>;
