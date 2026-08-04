import { createHash, randomInt, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { UserTokenService } from './user-token.service';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: 'test-secret-test-secret-test-secret-32' });
const userTokenService = new UserTokenService(jwtService, prisma);

const createdUserIds: string[] = [];

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createUserFixture(): Promise<{ userId: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Token Test User ${suffix}`,
      email: `user-token-test-${suffix}@test.coins-api.dev`,
    },
  });
  createdUserIds.push(user.id);
  return { userId: user.id };
}

afterAll(async () => {
  await prisma.userRefreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('UserTokenService', () => {
  it('issueTokenPair emite um access token JWT válido e um refresh token novo', async () => {
    const { userId } = await createUserFixture();
    const pair = await userTokenService.issueTokenPair(userId);

    expect(pair.refreshToken).toEqual(expect.any(String));
    expect(pair.tokenType).toBe('Bearer');

    const payload = await jwtService.verifyAsync<{ sub: string; type: string }>(pair.accessToken);
    expect(payload).toMatchObject({ sub: userId, type: 'user' });

    const count = await prisma.userRefreshToken.count({ where: { userId } });
    expect(count).toBe(1);
  });

  it('rotateRefreshToken emite um novo par e revoga o token antigo (mesma family)', async () => {
    const { userId } = await createUserFixture();
    const original = await userTokenService.issueTokenPair(userId);

    const rotated = await userTokenService.rotateRefreshToken(original.refreshToken);

    expect(rotated.refreshToken).not.toBe(original.refreshToken);

    const originalHash = createHash('sha256').update(original.refreshToken).digest('hex');
    const originalRecord = await prisma.userRefreshToken.findUniqueOrThrow({ where: { tokenHash: originalHash } });
    const rotatedHash = createHash('sha256').update(rotated.refreshToken).digest('hex');
    const rotatedRecord = await prisma.userRefreshToken.findUniqueOrThrow({ where: { tokenHash: rotatedHash } });

    expect(originalRecord.revokedAt).not.toBeNull();
    expect(originalRecord.replacedById).toBe(rotatedRecord.id);
    expect(rotatedRecord.family).toBe(originalRecord.family);
  });

  it('reuso de um refresh token já rotacionado derruba a family inteira', async () => {
    const { userId } = await createUserFixture();
    const original = await userTokenService.issueTokenPair(userId);
    const rotated = await userTokenService.rotateRefreshToken(original.refreshToken);

    await expect(userTokenService.rotateRefreshToken(original.refreshToken)).rejects.toThrow();
    await expect(userTokenService.rotateRefreshToken(rotated.refreshToken)).rejects.toThrow();
  });

  it('revokeRefreshToken (logout) impede reuso subsequente', async () => {
    const { userId } = await createUserFixture();
    const pair = await userTokenService.issueTokenPair(userId);

    await userTokenService.revokeRefreshToken(pair.refreshToken);

    await expect(userTokenService.rotateRefreshToken(pair.refreshToken)).rejects.toThrow();
  });

  it('concorrência: duas rotações simultâneas do mesmo refresh token — só uma passa', async () => {
    const { userId } = await createUserFixture();
    const pair = await userTokenService.issueTokenPair(userId);

    const results = await Promise.allSettled([
      userTokenService.rotateRefreshToken(pair.refreshToken),
      userTokenService.rotateRefreshToken(pair.refreshToken),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
