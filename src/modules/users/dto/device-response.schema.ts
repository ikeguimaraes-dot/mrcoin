import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const deviceResponseSchema = z.object({
  id: z.string(),
  fingerprint: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export class DeviceResponseDto extends createZodDto(deviceResponseSchema) {}
