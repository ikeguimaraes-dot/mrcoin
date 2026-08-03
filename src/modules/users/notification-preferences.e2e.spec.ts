import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../app.module';
import { PrismaService } from '../../prisma/prisma.service';
import { encryptCpf, hashCpf } from '../../common/crypto/cpf-crypto.util';

interface PreferencesResponseBody {
  notificationsEnabled: boolean;
}

const prisma = new PrismaService();
const jwtService = new JwtService({ secret: process.env.JWT_ACCESS_SECRET });

const createdUserIds: string[] = [];

let app: INestApplication;
let server: Server;

function tokenFor(userId: string): Promise<string> {
  return jwtService.signAsync({ sub: userId, type: 'user' });
}

async function createUser(): Promise<{ userId: string }> {
  const suffix = randomUUID();
  const cpf = suffix.replace(/-/g, '').slice(0, 11);
  const user = await prisma.user.create({
    data: { cpfEncrypted: encryptCpf(cpf), cpfHash: hashCpf(cpf), name: `Notif Prefs Test User ${suffix}` },
  });
  createdUserIds.push(user.id);
  return { userId: user.id };
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

describe('GET/PATCH /users/me/notification-preferences', () => {
  it('vem true por padrão num usuário novo', async () => {
    const { userId } = await createUser();
    const token = await tokenFor(userId);

    const response = await request(server)
      .get('/users/me/notification-preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect((response.body as PreferencesResponseBody).notificationsEnabled).toBe(true);
  });

  it('PATCH persiste e GET reflete o novo valor', async () => {
    const { userId } = await createUser();
    const token = await tokenFor(userId);

    const patchResponse = await request(server)
      .patch('/users/me/notification-preferences')
      .set('Authorization', `Bearer ${token}`)
      .send({ notificationsEnabled: false })
      .expect(200);
    expect((patchResponse.body as PreferencesResponseBody).notificationsEnabled).toBe(false);

    const getResponse = await request(server)
      .get('/users/me/notification-preferences')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((getResponse.body as PreferencesResponseBody).notificationsEnabled).toBe(false);

    const dbUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    expect(dbUser.notificationsEnabled).toBe(false);
  });
});
