import { MembershipStatus, MembershipType, UserStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { paginatedResponseSchema } from '../../../common/schemas/paginated-response.schema';

export const memberItemSchema = z.object({
  membershipId: z.string(),
  userId: z.string(),
  name: z.string(),
  membershipStatus: z.nativeEnum(MembershipStatus),
  userStatus: z.nativeEnum(UserStatus),
  membershipType: z.nativeEnum(MembershipType),
  walletBalance: z.number().int(),
  createdAt: z.string().datetime(),
});
export class MemberResponseDto extends createZodDto(memberItemSchema) {}

export const listMembersResponseSchema = paginatedResponseSchema(memberItemSchema);
export class ListMembersResponseDto extends createZodDto(listMembersResponseSchema) {}
