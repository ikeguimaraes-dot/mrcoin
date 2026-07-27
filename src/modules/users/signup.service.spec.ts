import { randomInt, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EmailPort, SendEmailParams } from '../../common/email/email.port';
import { SignupService } from './signup.service';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: 'test-secret-test-secret-test-secret-32' });
const capturedEmails: SendEmailParams[] = [];
const fakeEmailPort: EmailPort = {
  send: (params) => {
    capturedEmails.push(params);
    return Promise.resolve();
  },
};
const signupService = new SignupService(prisma, jwtService, fakeEmailPort);

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createOrg(): Promise<{ id: string }> {
  const suffix = randomUUID();
  const organization = await prisma.organization.create({
    data: { name: `Timing Test Org ${suffix}`, cnpj: suffix.replace(/-/g, '').slice(0, 14) },
  });
  createdOrgIds.push(organization.id);
  return organization;
}

afterAll(async () => {
  const memberships = await prisma.membership.findMany({ where: { userId: { in: createdUserIds } } });
  const walletIds = (
    await prisma.wallet.findMany({ where: { membershipId: { in: memberships.map((m) => m.id) } } })
  ).map((w) => w.id);
  await prisma.wallet.deleteMany({ where: { id: { in: walletIds } } });
  await prisma.membership.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.userSignupRequest.deleteMany({ where: { organizationId: { in: createdOrgIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: createdOrgIds } } });
  await prisma.$disconnect();
});

describe('SignupService.requestOtp — paridade de queries (defesa contra oráculo de timing)', () => {
  it('CPF novo e CPF já existente (em outra org) fazem o mesmo número de consultas de Membership', async () => {
    const org = await createOrg();
    const existingCpf = randomCpf();
    const otherOrg = await createOrg();

    const user = await prisma.user.create({
      data: {
        cpfEncrypted: encryptCpf(existingCpf),
        cpfHash: hashCpf(existingCpf),
        name: 'Já Cadastrado',
        email: `existing-${randomUUID()}@test.coins-api.dev`,
      },
    });
    createdUserIds.push(user.id);
    await prisma.membership.create({ data: { userId: user.id, organizationId: otherOrg.id, type: 'CUSTOMER' } });

    const membershipFindUniqueSpy = jest.spyOn(prisma.membership, 'findUnique');

    membershipFindUniqueSpy.mockClear();
    await signupService.requestOtp({
      cpf: randomCpf(),
      name: 'CPF Novo',
      email: `new-${randomUUID()}@test.coins-api.dev`,
      organizationId: org.id,
      membershipType: 'CUSTOMER',
    });
    const callsForNewCpf = membershipFindUniqueSpy.mock.calls.length;

    membershipFindUniqueSpy.mockClear();
    await signupService.requestOtp({
      cpf: existingCpf,
      name: 'Ignorado',
      email: `ignored-${randomUUID()}@test.coins-api.dev`,
      organizationId: org.id,
      membershipType: 'CUSTOMER',
    });
    const callsForExistingCpf = membershipFindUniqueSpy.mock.calls.length;

    membershipFindUniqueSpy.mockRestore();

    expect(callsForNewCpf).toBe(1);
    expect(callsForExistingCpf).toBe(1);
    expect(callsForNewCpf).toBe(callsForExistingCpf);
  });
});
