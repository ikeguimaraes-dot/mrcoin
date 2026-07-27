import { Injectable } from '@nestjs/common';
import { Device } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RegisterDeviceInput } from './dto/register-device.schema';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  register(userId: string, input: RegisterDeviceInput): Promise<Device> {
    return this.prisma.device.upsert({
      where: { userId_fingerprint: { userId, fingerprint: input.fingerprint } },
      create: { userId, fingerprint: input.fingerprint, pushToken: input.pushToken },
      update: { pushToken: input.pushToken },
    });
  }
}
