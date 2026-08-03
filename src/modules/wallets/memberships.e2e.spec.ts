import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { LedgerService } from '../ledger/ledger.service';

interface MembershipItemBody {
  organizationId: string;
  organizationName: string;
  membershipType: string;
  membershipStatus: string;
  walletBalance: number;
}

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const ledgerService = new LedgerService(prisma);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

function tokenFor(userId: string): Promise<string> {
  return jwtService.signAsync({ sub: userId, type: 'user' });
}

async function createOrg(name: string): Promise<{ id: string; name: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `${name} ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  return organization;
}

async function createUser(): Promise<{ userId: string }> {
  const suffix = randomUUID();
  const cpf = suffix.replace(/-/g, '').slice(0, 11);
  const user = await prisma.user.create({
    data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name: `Memberships Test User ${suffix}` },
  });
  createdUserIds.push(user.id);
  return { userId: user.id };
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
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('GET /memberships', () => {
  it('usuário com vínculo em duas organizações vê as duas, com o saldo certo de cada', async () => {
    const orgA = await createOrg('Memberships Org A');
    const orgB = await createOrg('Memberships Org B');
    const { userId } = await createUser();

    const membershipA = await prisma.membership.create({
      data: { userId, organizationId: orgA.id, type: 'CUSTOMER' },
    });
    const walletA = await prisma.wallet.create({ data: { membershipId: membershipA.id } });
    await ledgerService.post({
      walletId: walletA.id,
      type: 'CREDIT',
      amount: 100,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Saldo A',
      idempotencyKey: randomUUID(),
    });

    const membershipB = await prisma.membership.create({
      data: { userId, organizationId: orgB.id, type: 'EMPLOYEE' },
    });
    const walletB = await prisma.wallet.create({ data: { membershipId: membershipB.id } });
    await ledgerService.post({
      walletId: walletB.id,
      type: 'CREDIT',
      amount: 250,
      referenceType: 'MANUAL_ADJUSTMENT',
      referenceId: randomUUID(),
      description: 'Saldo B',
      idempotencyKey: randomUUID(),
    });

    const token = await tokenFor(userId);
    const response = await request(server)
      .get('/memberships')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = response.body as MembershipItemBody[];
    expect(body).toHaveLength(2);

    const itemA = body.find((m) => m.organizationId === orgA.id);
    const itemB = body.find((m) => m.organizationId === orgB.id);
    expect(itemA?.walletBalance).toBe(100);
    expect(itemA?.membershipType).toBe('CUSTOMER');
    expect(itemA?.organizationName).toBe(orgA.name);
    expect(itemB?.walletBalance).toBe(250);
    expect(itemB?.membershipType).toBe('EMPLOYEE');
  });

  it('usuário sem nenhum vínculo recebe lista vazia', async () => {
    const { userId } = await createUser();
    const token = await tokenFor(userId);

    const response = await request(server)
      .get('/memberships')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('isola por usuário — memberships de outro usuário nunca aparecem', async () => {
    const org = await createOrg('Memberships Isolation Org');
    const { userId: userA } = await createUser();
    const { userId: userB } = await createUser();

    const membership = await prisma.membership.create({
      data: { userId: userA, organizationId: org.id, type: 'CUSTOMER' },
    });
    await prisma.wallet.create({ data: { membershipId: membership.id } });

    const tokenB = await tokenFor(userB);
    const response = await request(server)
      .get('/memberships')
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(200);

    expect(response.body).toEqual([]);
  });
});
