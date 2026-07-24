import { z } from 'zod';

export const acceptInviteSchema = z.object({
  name: z.string().min(1),
  password: z
    .string()
    .min(10, 'A senha precisa ter no mínimo 10 caracteres.')
    .regex(/[a-zA-Z]/, 'A senha precisa ter ao menos uma letra.')
    .regex(/[0-9]/, 'A senha precisa ter ao menos um número.'),
});

export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
