import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDeviceInput } from './dto/register-device.schema';
import { SAFE_DEVICE_SELECT, SafeDevice } from './safe-device.util';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  register(userId: string, input: RegisterDeviceInput): Promise<SafeDevice> {
    return this.prisma.device.upsert({
      where: { userId_fingerprint: { userId, fingerprint: input.fingerprint } },
      create: { userId, fingerprint: input.fingerprint, pushToken: input.pushToken },
      update: { pushToken: input.pushToken },
      select: SAFE_DEVICE_SELECT,
    });
  }
}
