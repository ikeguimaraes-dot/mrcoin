import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { EMAIL_PORT, SendEmailParams } from '../../common/email/email.port';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { hashPassword } from '../auth/password.util';
import { LedgerService } from '../ledger/ledger.service';
import { UserTokenService } from './user-token.service';
import { PLATFORM_JWT_SERVICE } from '../platform-admin/platform-jwt.token';

interface Receipt {
  id: string;
  status: string;
  deadlineAt: string;
  requestedAt: string;
}
const prisma = new PrismaService();
const jwt = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });
const password = 'AppStore!Review2026';
const emails: SendEmailParams[] = [];
const ids: string[] = [];
const walletIds: string[] = [];
let failEmails = false;
let app: INestApplication;
let server: Server;
let passwordHash: string;
let organizationId: string;
let adminId: string;
let adminToken: string;
let platformId: string;
let platformToken: string;
let ledger: LedgerService;
let partnerId: string;
let offerId: string;
let reservedBatchId: string;

async function participant() {
  const cpf = randomInt(10_000_000_000, 100_000_000_000).toString();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: 'Participante de teste',
      email: `${randomUUID()}@test.coins-api.dev`,
      passwordHash,
      transactionPinHash: passwordHash,
    },
  });
  ids.push(user.id);
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId, type: 'EMPLOYEE' },
  });
  const wallet = await prisma.wallet.create({ data: { membershipId: membership.id } });
  walletIds.push(wallet.id);
  const entry = await ledger.post({
    walletId: wallet.id,
    type: 'CREDIT',
    amount: 500,
    referenceType: 'MANUAL_ADJUSTMENT',
    referenceId: randomUUID(),
    description: 'Saldo de teste',
    idempotencyKey: randomUUID(),
  });
  return {
    user,
    cpf,
    membership,
    wallet,
    entry,
    token: await jwt.signAsync({ sub: user.id, type: 'user' }),
  };
}

beforeAll(async () => {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(EMAIL_PORT)
    .useValue({
      send: (email: SendEmailParams) => {
        if (failEmails) return Promise.reject(new Error('Falha simulada'));
        emails.push(email);
        return Promise.resolve();
      },
    })
    .compile();
  app = module.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
  ledger = app.get(LedgerService);
  passwordHash = await hashPassword(password);
  const organization = await prisma.organization.create({
    data: { name: 'App Store readiness', cnpj: randomUUID().replace(/-/g, '').slice(0, 14) },
  });
  organizationId = organization.id;
  const admin = await prisma.adminUser.create({
    data: {
      organizationId,
      name: 'Responsável teste',
      email: `${randomUUID()}@test.coins-api.dev`,
      passwordHash,
      role: 'OWNER',
    },
  });
  adminId = admin.id;
  adminToken = await jwt.signAsync({ sub: adminId, organizationId, role: 'OWNER', type: 'admin' });
  const platform = await prisma.platformAdmin.create({
    data: { name: 'Revisor teste', email: `${randomUUID()}@test.coins-api.dev`, passwordHash },
  });
  platformId = platform.id;
  platformToken = app
    .get<JwtService>(PLATFORM_JWT_SERVICE)
    .sign({ sub: platformId, type: 'platform_admin' });
  const partner = await prisma.partner.create({
    data: {
      name: 'Parceiro de teste',
      cnpj: randomUUID().replace(/-/g, '').slice(0, 14),
      category: 'Teste',
      takeRateBps: 500,
      pixKey: 'test',
    },
  });
  partnerId = partner.id;
  await prisma.offerCategory.upsert({
    where: { name: 'Teste' },
    update: { active: true },
    create: { name: 'Teste', slug: 'teste' },
  });
  const offer = await prisma.offer.create({
    data: {
      partnerId,
      title: 'Benefício de teste',
      description: 'Teste de resgate',
      category: 'Teste',
      costInCoins: 50,
    },
  });
  offerId = offer.id;
  const reservedBatch = await prisma.coinBatch.create({
    data: {
      organizationId,
      totalCoins: 1000,
      remainingCoins: 1000,
      priceInCents: 1000,
      status: 'PAID',
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  reservedBatchId = reservedBatch.id;
});

afterAll(async () => {
  if (app) await app.close();
  await prisma.accountDeletionRequest.deleteMany({ where: { userId: { in: ids } } });
  await prisma.redemption.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.offer.deleteMany({ where: { id: offerId } });
  await prisma.partner.deleteMany({ where: { id: partnerId } });
  await prisma.device.deleteMany({ where: { userId: { in: ids } } });
  await prisma.userRefreshToken.deleteMany({ where: { userId: { in: ids } } });
  await prisma.spin.deleteMany({ where: { organizationId } });
  await prisma.spinGrant.deleteMany({ where: { organizationId } });
  await prisma.ledgerEntry.deleteMany({ where: { walletId: { in: walletIds } } });
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.coinBatch.deleteMany({ where: { organizationId } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.adminUser.deleteMany({ where: { id: adminId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.platformAdminAuditLog.deleteMany({ where: { platformAdminId: platformId } });
  await prisma.platformAdmin.deleteMany({ where: { id: platformId } });
  await prisma.$disconnect();
});

describe('Preparação App Store', () => {
  it('aceita exclusão mesmo com saldo; repetição preserva protocolo e prazo', async () => {
    const fixture = await participant();
    const first = await request(server)
      .post('/users/me/account-deletion')
      .auth(fixture.token, { type: 'bearer' })
      .send({ password, confirmDeletion: true })
      .expect(200);
    const receipt = first.body as Receipt;
    expect(receipt.status).toBe('PENDING');
    expect(
      new Date(receipt.deadlineAt).getTime() - new Date(receipt.requestedAt).getTime(),
    ).toBeCloseTo(7 * 86400000, -3);
    const second = await request(server)
      .post('/users/me/account-deletion')
      .auth(fixture.token, { type: 'bearer' })
      .send({ password, confirmDeletion: true })
      .expect(200);
    expect(second.body).toMatchObject({ id: receipt.id, deadlineAt: receipt.deadlineAt });
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: fixture.wallet.id } })).cachedBalance,
    ).toBe(500);
    const other = await participant();
    const status = await request(server)
      .get('/users/me/account-deletion')
      .auth(other.token, { type: 'bearer' })
      .expect(200);
    expect(status.body).toEqual({ request: null });
  });

  it('exige senha e confirmação explícita, sem permitir escolher outro usuário', async () => {
    const fixture = await participant();
    await request(server)
      .post('/users/me/account-deletion')
      .auth(fixture.token, { type: 'bearer' })
      .send({ password: 'errada', confirmDeletion: true })
      .expect(422);
    await request(server)
      .post('/users/me/account-deletion')
      .auth(fixture.token, { type: 'bearer' })
      .send({ password, confirmDeletion: false })
      .expect(400);
    await request(server)
      .post('/users/me/account-deletion')
      .auth(fixture.token, { type: 'bearer' })
      .send({ password, confirmDeletion: true, userId: 'outra-conta' })
      .expect(400);
    expect(await prisma.accountDeletionRequest.count({ where: { userId: fixture.user.id } })).toBe(
      0,
    );
  });

  it('conclui exclusão com saldo, remove credenciais e dispositivo e preserva ledger e saldo', async () => {
    const fixture = await participant();
    await request(server)
      .post('/admin/spins')
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ cpf: fixture.cpf, name: 'Teste', quantity: 1, membershipType: 'EMPLOYEE' })
      .expect(201);
    expect(
      (await prisma.coinBatch.findUniqueOrThrow({ where: { id: reservedBatchId } })).remainingCoins,
    ).toBe(0);
    const pair = await app.get(UserTokenService).issueTokenPair(fixture.user.id);
    await prisma.device.create({
      data: { userId: fixture.user.id, fingerprint: randomUUID(), pushToken: 'test' },
    });
    const result = await request(server)
      .post('/users/me/account-deletion')
      .auth(fixture.token, { type: 'bearer' })
      .send({ password, confirmDeletion: true })
      .expect(200);
    const id = (result.body as Receipt).id;
    await request(server)
      .get('/platform/account-deletion-requests')
      .auth(fixture.token, { type: 'bearer' })
      .expect(401);
    await request(server)
      .get(`/platform/account-deletion-requests/${id}`)
      .auth(fixture.token, { type: 'bearer' })
      .expect(401);
    const review = await request(server)
      .get(`/platform/account-deletion-requests/${id}`)
      .auth(platformToken, { type: 'bearer' })
      .expect(200);
    expect(review.body).toMatchObject({
      id,
      userId: fixture.user.id,
      ledgerEntries: 1,
      pendingRedemptions: 0,
      wallets: [{ balance: 500 }],
    });
    await request(server)
      .post(`/platform/account-deletion-requests/${id}/complete`)
      .auth(platformToken, { type: 'bearer' })
      .send({
        confirmReview: true,
        retentionReason:
          'Registros de operações conservados para prestação de contas e resolução de obrigações pendentes.',
      })
      .expect(200);
    const deleted = await prisma.user.findUniqueOrThrow({ where: { id: fixture.user.id } });
    expect(deleted).toMatchObject({
      status: 'DELETED',
      email: null,
      phone: null,
      passwordHash: null,
      transactionPinHash: null,
      name: 'Conta excluída',
      notificationsEnabled: false,
    });
    expect(deleted.cpfHash).not.toBe(fixture.user.cpfHash);
    expect(await prisma.device.count({ where: { userId: fixture.user.id } })).toBe(0);
    expect(await prisma.userRefreshToken.count({ where: { userId: fixture.user.id } })).toBe(0);
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: fixture.entry.id } })).toEqual(
      fixture.entry,
    );
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: fixture.wallet.id } })).cachedBalance,
    ).toBe(500);
    await request(server).get('/users/me').auth(fixture.token, { type: 'bearer' }).expect(401);
    await request(server)
      .post('/users/refresh')
      .send({ refreshToken: pair.refreshToken })
      .expect(401);
    const completed = await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id } });
    expect(completed.notificationEmail).toBeNull();
    expect(completed.notificationSentAt).not.toBeNull();
    expect(
      (await prisma.coinBatch.findUniqueOrThrow({ where: { id: reservedBatchId } })).remainingCoins,
    ).toBe(1000);
    expect(
      await prisma.spin.count({
        where: { membershipId: fixture.membership.id, status: 'PENDING' },
      }),
    ).toBe(0);
    expect(
      emails.some(
        (email) => email.to === fixture.user.email && email.subject.includes('concluída'),
      ),
    ).toBe(true);
  });

  it('falha de e-mail não perde o pedido nem reinicia o prazo', async () => {
    const fixture = await participant();
    failEmails = true;
    try {
      await request(server)
        .post('/users/me/account-deletion')
        .auth(fixture.token, { type: 'bearer' })
        .send({ password, confirmDeletion: true })
        .expect(200);
      expect(
        await prisma.accountDeletionRequest.count({ where: { userId: fixture.user.id } }),
      ).toBe(1);
    } finally {
      failEmails = false;
    }
  });

  it('desligamento mantém saldo e acesso; bloqueia novos créditos e preserva bloqueio de segurança', async () => {
    const fixture = await participant();
    await request(server)
      .post(`/admin/members/${fixture.membership.id}/departure`)
      .auth(adminToken, { type: 'bearer' })
      .expect(201);
    const response = await request(server)
      .get('/wallet')
      .query({ organizationId })
      .auth(fixture.token, { type: 'bearer' })
      .expect(200);
    expect(response.body).toMatchObject({ cachedBalance: 500 });
    await prisma.coinBatch.create({
      data: {
        organizationId,
        totalCoins: 1000,
        remainingCoins: 1000,
        priceInCents: 1000,
        status: 'PAID',
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const distribution = await request(server)
      .post('/admin/distributions')
      .auth(adminToken, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ cpf: fixture.cpf, name: 'Teste', amount: 10, membershipType: 'EMPLOYEE' })
      .expect(422);
    expect(distribution.body).toMatchObject({ code: 'MEMBERSHIP_CANNOT_EARN' });
    await prisma.user.update({
      where: { id: fixture.user.id },
      data: { transactionPinHash: await hashPassword('864209') },
    });
    await request(server)
      .post('/redemptions')
      .auth(fixture.token, { type: 'bearer' })
      .set('Idempotency-Key', randomUUID())
      .send({ organizationId, offerId, transactionPin: '864209' })
      .expect(201);
    expect(
      (await prisma.wallet.findUniqueOrThrow({ where: { id: fixture.wallet.id } })).cachedBalance,
    ).toBe(450);
    expect(await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: fixture.entry.id } })).toEqual(
      fixture.entry,
    );
    await prisma.membership.update({
      where: { id: fixture.membership.id },
      data: { status: 'INACTIVE' },
    });
    await request(server)
      .get('/wallet')
      .query({ organizationId })
      .auth(fixture.token, { type: 'bearer' })
      .expect(404);
    await request(server)
      .post(`/admin/members/${fixture.membership.id}/departure`)
      .auth(adminToken, { type: 'bearer' })
      .expect(422);
  });
});
