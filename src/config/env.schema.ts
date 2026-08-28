import { z } from 'zod';

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: z.string().url(),
    DIRECT_URL: z.string().url(),
    CPF_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'deve ter 32 bytes em hex (64 caracteres)'),
    CPF_HASH_SECRET: z.string().min(32),
    // TLS (rediss://) é exigido só em produção. Em development/test, redis:// também é
    // aceito — Redis local, sem depender de cota de plano gratuito de provedor gerenciado.
    REDIS_URL: z
      .string()
      .url()
      .regex(/^rediss?:\/\//, 'REDIS_URL precisa usar o esquema redis:// ou rediss://'),
    // Libera redis:// (sem TLS) em produção quando a conexão fica dentro da rede privada
    // do provedor de hosting — a criptografia já acontece na camada de rede (ex.: WireGuard
    // no Railway), então TLS no protocolo Redis seria redundante. Portável entre provedores
    // (não depende de reconhecer o padrão de hostname interno de cada um).
    REDIS_ALLOW_PLAINTEXT: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    JWT_ACCESS_SECRET: z.string().min(32),
    // Secret dedicado, separado do JWT_ACCESS_SECRET usado por AdminUser/Partner/User —
    // PlatformAdmin é o nível mais privilegiado, então tem sua própria instância de
    // JwtService (ver PlatformAdminModule) pra isolamento real, não só a claim `type`.
    PLATFORM_ADMIN_JWT_SECRET: z.string().min(32),
    MFA_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, 'deve ter 32 bytes em hex (64 caracteres)'),
    ADMIN_PANEL_URL: z.string().url().default('http://localhost:3001'),
    ASAAS_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    ASAAS_API_KEY: z.string().min(1),
    ASAAS_BASE_URL: z.string().url().default('https://api-sandbox.asaas.com/v3'),
    ASAAS_WEBHOOK_SECRET: z.string().min(16),
    LOCAL_STORAGE_DIR: z.string().min(1).default('./uploads'),
    // Só obrigatórias em produção (ver superRefine) — dev/test usam ConsoleEmailAdapter,
    // que não manda e-mail de verdade e não precisa de credencial nenhuma.
    RESEND_API_KEY: z.string().min(1).optional(),
    RESEND_FROM_EMAIL: z.string().email().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'production') return;

    if (!data.REDIS_URL.startsWith('rediss://') && !data.REDIS_ALLOW_PLAINTEXT) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['REDIS_URL'],
        message:
          'REDIS_URL precisa usar rediss:// (TLS) em produção, a menos que REDIS_ALLOW_PLAINTEXT=true esteja setado (rede privada do provedor, já criptografada na camada de rede)',
      });
    }

    if (!data.RESEND_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RESEND_API_KEY'], message: 'obrigatório em produção' });
    }

    if (!data.RESEND_FROM_EMAIL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RESEND_FROM_EMAIL'], message: 'obrigatório em produção' });
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
