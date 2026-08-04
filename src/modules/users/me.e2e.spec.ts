import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';

interface MeResponseBody {
  id: string;
  name: string;
  email: string | null;
  cpfMasked: string;
  notificationsEnabled: boolean;
}

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createUser(overrides: { email?: string | null; notificationsEnabled?: boolean } = {}): Promise<{
  userId: string;
  cpf: string;
  token: string;
}> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Me Test User ${suffix}`,
      email: overrides.email === undefined ? `me-test-${suffix}@test.coins-api.dev` : overrides.email,
      notificationsEnabled: overrides.notificationsEnabled ?? true,
    },
  });
  createdUserIds.push(user.id);
  const token = await jwtService.signAsync({ sub: user.id, type: 'user' });
  return { userId: user.id, cpf, token };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('GET /users/me', () => {
  it('devolve exatamente id, name, email, cpfMasked e notificationsEnabled — nunca cpfEncrypted/cpfHash', async () => {
    const { userId, cpf, token } = await createUser();

    const response = await request(server)
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(Object.keys(response.body as object).sort()).toEqual([
      'cpfMasked',
      'email',
      'id',
      'name',
      'notificationsEnabled',
    ]);

    const body = response.body as MeResponseBody;
    expect(body.id).toBe(userId);
    expect(body.cpfMasked).toBe(`${cpf.slice(0, 3)}..-${cpf.slice(-2)}`);
    expect(body.notificationsEnabled).toBe(true);
    expect(response.body).not.toHaveProperty('cpfEncrypted');
    expect(response.body).not.toHaveProperty('cpfHash');
  });

  it('email null (conta sem contato verificado) aparece como null, não como erro', async () => {
    const { token } = await createUser({ email: null });

    const response = await request(server)
      .get('/users/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((response.body as MeResponseBody).email).toBeNull();
  });

  it('sem token de autenticação retorna 401', async () => {
    await request(server).get('/users/me').expect(401);
  });
});
