import { AdminRole, MembershipType, PrismaClient } from '@prisma/client';
import { encryptCpf, hashCpf } from '../src/common/crypto/cpf-crypto.util';
import { hashPassword } from '../src/modules/auth/password.util';
import { generateFakeCpf } from './cpf.fixture';

const prisma = new PrismaClient();

/** Só para dev local — troque numa conta real antes de qualquer coisa que não seja seed. */
const SEED_ADMIN_PASSWORD = 'DevPassword123!';

/** Login do portal do parceiro (coins-partner) — só a Livraria Capítulo tem credencial
 * provisionada por enquanto (é o parceiro usado nos testes manuais do fluxo de confirmar
 * resgate). Os outros dois parceiros ficam com passwordHash nulo — sem acesso ao portal
 * até serem provisionados também. */
const SEED_PARTNER_PASSWORD = 'DevPartnerPassword123!';

const USERS_COUNT = 20;

const PARTNERS = [
  {
    name: 'Padaria Boa Hora',
    cnpj: '11111111000191',
    category: 'Alimentação',
    takeRateBps: 500,
    pixKey: 'padaria@boahora.com.br',
    contactEmail: 'contato@boahora.com.br',
    contactPhone: '11988880001',
    password: null,
    offers: [
      {
        title: '10% de desconto no café da manhã',
        costInCoins: 150,
        imageUrl: 'https://picsum.photos/seed/padaria-cafe/600/400',
      },
      {
        title: 'Pão francês grátis a cada 10 compras',
        costInCoins: 300,
        imageUrl: 'https://picsum.photos/seed/padaria-pao/600/400',
      },
    ],
  },
  {
    name: 'Academia Vigor',
    cnpj: '22222222000191',
    category: 'Saúde e bem-estar',
    takeRateBps: 800,
    pixKey: 'financeiro@vigor.com.br',
    contactEmail: 'contato@vigor.com.br',
    contactPhone: '11988880002',
    password: null,
    offers: [
      {
        title: '1 mês de mensalidade com desconto',
        costInCoins: 2000,
        imageUrl: 'https://picsum.photos/seed/academia-mensalidade/600/400',
      },
      {
        title: 'Avaliação física gratuita',
        costInCoins: 500,
        imageUrl: 'https://picsum.photos/seed/academia-avaliacao/600/400',
      },
    ],
  },
  {
    name: 'Livraria Capítulo',
    cnpj: '33333333000191',
    category: 'Cultura',
    takeRateBps: 600,
    pixKey: 'contato@capitulo.com.br',
    contactEmail: 'atendimento@capitulo.com.br',
    contactPhone: '11988880003',
    password: SEED_PARTNER_PASSWORD,
    offers: [
      {
        title: '15% de desconto em livros',
        costInCoins: 400,
        imageUrl: 'https://picsum.photos/seed/livraria-desconto/600/400',
      },
      {
        title: 'Frete grátis na primeira compra',
        costInCoins: 100,
        imageUrl: 'https://picsum.photos/seed/livraria-frete/600/400',
      },
      {
        title: 'Clube do livro — 1 mês grátis',
        costInCoins: 800,
        imageUrl: 'https://picsum.photos/seed/livraria-clube/600/400',
      },
    ],
  },
];

async function seedOrganization() {
  return prisma.organization.upsert({
    where: { cnpj: '00000000000191' },
    update: {},
    create: {
      name: 'Empresa Piloto Coins',
      cnpj: '00000000000191',
    },
  });
}

async function seedAdminUser(organizationId: string) {
  const passwordHash = await hashPassword(SEED_ADMIN_PASSWORD);

  return prisma.adminUser.upsert({
    where: { email: 'owner@coins-piloto.com.br' },
    update: { passwordHash },
    create: {
      organizationId,
      name: 'Owner Piloto',
      email: 'owner@coins-piloto.com.br',
      passwordHash,
      role: AdminRole.OWNER,
    },
  });
}

async function seedUsersWithWallets(organizationId: string) {
  for (let i = 0; i < USERS_COUNT; i++) {
    const cpf = generateFakeCpf(i);
    const cpfHash = hashCpf(cpf);

    const user = await prisma.user.upsert({
      where: { cpfHash },
      update: {},
      create: {
        cpfEncrypted: encryptCpf(cpf),
        cpfHash,
        name: `Usuário Seed ${i + 1}`,
        phone: `11900${String(i).padStart(6, '0')}`,
      },
    });

    const membership = await prisma.membership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId } },
      update: {},
      create: {
        userId: user.id,
        organizationId,
        type: MembershipType.CUSTOMER,
      },
    });

    await prisma.wallet.upsert({
      where: { membershipId: membership.id },
      update: {},
      create: {
        membershipId: membership.id,
        cachedBalance: 0,
      },
    });
  }
}

async function seedPartnersWithOffers() {
  for (const partnerData of PARTNERS) {
    const passwordHash = partnerData.password ? await hashPassword(partnerData.password) : null;

    // update preenchido de propósito (não `{}`) — senão um parceiro criado antes desta
    // sessão nunca ganha contactEmail/passwordHash quando o seed roda de novo, já que
    // upsert só aplica `create` na primeira vez.
    const partnerFields = {
      name: partnerData.name,
      category: partnerData.category,
      takeRateBps: partnerData.takeRateBps,
      pixKey: partnerData.pixKey,
      contactEmail: partnerData.contactEmail,
      contactPhone: partnerData.contactPhone,
      passwordHash,
    };

    const partner = await prisma.partner.upsert({
      where: { cnpj: partnerData.cnpj },
      update: partnerFields,
      create: { cnpj: partnerData.cnpj, ...partnerFields },
    });

    for (const offerData of partnerData.offers) {
      const existingOffer = await prisma.offer.findFirst({
        where: { partnerId: partner.id, title: offerData.title },
      });

      if (!existingOffer) {
        await prisma.offer.create({
          data: {
            partnerId: partner.id,
            title: offerData.title,
            description: offerData.title,
            category: partnerData.category,
            costInCoins: offerData.costInCoins,
            imageUrl: offerData.imageUrl,
          },
        });
      } else if (
        existingOffer.costInCoins !== offerData.costInCoins ||
        existingOffer.imageUrl !== offerData.imageUrl
      ) {
        await prisma.offer.update({
          where: { id: existingOffer.id },
          data: { costInCoins: offerData.costInCoins, imageUrl: offerData.imageUrl },
        });
      }
    }
  }
}

async function main() {
  const organization = await seedOrganization();
  await seedAdminUser(organization.id);
  await seedUsersWithWallets(organization.id);
  await seedPartnersWithOffers();

  console.log('Seed concluído:', {
    organization: organization.name,
    users: USERS_COUNT,
    partners: PARTNERS.length,
    adminLogin: { email: 'owner@coins-piloto.com.br', password: SEED_ADMIN_PASSWORD },
    partnerLogin: { email: 'atendimento@capitulo.com.br', password: SEED_PARTNER_PASSWORD },
  });
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
