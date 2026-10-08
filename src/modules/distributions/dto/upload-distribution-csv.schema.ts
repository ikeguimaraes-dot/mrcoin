import { MembershipType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { recognitionMessageSchema } from './create-distribution.schema';

export const uploadDistributionCsvSchema = z.object({
  membershipType: z.nativeEnum(MembershipType),
  // Reconhecimento único aplicado ao lote inteiro — opcionais no CSV (sem mensagem por linha).
  message: recognitionMessageSchema.optional(),
  organizationValueId: z.string().min(1).optional(),
});

export type UploadDistributionCsvInput = z.infer<typeof uploadDistributionCsvSchema>;
export class UploadDistributionCsvDto extends createZodDto(uploadDistributionCsvSchema) {}
