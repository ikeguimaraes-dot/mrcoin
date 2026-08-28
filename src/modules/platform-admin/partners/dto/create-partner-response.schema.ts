import { PartnerStatus } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createPartnerResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  cnpj: z.string(),
  category: z.string(),
  takeRateBps: z.number().int(),
  pixKey: z.string(),
  status: z.nativeEnum(PartnerStatus),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  credential: z.object({
    password: z.string(),
  }),
});

export class CreatePartnerResponseDto extends createZodDto(createPartnerResponseSchema) {}
