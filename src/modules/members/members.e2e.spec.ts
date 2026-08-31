import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AdminRole } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../auth/password.util';
import { TokenService } from '../auth/token.service';
import { LedgerService } from '../ledger/ledger.service';
import { DEFAULT_COINS_PER_REAL_SCALED } from '../settings/settings.constants';

interface MemberItemBody {
  membershipId: string;
  userId: string;
  name: string;
  membershipStatus: string;
  userStatus: string;
  membershipType: string;
  walletBalance: number;
  createdAt: string;
}

interface MembersListResponseBody {
  items: MemberItemBody[];
  nextCursor: string | null;
}

interface EntryBody {
  id: string;
}

interface EntriesResponseBody {
  items: EntryBody[];
  nextCursor: string | null;
}

interface ErrorResponseBody {
  code: string;
}

const FIXTURE_PASSWORD = 'Test@Password123';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const tokenService = new TokenService(jwtService, prisma);
const ledgerService = new LedgerService(prisma);

const createdOrgIds: string[] = [];
const createdAdminIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

interface AdminFixture {
  adminId: string;
  organizationId: string;
  role: AdminRole;
}

async function createAdmin(role: AdminRole): Promise<AdminFixture> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Members Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  await prisma.conversionRate.create({
    data: { organizationId: organization.id, coinsPerRealScaled: DEFAULT_COINS_PER_REAL_SCALED },
  });

  const admin = await prisma.adminUser.create({
    data: {
      organizationId: organization.id,
      name: `Members Test Admin ${suffix}`,
      email: `members-test-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
      role,
    },
  });
  createdAdminIds.push(admin.id);

  return { adminId: admin.id, organizationId: organization.id, role };
}

function tokenFor(admin: AdminFixture): Promise<string> {
  return tokenService.issueAccessToken({ id: admin.adminId, organizationId: admin.organizationId, role: admin.role });
}

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createMemberWithWallet(
  organizationId: string,
  cpf?: string,
): Promise<{ userId: string; membershipId: string; walletId: string; cpf: string }> {
  const suffix = randomUUID();
  const resolvedCpf = cpf ?? randomCpf();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(resolvedCpf),
      cpfHash: hashCpf(resolvedCpf),
      name: `Members Test Member ${suffix}`,
    },
  });
  createdUserIds.push(user.id);

  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId, type: 'CUSTOMER' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id } });

  return { userId: user.id, membershipId: membership.id, walletId: wallet.id, cpf: resolvedCpf };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const walletIds = (
    await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } })
  ).map((w) => w.id);

  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.refreshToken.deleteMany({ where: { adminUserId: { in: createdAdminIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: createdAdminIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.conversionRate.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('GET /admin/members', () => {
  it('pagina por cursor', async () => {
    const org = await createAdmin('OWNER');
    await createMemberWithWallet(org.organizationId);
    await createMemberWithWallet(org.organizationId);
    await createMemberWithWallet(org.organizationId);

    const token = await tokenFor(org);
    const firstPage = await request(server)
      .get('/admin/members')
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const firstBody = firstPage.body as MembersListResponseBody;
    expect(firstBody.items).toHaveLength(2);
    expect(firstBody.nextCursor).toBeTruthy();

    const secondPage = await request(server)
      .get('/admin/members')
      .query({ limit: 2, cursor: firstBody.nextCursor as string })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const secondBody = secondPage.body as MembersListResponseBody;
    expect(secondBody.items).toHaveLength(1);
    expect(secondBody.nextCursor).toBeNull();
  });

  it('filtro por cpf devolve só o membro correspondente', async () => {
    const org = await createAdmin('OWNER');
    const target = await createMemberWithWallet(org.organizationId);
    await createMemberWithWallet(org.organizationId);

    const token = await tokenFor(org);
    const response = await request(server)
      .get('/admin/members')
      .query({ cpf: target.cpf })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as MembersListResponseBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.membershipId).toBe(target.membershipId);
    expect(body.nextCursor).toBeNull();
  });

  it('filtro por cpf sem match devolve lista vazia, não 404', async () => {
    const org = await createAdmin('OWNER');
    const token = await tokenFor(org);

    const response = await request(server)
      .get('/admin/members')
      .query({ cpf: '00000000000' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as MembersListResponseBody;
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('shape do item nunca vaza cpfHash/cpfEncrypted', async () => {
    const org = await createAdmin('OWNER');
    const member = await createMemberWithWallet(org.organizationId);
    await ledgerService.post({
      walletId: member.walletId,
      type: 'CREDIT',
      amount: 42,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Ajuste',
      idempotencyKey: randomUUID(),
    });

    const token = await tokenFor(org);
    const response = await request(server)
      .get('/admin/members')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const item = (response.body as MembersListResponseBody).items[0];
    expect(Object.keys(item as object).sort()).toEqual(
      [
        'membershipId',
        'userId',
        'name',
        'membershipStatus',
        'userStatus',
        'membershipType',
        'walletBalance',
        'createdAt',
      ].sort(),
    );
    expect(item?.walletBalance).toBe(42);
    expect(item?.userStatus).toBe('ACTIVE');
    expect(item?.membershipStatus).toBe('ACTIVE');
  });

  it('isola por organização', async () => {
    const orgA = await createAdmin('OWNER');
    const orgB = await createAdmin('OWNER');
    await createMemberWithWallet(orgB.organizationId);

    const tokenA = await tokenFor(orgA);
    const response = await request(server)
      .get('/admin/members')
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);

    expect((response.body as MembersListResponseBody).items).toEqual([]);
  });

  it('VIEWER consegue listar (leitura não restringe role)', async () => {
    const org = await createAdmin('VIEWER');
    await createMemberWithWallet(org.organizationId);
    const token = await tokenFor(org);

    await request(server).get('/admin/members').set('Authorization', `Bearer ${token}`).expect(200);
  });
});

describe('GET /admin/members/:membershipId', () => {
  it('detalhe do membro', async () => {
    const org = await createAdmin('OWNER');
    const member = await createMemberWithWallet(org.organizationId);
    const token = await tokenFor(org);

    const response = await request(server)
      .get(`/admin/members/${member.membershipId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as MemberItemBody;
    expect(body.membershipId).toBe(member.membershipId);
    expect(body.userId).toBe(member.userId);
  });

  it('membro de outra organização retorna 404, não 403', async () => {
    const orgA = await createAdmin('OWNER');
    const orgB = await createAdmin('OWNER');
    const memberB = await createMemberWithWallet(orgB.organizationId);
    const tokenA = await tokenFor(orgA);

    const response = await request(server)
      .get(`/admin/members/${memberB.membershipId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);

    expect((response.body as ErrorResponseBody).code).toBe('NOT_FOUND');
  });

  it('VIEWER consegue ver detalhe', async () => {
    const org = await createAdmin('VIEWER');
    const member = await createMemberWithWallet(org.organizationId);
    const token = await tokenFor(org);

    await request(server)
      .get(`/admin/members/${member.membershipId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});

describe('GET /admin/members/:membershipId/entries', () => {
  it('bate exatamente com LedgerService.getEntries', async () => {
    const org = await createAdmin('OWNER');
    const member = await createMemberWithWallet(org.organizationId);

    for (let i = 0; i < 3; i += 1) {
      await ledgerService.post({
        walletId: member.walletId,
        type: 'CREDIT',
        amount: 10,
        referenceType: 'MANUAL_ADJUSTMENT',
        referenceId: randomUUID(),
        description: `Entry ${i}`,
        idempotencyKey: randomUUID(),
      });
    }

    const direct = await ledgerService.getEntries(member.walletId, { limit: 2 });

    const token = await tokenFor(org);
    const response = await request(server)
      .get(`/admin/members/${member.membershipId}/entries`)
      .query({ limit: 2 })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as EntriesResponseBody;
    expect(body.items.map((e) => e.id)).toEqual(direct.items.map((e) => e.id));
    expect(body.nextCursor).toBe(direct.nextCursor);
  });

  it('SEGURANÇA: nunca inclui hash/prevHash/idempotencyKey', async () => {
    const org = await createAdmin('OWNER');
    const member = await createMemberWithWallet(org.organizationId);

    await ledgerService.post({
      walletId: member.walletId,
      type: 'CREDIT',
      amount: 10,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Entry',
      idempotencyKey: randomUUID(),
    });

    const token = await tokenFor(org);
    const response = await request(server)
      .get(`/admin/members/${member.membershipId}/entries`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as EntriesResponseBody;
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).not.toHaveProperty('hash');
    expect(body.items[0]).not.toHaveProperty('prevHash');
    expect(body.items[0]).not.toHaveProperty('idempotencyKey');
  });

  it('membro de outra organização retorna 404', async () => {
    const orgA = await createAdmin('OWNER');
    const orgB = await createAdmin('OWNER');
    const memberB = await createMemberWithWallet(orgB.organizationId);
    const tokenA = await tokenFor(orgA);

    const response = await request(server)
      .get(`/admin/members/${memberB.membershipId}/entries`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(404);

    expect((response.body as ErrorResponseBody).code).toBe('NOT_FOUND');
  });

  it('VIEWER consegue ver o extrato', async () => {
    const org = await createAdmin('VIEWER');
    const member = await createMemberWithWallet(org.organizationId);
    const token = await tokenFor(org);

    await request(server)
      .get(`/admin/members/${member.membershipId}/entries`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
  });
});
