import { randomInt, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { EmailPort, SendEmailParams } from '../../common/email/email.port';
import { SignupService } from './signup.service';
import { UserTokenService } from './user-token.service';
import { CpfNotInvitedException } from './exceptions/cpf-not-invited.exception';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: 'test-secret-test-secret-test-secret-32' });
const userTokenService = new UserTokenService(jwtService, prisma);
const capturedEmails: SendEmailParams[] = [];
const fakeEmailPort: EmailPort = {
  send: (params) => {
    capturedEmails.push(params);
    return Promise.resolve();
  },
};
const signupService = new SignupService(prisma, userTokenService, fakeEmailPort);

const createdUserIds: string[] = [];

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

afterAll(async () => {
  await prisma.userSignupRequest.deleteMany({
    where: { cpfHash: { in: await cpfHashesOf(createdUserIds) } },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

async function cpfHashesOf(userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { cpfHash: true } });
  return users.map((u) => u.cpfHash);
}

describe('SignupService.requestOtp — anti-enumeração no claim', () => {
  it('CPF inexistente e CPF existente porém ACTIVE (sem PENDING_CLAIM) dão o mesmo erro, com a mesma quantidade de queries', async () => {
    const activeCpf = randomCpf();
    const user = await prisma.user.create({
      data: {
        cpfEncrypted: encryptCpf(activeCpf),
        cpfHash: hashCpf(activeCpf),
        name: 'Já Ativo',
        email: `already-active-${randomUUID()}@test.coins-api.dev`,
        status: 'ACTIVE',
      },
    });
    createdUserIds.push(user.id);

    const userFindUniqueSpy = jest.spyOn(prisma.user, 'findUnique');

    userFindUniqueSpy.mockClear();
    const errorForNewCpf = await signupService
      .requestOtp({ cpf: randomCpf(), name: 'CPF Novo', email: `new-${randomUUID()}@test.coins-api.dev` })
      .catch((error: unknown) => error);
    const callsForNewCpf = userFindUniqueSpy.mock.calls.length;

    userFindUniqueSpy.mockClear();
    const errorForActiveCpf = await signupService
      .requestOtp({ cpf: activeCpf, name: 'Ignorado', email: `ignored-${randomUUID()}@test.coins-api.dev` })
      .catch((error: unknown) => error);
    const callsForActiveCpf = userFindUniqueSpy.mock.calls.length;

    userFindUniqueSpy.mockRestore();

    // Mesma quantidade de round-trips ao banco (1 — só o findUnique inicial, nenhuma query
    // extra em nenhum dos dois casos) e o MESMO erro — não dá pra saber, pela resposta, se o
    // CPF já existe no sistema (ACTIVE) ou nunca foi visto.
    expect(callsForNewCpf).toBe(1);
    expect(callsForActiveCpf).toBe(1);
    expect(errorForNewCpf).toBeInstanceOf(CpfNotInvitedException);
    expect(errorForActiveCpf).toBeInstanceOf(CpfNotInvitedException);
    expect((errorForNewCpf as CpfNotInvitedException).getResponse()).toEqual(
      (errorForActiveCpf as CpfNotInvitedException).getResponse(),
    );
  });
});
