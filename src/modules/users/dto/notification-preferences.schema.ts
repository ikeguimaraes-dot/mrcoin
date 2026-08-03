import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateNotificationPreferencesSchema = z.object({
  notificationsEnabled: z.boolean(),
});
export type UpdateNotificationPreferencesInput = z.infer<typeof updateNotificationPreferencesSchema>;
export class UpdateNotificationPreferencesDto extends createZodDto(updateNotificationPreferencesSchema) {}

export const notificationPreferencesResponseSchema = z.object({
  notificationsEnabled: z.boolean(),
});
export class NotificationPreferencesResponseDto extends createZodDto(notificationPreferencesResponseSchema) {}
