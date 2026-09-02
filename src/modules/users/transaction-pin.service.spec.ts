import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { createRedisConnection } from '../../common/redis/redis-connection.factory';
import { TransactionPinService } from './transaction-pin.service';
import { InvalidPinException } from './exceptions/invalid-pin.exception';
import { PinLockedException } from './exceptions/pin-locked.exception';
import { TransactionPinNotSetException } from './exceptions/transaction-pin-not-set.exception';

const prisma = new PrismaService();
const redis = createRedisConnection(process.env.REDIS_URL as string);
const transactionPinService = new TransactionPinService(prisma, redis);

const createdUserIds: string[] = [];

async function createUser(): Promise<string> {
  const suffix = randomUUID();
  const cpf = suffix.replace(/-/g, '').slice(0, 11);
  const user = await prisma.user.create({
    data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name: `PIN Test User ${suffix}` },
  });
  createdUserIds.push(user.id);
  return user.id;
}

afterAll(async () => {
  const keys = await redis.keys('pin-fail:*');
  const ownKeys = keys.filter((key) => createdUserIds.some((id) => key === `pin-fail:${id}`));
  if (ownKeys.length > 0) {
    await redis.del(...ownKeys);
  }
  redis.disconnect();
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('TransactionPinService', () => {
  it('setPin + verifyPin com o PIN certo passa sem lançar', async () => {
    const userId = await createUser();
    await transactionPinService.setPin(userId, '8264');

    await expect(transactionPinService.verifyPin(userId, '8264')).resolves.toBeUndefined();
  });

  it('verifyPin sem PIN configurado lança TransactionPinNotSetException', async () => {
    const userId = await createUser();

    await expect(transactionPinService.verifyPin(userId, '8264')).rejects.toBeInstanceOf(TransactionPinNotSetException);
  });

  it('PIN errado lança InvalidPinException com attemptsRemaining decrescente, sem debitar nada', async () => {
    const userId = await createUser();
    await transactionPinService.setPin(userId, '8264');

    const firstError = await transactionPinService.verifyPin(userId, '0000').catch((error: unknown) => error);
    expect(firstError).toBeInstanceOf(InvalidPinException);
    expect((firstError as InvalidPinException).getResponse()).toMatchObject({
      code: 'INVALID_PIN',
      details: { attemptsRemaining: 4 },
    });

    const secondError = await transactionPinService.verifyPin(userId, '0000').catch((error: unknown) => error);
    expect((secondError as InvalidPinException).getResponse()).toMatchObject({ details: { attemptsRemaining: 3 } });
  });

  it('5 erros seguidos bloqueiam — 6ª tentativa com PIN certo ainda dá PinLockedException', async () => {
    const userId = await createUser();
    await transactionPinService.setPin(userId, '8264');

    for (let i = 0; i < 4; i += 1) {
      await expect(transactionPinService.verifyPin(userId, '0000')).rejects.toBeInstanceOf(InvalidPinException);
    }
    await expect(transactionPinService.verifyPin(userId, '0000')).rejects.toBeInstanceOf(PinLockedException);
    await expect(transactionPinService.verifyPin(userId, '8264')).rejects.toBeInstanceOf(PinLockedException);
  });

  it('PIN certo depois de alguns erros reseta o contador de falhas', async () => {
    const userId = await createUser();
    await transactionPinService.setPin(userId, '8264');

    await expect(transactionPinService.verifyPin(userId, '0000')).rejects.toBeInstanceOf(InvalidPinException);
    await expect(transactionPinService.verifyPin(userId, '0000')).rejects.toBeInstanceOf(InvalidPinException);
    await expect(transactionPinService.verifyPin(userId, '8264')).resolves.toBeUndefined();

    // Contador zerado — a próxima falha volta a ter 4 tentativas restantes, não continua de 2.
    const error = await transactionPinService.verifyPin(userId, '0000').catch((e: unknown) => e);
    expect((error as InvalidPinException).getResponse()).toMatchObject({ details: { attemptsRemaining: 4 } });
  });
});
