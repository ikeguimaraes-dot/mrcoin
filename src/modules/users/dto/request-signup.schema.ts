import { MembershipType } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * organizationId/membershipType são opcionais: omitidos = claim de um User PENDING_CLAIM
 * já existente (prova só o CPF; a Membership já existe, criada pela distribuição). Quando
 * organizationId vem preenchido, membershipType é obrigatório junto (signup novo numa
 * organização específica) — validado no .refine() abaixo.
 */
export const requestSignupSchema = z
  .object({
    cpf: z.string().regex(/^\d{11}$/, 'CPF deve conter 11 dígitos numéricos.'),
    name: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1).optional(),
    organizationId: z.string().min(1).optional(),
    membershipType: z.nativeEnum(MembershipType).optional(),
    externalRef: z.string().min(1).optional(),
  })
  .refine((data) => !data.organizationId || data.membershipType, {
    message: 'membershipType é obrigatório quando organizationId é informado.',
    path: ['membershipType'],
  });

export type RequestSignupInput = z.infer<typeof requestSignupSchema>;
export class RequestSignupDto extends createZodDto(requestSignupSchema) {}
