import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AppModule } from '../../../app.module';
import { PrismaService } from '../../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../../auth/password.util';
import { generatePickupCode } from '../../redemptions/redemption-code.util';
import { PLATFORM_JWT_SERVICE } from '../platform-jwt.token';

interface RedemptionBody {
  id: string;
  status: string;
  deliveredAt: string | null;
}

interface ErrorBody {
  code: string;
}

const FIXTURE_PASSWORD = 'Test@Password123';

const prisma = new PrismaService();

const createdOrgIds: string[] = [];
const createdPartnerIds: string[] = [];
const createdOfferIds: string[] = [];
const createdUserIds: string[] = [];
const createdWalletIds: string[] = [];
const createdPlatformAdminIds: string[] = [];

let app: INestApplication;
let server: Server;
let platformJwtService: JwtService;

async function createPlatformAdminFixture(): Promise<{ platformAdminId: string; token: string }> {
  const suffix = randomUUID();
  const platformAdmin = await prisma.platformAdmin.create({
    data: {
      name: `E2E Platform Redemptions Admin ${suffix}`,
      email: `e2e-platform-redemptions-admin-${suffix}@test.coins-api.dev`,
      passwordHash: await hashPassword(FIXTURE_PASSWORD),
    },
  });
  createdPlatformAdminIds.push(platformAdmin.id);
  const token = platformJwtService.sign({ sub: platformAdmin.id, type: 'platform_admin' });
  return { platformAdminId: platformAdmin.id, token };
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Platform Redemptions Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  return organization;
}

async function createMemberWithWallet(organizationId: string): Promise<{ membershipId: string; walletId: string }> {
  const suffix = randomUUID();
  const cpf = randomInt(10_000_000_000, 100_000_000_000).toString();
  const user = await prisma.user.create({
    data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name: `Platform Redemptions Member ${suffix}` },
  });
  createdUserIds.push(user.id);

  const membership = await prisma.membership.create({ data: { userId: user.id, organizationId, type: 'CUSTOMER' } });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id } });
  createdWalletIds.push(wallet.id);

  return { membershipId: membership.id, walletId: wallet.id };
}

async function createPartner(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const partner = await prisma.partner.create({
    data: {
      name: `Platform Redemptions Partner ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
      category: 'Teste',
      takeRateBps: 500,
      pixKey: `pix-${suffix}@test.coins-api.dev`,
    },
  });
  createdPartnerIds.push(partner.id);
  return partner;
}

/** Insere direto via Prisma (bypassa a compra real com PIN — não é o que este spec testa). */
async function createConfirmedRedemption(params: {
  membershipId: string;
  walletId: string;
  partnerId: string;
  amount?: number;
}) {
  const suffix = randomUUID();
  const redemption = await prisma.redemption.create({
    data: {
      membershipId: params.membershipId,
      walletId: params.walletId,
      partnerId: params.partnerId,
      amount: params.amount ?? 10,
      pickupCode: generatePickupCode(),
      qrPayload: `qr-${suffix}`,
      idempotencyKey: `test-${suffix}`,
      status: 'CONFIRMED',
      confirmedAt: new Date(),
    },
  });
  return redemption;
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
  platformJwtService = app.get<JwtService>(PLATFORM_JWT_SERVICE);
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.redemption.deleteMany({ where: { walletId: { in: createdWalletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: createdWalletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.offer.deleteMany({ where: { id: { in: createdOfferIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: createdPartnerIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.platformAdminRefreshToken.deleteMany({ where: { platformAdminId: { in: createdPlatformAdminIds } } });
  await prisma.platformAdminAuditLog.deleteMany({ where: { platformAdminId: { in: createdPlatformAdminIds } } });
  await prisma.platformAdmin.deleteMany({ where: { id: { in: createdPlatformAdminIds } } });
  await prisma.$disconnect();
});

describe('POST /platform/redemptions/deliver', () => {
  it('marca entregue por redemptionId — idempotente, grava audit log só na transição de verdade', async () => {
    const { platformAdminId, token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const partner = await createPartner();
    const member = await createMemberWithWallet(org.id);
    const redemption = await createConfirmedRedemption({
      membershipId: member.membershipId,
      walletId: member.walletId,
      partnerId: partner.id,
    });

    const firstRes = await request(server)
      .post('/platform/redemptions/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send({ redemptionId: redemption.id })
      .expect(201);
    const first = firstRes.body as RedemptionBody;
    expect(first.status).toBe('DELIVERED');
    expect(first.deliveredAt).toBeTruthy();

    const stored = await prisma.redemption.findUniqueOrThrow({ where: { id: redemption.id } });
    expect(stored.deliveredByType).toBe('PLATFORM_ADMIN');
    expect(stored.deliveredById).toBe(platformAdminId);

    const auditLogs = await prisma.platformAdminAuditLog.findMany({
      where: { platformAdminId, action: 'REDEMPTION_DELIVERED' },
    });
    expect(auditLogs).toHaveLength(1);

    // Idempotente: marcar entregue de novo não quebra, devolve o mesmo estado, e NÃO grava
    // um segundo audit log (só a transição de verdade é registrada).
    const secondRes = await request(server)
      .post('/platform/redemptions/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send({ redemptionId: redemption.id })
      .expect(201);
    expect((secondRes.body as RedemptionBody).status).toBe('DELIVERED');
    expect((secondRes.body as RedemptionBody).deliveredAt).toBe(first.deliveredAt);

    const auditLogsAfterReplay = await prisma.platformAdminAuditLog.findMany({
      where: { platformAdminId, action: 'REDEMPTION_DELIVERED' },
    });
    expect(auditLogsAfterReplay).toHaveLength(1);
  });

  it('marca entregue por pickupCode e por qrPayload', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const partner = await createPartner();
    const member = await createMemberWithWallet(org.id);

    const byCode = await createConfirmedRedemption({
      membershipId: member.membershipId,
      walletId: member.walletId,
      partnerId: partner.id,
    });
    await request(server)
      .post('/platform/redemptions/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send({ pickupCode: byCode.pickupCode })
      .expect(201);

    const byQr = await createConfirmedRedemption({
      membershipId: member.membershipId,
      walletId: member.walletId,
      partnerId: partner.id,
    });
    await request(server)
      .post('/platform/redemptions/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send({ qrPayload: byQr.qrPayload })
      .expect(201);
  });

  it('sem restrição de parceiro dono — marca entregue resgate de qualquer parceiro', async () => {
    const { token } = await createPlatformAdminFixture();
    const org = await createOrg();
    const partnerA = await createPartner();
    const member = await createMemberWithWallet(org.id);
    const redemption = await createConfirmedRedemption({
      membershipId: member.membershipId,
      walletId: member.walletId,
      partnerId: partnerA.id,
    });

    // Sem token de parceiro nenhum envolvido — só o platform admin, que não tem dono.
    await request(server)
      .post('/platform/redemptions/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send({ redemptionId: redemption.id })
      .expect(201);
  });

  it('resgate inexistente retorna 404', async () => {
    const { token } = await createPlatformAdminFixture();

    const response = await request(server)
      .post('/platform/redemptions/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send({ redemptionId: randomUUID() })
      .expect(404);
    expect((response.body as ErrorBody).code).toBe('NOT_FOUND');
  });

  it('mais de um entre redemptionId/pickupCode/qrPayload retorna 400 VALIDATION_ERROR', async () => {
    const { token } = await createPlatformAdminFixture();

    const response = await request(server)
      .post('/platform/redemptions/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send({ redemptionId: randomUUID(), pickupCode: '123456' })
      .expect(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('nenhum dos três campos retorna 400 VALIDATION_ERROR', async () => {
    const { token } = await createPlatformAdminFixture();

    const response = await request(server)
      .post('/platform/redemptions/deliver')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(400);
    expect((response.body as ErrorBody).code).toBe('VALIDATION_ERROR');
  });

  it('token de AdminUser e de Partner recebem 401', async () => {
    const jwtService = app.get(JwtService);
    const adminToken = jwtService.sign({ sub: randomUUID(), organizationId: randomUUID(), role: 'OPERATOR', type: 'admin' });
    const partnerToken = jwtService.sign({ sub: randomUUID(), type: 'partner' });

    for (const badToken of [adminToken, partnerToken]) {
      await request(server)
        .post('/platform/redemptions/deliver')
        .set('Authorization', `Bearer ${badToken}`)
        .send({ redemptionId: randomUUID() })
        .expect(401);
    }
  });

  it('sem token recebe 401', async () => {
    await request(server).post('/platform/redemptions/deliver').send({ redemptionId: randomUUID() }).expect(401);
  });
});
