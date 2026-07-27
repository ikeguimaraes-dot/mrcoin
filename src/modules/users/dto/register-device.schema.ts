import { z } from 'zod';

export const registerDeviceSchema = z.object({
  fingerprint: z.string().min(1),
  pushToken: z.string().min(1).optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
