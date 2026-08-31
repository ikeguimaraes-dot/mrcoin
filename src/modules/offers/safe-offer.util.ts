import { Prisma } from '@prisma/client';

/** Shape de Offer pro catálogo do app — partner vem aninhado com o mesmo narrowing do
 * catálogo de Partner (nunca pixKey/takeRateBps por relação). */
export const SAFE_OFFER_CATALOG_SELECT = {
  id: true,
  title: true,
  description: true,
  category: true,
  costInCoins: true,
  imageUrl: true,
  validFrom: true,
  validUntil: true,
  perUserLimit: true,
  partner: { select: { id: true, name: true, category: true } },
} satisfies Prisma.OfferSelect;

export type SafeOfferCatalog = Prisma.OfferGetPayload<{ select: typeof SAFE_OFFER_CATALOG_SELECT }>;

/** Shape de Offer pro CRUD de platform admin — vê tudo (qualquer status, dentro ou fora da
 * janela de validade), diferente do catálogo público. partnerId cru + partner aninhado
 * (id, name) só pra exibição, sem pixKey/takeRateBps. */
export const SAFE_OFFER_PLATFORM_SELECT = {
  id: true,
  partnerId: true,
  title: true,
  description: true,
  category: true,
  costInCoins: true,
  imageUrl: true,
  validFrom: true,
  validUntil: true,
  perUserLimit: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  partner: { select: { id: true, name: true } },
} satisfies Prisma.OfferSelect;

export type SafeOfferPlatform = Prisma.OfferGetPayload<{ select: typeof SAFE_OFFER_PLATFORM_SELECT }>;
