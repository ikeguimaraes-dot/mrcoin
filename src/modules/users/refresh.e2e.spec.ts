import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';
import { UserTokenService } from './user-token.service';

interface TokenPairBody {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
}

interface ErrorResponseBody {
  code: string;
}

const prisma = new PrismaService();

const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;
let userTokenService: UserTokenService;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createUser(): Promise<{ userId: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Refresh Test User ${suffix}`,
      email: `refresh-test-${suffix}@test.coins-api.dev`,
    },
  });
  createdUserIds.push(user.id);
  return { userId: user.id };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
  userTokenService = moduleRef.get(UserTokenService);
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.userRefreshToken.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('POST /users/refresh', () => {
  it('rotaciona o par e o token antigo não pode ser reusado', async () => {
    const { userId } = await createUser();
    const original = await userTokenService.issueTokenPair(userId);

    const response = await request(server)
      .post('/users/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(200);

    const rotated = response.body as TokenPairBody;
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(original.refreshToken);
    expect(rotated.tokenType).toBe('Bearer');

    const reuse = await request(server)
      .post('/users/refresh')
      .send({ refreshToken: original.refreshToken })
      .expect(401);
    expect((reuse.body as ErrorResponseBody).code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('refresh token inexistente retorna INVALID_REFRESH_TOKEN', async () => {
    const response = await request(server)
      .post('/users/refresh')
      .send({ refreshToken: 'nao-existe' })
      .expect(401);
    expect((response.body as ErrorResponseBody).code).toBe('INVALID_REFRESH_TOKEN');
  });
});

describe('POST /users/logout', () => {
  it('revoga o refresh token — reuso depois falha', async () => {
    const { userId } = await createUser();
    const pair = await userTokenService.issueTokenPair(userId);

    await request(server).post('/users/logout').send({ refreshToken: pair.refreshToken }).expect(204);

    const response = await request(server)
      .post('/users/refresh')
      .send({ refreshToken: pair.refreshToken })
      .expect(401);
    expect((response.body as ErrorResponseBody).code).toBe('INVALID_REFRESH_TOKEN');
  });
});
