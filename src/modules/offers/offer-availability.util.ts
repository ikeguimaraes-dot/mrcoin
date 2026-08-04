import { Prisma } from '@prisma/client';

/** Filtro de disponibilidade em duas camadas, sempre juntas: a oferta precisa estar ACTIVE E
 * dentro da janela de validade, E o parceiro dono dela precisa estar ACTIVE. Compartilhado
 * entre o catálogo (OffersService) e a criação de resgate (RedemptionsService) — os dois
 * nunca podem divergir sobre o que é "resgatável" nesse instante. */
export function offerAvailabilityWhere(partnerId?: string): Prisma.OfferWhereInput {
  const now = new Date();

  return {
    status: 'ACTIVE',
    partner: { status: 'ACTIVE' },
    OR: [{ validFrom: null }, { validFrom: { lte: now } }],
    AND: [{ OR: [{ validUntil: null }, { validUntil: { gte: now } }] }],
    ...(partnerId ? { partnerId } : {}),
  };
}
