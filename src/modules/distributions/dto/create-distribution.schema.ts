import { MembershipType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RECOGNITION_MESSAGE_MAX_LENGTH } from '../distributions.constants';

/** Reconhecimento: mensagem de quem distribui (compartilhado com o upload de CSV). */
export const recognitionMessageSchema = z.string().trim().min(1).max(RECOGNITION_MESSAGE_MAX_LENGTH);

export const createDistributionSchema = z.object({
  cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
  name: z.string().min(1),
  amount: z.number().int().positive(),
  membershipType: z.nativeEnum(MembershipType),
  externalRef: z.string().optional(),
  // Passo 1 do rollout do reconhecimento: message/organizationValueId opcionais até o
  // coins-admin enviar os dois; depois viram obrigatórios.
  message: recognitionMessageSchema.optional(),
  organizationValueId: z.string().min(1).optional(),
  /** @deprecated substituído por `message` — aceito só até message virar obrigatório. */
  reason: z.string().trim().min(1).max(500).optional(),
});

export type CreateDistributionInput = z.infer<typeof createDistributionSchema>;
export class CreateDistributionDto extends createZodDto(createDistributionSchema) {}
