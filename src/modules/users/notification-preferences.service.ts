import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { UpdateNotificationPreferencesInput } from './dto/notification-preferences.schema';

@Injectable()
export class NotificationPreferencesService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<{ notificationsEnabled: boolean }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { notificationsEnabled: true },
    });
    return { notificationsEnabled: user.notificationsEnabled };
  }

  async update(
    userId: string,
    input: UpdateNotificationPreferencesInput,
  ): Promise<{ notificationsEnabled: boolean }> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { notificationsEnabled: input.notificationsEnabled },
      select: { notificationsEnabled: true },
    });
    return { notificationsEnabled: user.notificationsEnabled };
  }
}
