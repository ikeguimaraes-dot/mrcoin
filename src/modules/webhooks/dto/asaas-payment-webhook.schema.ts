import { z } from 'zod';

export const asaasPaymentWebhookSchema = z
  .object({
    event: z.string().min(1),
    payment: z.object({
      id: z.string().min(1),
      status: z.string().min(1),
    }),
  })
  .passthrough();

export type AsaasPaymentWebhookInput = z.infer<typeof asaasPaymentWebhookSchema>;
