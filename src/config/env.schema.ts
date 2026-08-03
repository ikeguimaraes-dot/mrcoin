import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url(),
    CPF_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'deve ter 32 bytes em hex (64 caracteres)'),
    CPF_HASH_SECRET: z.string().min(32),
    // TLS (rediss://) é exigido fora de teste (Upstash em dev/produção). Em NODE_ENV=test,
    // redis:// também é aceito — Redis local pra suíte, sem depender de cota de plano gratuito.
    REDIS_URL: z
      .string()
      .url()
      .regex(/^rediss?:\/\//, 'REDIS_URL precisa usar o esquema redis:// ou rediss://'),
    JWT_ACCESS_SECRET: z.string().min(32),
    MFA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'deve ter 32 bytes em hex (64 caracteres)'),
    ADMIN_PANEL_URL: z.string().url().default('http://localhost:3001'),
    ASAAS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    ASAAS_API_KEY: z.string().min(1),
    ASAAS_BASE_URL: z.string().url().default('https://api-sandbox.asaas.com/v3'),
    ASAAS_WEBHOOK_SECRET: z.string().min(16),
    LOCAL_STORAGE_DIR: z.string().min(1).default('./uploads'),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'test' && !data.REDIS_URL.startsWith('rediss://')) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message: 'Upstash exige TLS — use o esquema rediss:// (redis:// só é aceito com NODE_ENV=test)',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Variáveis de ambiente inválidas: ${details}`);
  }

  return parsed.data;
}
