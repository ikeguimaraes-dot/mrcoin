import { MembershipStatus, MembershipType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const membershipListItemSchema = z.object({
  organizationId: z.string(),
  organizationName: z.string(),
  membershipType: z.nativeEnum(MembershipType),
  membershipStatus: z.nativeEnum(MembershipStatus),
  walletBalance: z.number().int(),
});

export type MembershipListItem = z.infer<typeof membershipListItemSchema>;

export const membershipListResponseSchema = z.array(membershipListItemSchema);
export class MembershipListResponseDto extends createZodDto(membershipListResponseSchema) {}
