import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { hashPassword } from '../auth/password.util';
import { hashInviteToken } from './invite-token.util';
import { createOrganizationWithOwnerInvite } from './create-organization-with-owner';
import { EmailAlreadyInUseException } from './exceptions/email-already-in-use.exception';
import { OrganizationCnpjInUseException } from './exceptions/organization-cnpj-in-use.exception';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';

const prisma = new PrismaService();
const ADMIN_PANEL_URL = 'http://localhost:3001';

const createdOrganizationIds: string[] = [];
const createdAdminUserIds: string[] = [];

function fixtureCnpj(): string {
  return randomUUID().replace(/\D/g, '').padEnd(14, '0').slice(0, 14);
}

afterAll(async () => {
  await prisma.adminInvite.deleteMany({ where: { organizationId: { in: createdOrganizationIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrganizationIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminUserIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
  await prisma.$disconnect();
});

describe('createOrganizationWithOwnerInvite', () => {
  it('cria Organization + AdminInvite "de sistema" (invitedByAdminUserId null, role OWNER) atomicamente', async () => {
    const suffix = randomUUID();
    const input = {
      name: `Empresa Teste ${suffix}`,
      cnpj: fixtureCnpj(),
      ownerEmail: `owner-${suffix}@test.coins-api.dev`,
    };

    const { organization, invite, conversionRate } = await createOrganizationWithOwnerInvite(
      prisma,
      input,
      ADMIN_PANEL_URL,
    );
    createdOrganizationIds.push(organization.id);

    expect(organization.name).toBe(input.name);
    expect(organization.cnpj).toBe(input.cnpj);

    const inviteRow = await prisma.adminInvite.findUniqueOrThrow({ where: { id: invite.id } });
    expect(inviteRow.organizationId).toBe(organization.id);
    expect(inviteRow.email).toBe(input.ownerEmail.toLowerCase());
    expect(inviteRow.role).toBe('OWNER');
    expect(inviteRow.invitedByAdminUserId).toBeNull();
    expect(inviteRow.tokenHash).toBe(hashInviteToken(invite.rawToken));
    expect(invite.inviteLink).toBe(`${ADMIN_PANEL_URL}/invites/${invite.rawToken}`);

    // sem coinsPerReal no input, nasce com a taxa padrão da plataforma
    expect(conversionRate.organizationId).toBe(organization.id);
    expect(conversionRate.coinsPerRealScaled).toBe(DEFAULT_COINS_PER_REAL_SCALED);
  });

  it('coinsPerReal explícito gera a taxa correspondente em vez do padrão', async () => {
    const suffix = randomUUID();
    const { organization, conversionRate } = await createOrganizationWithOwnerInvite(
      prisma,
      {
        name: `Empresa Taxa Custom ${suffix}`,
        cnpj: fixtureCnpj(),
        ownerEmail: `owner-custom-rate-${suffix}@test.coins-api.dev`,
        coinsPerReal: 2.5,
      },
      ADMIN_PANEL_URL,
    );
    createdOrganizationIds.push(organization.id);

    expect(conversionRate.coinsPerRealScaled).toBe(250);
  });

  it('CNPJ já existente lança OrganizationCnpjInUseException e não cria nada', async () => {
    const suffix = randomUUID();
    const cnpj = fixtureCnpj();

    const first = await createOrganizationWithOwnerInvite(
      prisma,
      { name: `Empresa A ${suffix}`, cnpj, ownerEmail: `owner-a-${suffix}@test.coins-api.dev` },
      ADMIN_PANEL_URL,
    );
    createdOrganizationIds.push(first.organization.id);

    await expect(
      createOrganizationWithOwnerInvite(
        prisma,
        { name: `Empresa B ${suffix}`, cnpj, ownerEmail: `owner-b-${suffix}@test.coins-api.dev` },
        ADMIN_PANEL_URL,
      ),
    ).rejects.toBeInstanceOf(OrganizationCnpjInUseException);

    const orgsWithCnpj = await prisma.organization.findMany({ where: { cnpj } });
    expect(orgsWithCnpj).toHaveLength(1);
  });

  it('e-mail de AdminUser já em uso lança EmailAlreadyInUseException e não cria Organization nova', async () => {
    const suffix = randomUUID();
    const existingOrg = await prisma.organization.create({
      data: { name: `Empresa Existente ${suffix}`, cnpj: fixtureCnpj() },
    });
    createdOrganizationIds.push(existingOrg.id);

    const email = `admin-existente-${suffix}@test.coins-api.dev`;
    const existingAdmin = await prisma.adminUser.create({
      data: {
        organizationId: existingOrg.id,
        name: 'Admin Existente',
        email,
        passwordHash: await hashPassword('Test@Password123'),
        role: 'OWNER',
      },
    });
    createdAdminUserIds.push(existingAdmin.id);

    const newCnpj = fixtureCnpj();
    await expect(
      createOrganizationWithOwnerInvite(
        prisma,
        { name: `Empresa Nova ${suffix}`, cnpj: newCnpj, ownerEmail: email },
        ADMIN_PANEL_URL,
      ),
    ).rejects.toBeInstanceOf(EmailAlreadyInUseException);

    const orgsWithNewCnpj = await prisma.organization.findMany({ where: { cnpj: newCnpj } });
    expect(orgsWithNewCnpj).toHaveLength(0);
  });
});
