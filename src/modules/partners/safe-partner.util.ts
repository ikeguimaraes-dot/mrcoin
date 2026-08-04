import { Prisma } from '@prisma/client';

/**
 * Dois shapes seguros de Partner — nenhum dos dois inclui pixKey (chave de pagamento) nem
 * takeRateBps (comissão negociada): termos comerciais/financeiros do parceiro com a
 * plataforma, que não fazem sentido no catálogo público (o app não tem por que saber) nem
 * no endpoint admin genérico (sem um conceito de "admin de plataforma" hoje, não dá pra
 * assumir que o OWNER de uma organização cliente qualquer deveria ver isso de outra
 * empresa). Ficam só no banco, lidos internamente quando o módulo de settlements existir.
 */
export const SAFE_PARTNER_CATALOG_SELECT = {
  id: true,
  name: true,
  category: true,
  latitude: true,
  longitude: true,
} satisfies Prisma.PartnerSelect;

export type SafePartnerCatalog = Prisma.PartnerGetPayload<{ select: typeof SAFE_PARTNER_CATALOG_SELECT }>;

export const SAFE_PARTNER_ADMIN_SELECT = {
  id: true,
  name: true,
  cnpj: true,
  category: true,
  status: true,
  contactEmail: true,
  contactPhone: true,
  latitude: true,
  longitude: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.PartnerSelect;

export type SafePartnerAdmin = Prisma.PartnerGetPayload<{ select: typeof SAFE_PARTNER_ADMIN_SELECT }>;
