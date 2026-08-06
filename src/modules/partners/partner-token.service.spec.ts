import { createHash, randomUUID } from 'node:crypto';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service';
import { PartnerTokenService } from './partner-token.service';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: 'test-secret-test-secret-test-secret-32' });
const partnerTokenService = new PartnerTokenService(jwtService, prisma);

const createdPartnerIds: string[] = [];

async function createPartnerFixture(): Promise<{ partnerId: string }> {
  const suffix = randomUUID();
  const partner = await prisma.partner.create({
    data: {
      name: `Token Test Partner ${suffix}`,
      cnpj: suffix.replace(/-/g, '').slice(0, 14),
      category: 'Teste',
      takeRateBps: 500,
      pixKey: `pix-${suffix}@test.coins-api.dev`,
    },
  });
  createdPartnerIds.push(partner.id);
  return { partnerId: partner.id };
}

afterAll(async () => {
  await prisma.partnerRefreshToken.deleteMany({ where: { partnerId: { in: createdPartnerIds } } });
  await prisma.partner.deleteMany({ where: { id: { in: createdPartnerIds } } });
  await prisma.$disconnect();
});

describe('PartnerTokenService', () => {
  it('issueTokenPair emite um access token JWT válido e um refresh token novo', async () => {
    const { partnerId } = await createPartnerFixture();
    const pair = await partnerTokenService.issueTokenPair(partnerId);

    expect(pair.refreshToken).toEqual(expect.any(String));
    expect(pair.tokenType).toBe('Bearer');

    const payload = await jwtService.verifyAsync<{ sub: string; type: string }>(pair.accessToken);
    expect(payload).toMatchObject({ sub: partnerId, type: 'partner' });

    const count = await prisma.partnerRefreshToken.count({ where: { partnerId } });
    expect(count).toBe(1);
  });

  it('rotateRefreshToken emite um novo par e revoga o token antigo (mesma family)', async () => {
    const { partnerId } = await createPartnerFixture();
    const original = await partnerTokenService.issueTokenPair(partnerId);

    const rotated = await partnerTokenService.rotateRefreshToken(original.refreshToken);

    expect(rotated.refreshToken).not.toBe(original.refreshToken);

    const originalHash = createHash('sha256').update(original.refreshToken).digest('hex');
    const originalRecord = await prisma.partnerRefreshToken.findUniqueOrThrow({
      where: { tokenHash: originalHash },
    });
    const rotatedHash = createHash('sha256').update(rotated.refreshToken).digest('hex');
    const rotatedRecord = await prisma.partnerRefreshToken.findUniqueOrThrow({ where: { tokenHash: rotatedHash } });

    expect(originalRecord.revokedAt).not.toBeNull();
    expect(originalRecord.replacedById).toBe(rotatedRecord.id);
    expect(rotatedRecord.family).toBe(originalRecord.family);
  });

  it('reuso de um refresh token já rotacionado derruba a family inteira', async () => {
    const { partnerId } = await createPartnerFixture();
    const original = await partnerTokenService.issueTokenPair(partnerId);
    const rotated = await partnerTokenService.rotateRefreshToken(original.refreshToken);

    await expect(partnerTokenService.rotateRefreshToken(original.refreshToken)).rejects.toThrow();
    await expect(partnerTokenService.rotateRefreshToken(rotated.refreshToken)).rejects.toThrow();
  });

  it('revokeRefreshToken (logout) impede reuso subsequente', async () => {
    const { partnerId } = await createPartnerFixture();
    const pair = await partnerTokenService.issueTokenPair(partnerId);

    await partnerTokenService.revokeRefreshToken(pair.refreshToken);

    await expect(partnerTokenService.rotateRefreshToken(pair.refreshToken)).rejects.toThrow();
  });

  it('concorrência: duas rotações simultâneas do mesmo refresh token — só uma passa', async () => {
    const { partnerId } = await createPartnerFixture();
    const pair = await partnerTokenService.issueTokenPair(partnerId);

    const results = await Promise.allSettled([
      partnerTokenService.rotateRefreshToken(pair.refreshToken),
      partnerTokenService.rotateRefreshToken(pair.refreshToken),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
  });
});
