import { AdminRole, MembershipType, PrismaClient } from '@prisma/client';
import { encryptCpf, hashCpf } from '../src/common/crypto/cpf-crypto.util';
import { generateFakeCpf } from './cpf.fixture';

const prisma = new PrismaClient();

const SEED_PASSWORD_PLACEHOLDER =
  'SEED_ONLY_NOT_A_REAL_HASH — defina uma senha real via o fluxo de auth (Sessão 5)';

const USERS_COUNT = 20;

const PARTNERS = [
  {
    name: 'Padaria Boa Hora',
    cnpj: '11111111000191',
    category: 'Alimentação',
    takeRateBps: 500,
    pixKey: 'padaria@boahora.com.br',
    offers: ['10% de desconto no café da manhã', 'Pão francês grátis a cada 10 compras'],
  },
  {
    name: 'Academia Vigor',
    cnpj: '22222222000191',
    category: 'Saúde e bem-estar',
    takeRateBps: 800,
    pixKey: 'financeiro@vigor.com.br',
    offers: ['1 mês de mensalidade com desconto', 'Avaliação física gratuita'],
  },
  {
    name: 'Livraria Capítulo',
    cnpj: '33333333000191',
    category: 'Cultura',
    takeRateBps: 600,
    pixKey: 'contato@capitulo.com.br',
    offers: [
      '15% de desconto em livros',
      'Frete grátis na primeira compra',
      'Clube do livro — 1 mês grátis',
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
  return prisma.adminUser.upsert({
    where: { email: 'owner@coins-piloto.com.br' },
    update: {},
    create: {
      organizationId,
      name: 'Owner Piloto',
      email: 'owner@coins-piloto.com.br',
      passwordHash: SEED_PASSWORD_PLACEHOLDER,
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
    const partner = await prisma.partner.upsert({
      where: { cnpj: partnerData.cnpj },
      update: {},
      create: {
        name: partnerData.name,
        cnpj: partnerData.cnpj,
        category: partnerData.category,
        takeRateBps: partnerData.takeRateBps,
        pixKey: partnerData.pixKey,
      },
    });

    for (const title of partnerData.offers) {
      const existingOffer = await prisma.offer.findFirst({
        where: { partnerId: partner.id, title },
      });

      if (!existingOffer) {
        await prisma.offer.create({
          data: {
            partnerId: partner.id,
            title,
            description: title,
            category: partnerData.category,
          },
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
