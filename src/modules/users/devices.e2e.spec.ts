import { randomInt, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

function randomCpf(): string {
  return randomInt(10_000_000_000, 100_000_000_000).toString();
}

async function createUser(): Promise<{ userId: string; token: string }> {
  const cpf = randomCpf();
  const suffix = randomUUID();
  const user = await prisma.user.create({
    data: {
      cpfEncrypted: encryptCpf(cpf),
      cpfHash: hashCpf(cpf),
      name: `Device Test User ${suffix}`,
      email: `device-test-${suffix}@test.coins-api.dev`,
    },
  });
  createdUserIds.push(user.id);

  const token = await jwtService.signAsync({ sub: user.id, type: 'user' });
  return { userId: user.id, token };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  await app.init();
  server = app.getHttpServer() as Server;
}, 30000);

afterAll(async () => {
  await app.close();
  await prisma.device.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe('POST /devices', () => {
  it('registra um device novo', async () => {
    const { userId, token } = await createUser();
    const fingerprint = `fp-${randomUUID()}`;

    await request(server)
      .post('/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ fingerprint, pushToken: 'push-token-1' })
      .expect(200);

    const devices = await prisma.device.findMany({ where: { userId } });
    expect(devices).toHaveLength(1);
    expect(devices[0]?.pushToken).toBe('push-token-1');
  });

  it('reenviar com o mesmo fingerprint atualiza o pushToken em vez de duplicar', async () => {
    const { userId, token } = await createUser();
    const fingerprint = `fp-${randomUUID()}`;

    await request(server)
      .post('/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ fingerprint, pushToken: 'push-token-old' })
      .expect(200);

    await request(server)
      .post('/devices')
      .set('Authorization', `Bearer ${token}`)
      .send({ fingerprint, pushToken: 'push-token-new' })
      .expect(200);

    const devices = await prisma.device.findMany({ where: { userId } });
    expect(devices).toHaveLength(1);
    expect(devices[0]?.pushToken).toBe('push-token-new');
  });

  it('sem token de autenticação retorna 401', async () => {
    await request(server).post('/devices').send({ fingerprint: `fp-${randomUUID()}` }).expect(401);
  });
});
