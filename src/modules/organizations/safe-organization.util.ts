import { Prisma } from '@prisma/client';

/** Shape de Organization seguro pra sair em resposta HTTP — nunca asaasCustomerId
 * (referência interna do PSP; billing.service.ts lê o campo real direto do banco,
 * numa query própria, nunca a partir desta resposta). */
export const SAFE_ORGANIZATION_SELECT = {
  id: true,
  name: true,
  cnpj: true,
  status: true,
  plan: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.OrganizationSelect;

export type SafeOrganization = Prisma.OrganizationGetPayload<{ select: typeof SAFE_ORGANIZATION_SELECT }>;
