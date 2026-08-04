import { Prisma } from '@prisma/client';

/** Shape de Offer pro catálogo do app — partner vem aninhado com o mesmo narrowing do
 * catálogo de Partner (nunca pixKey/takeRateBps por relação). */
export const SAFE_OFFER_CATALOG_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  costInCoins: true,
  validFrom: true,
  validUntil: true,
  perUserLimit: true,
  partner: { select: { id: true, name: true, category: true } },
} satisfies Prisma.OfferSelect;

export type SafeOfferCatalog = Prisma.OfferGetPayload<{ select: typeof SAFE_OFFER_CATALOG_SELECT }>;
