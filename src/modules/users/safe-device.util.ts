import { Prisma } from '@prisma/client';

/** Shape de Device seguro pra sair em resposta HTTP — nunca pushToken (quem enviou já tem o
 * valor; é credencial de disparo de push notification) nem userId (o chamador já se
 * identifica via JWT, não precisa do próprio id de volta). */
export const SAFE_DEVICE_SELECT = {
  id: true,
  fingerprint: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.DeviceSelect;

export type SafeDevice = Prisma.DeviceGetPayload<{ select: typeof SAFE_DEVICE_SELECT }>;
