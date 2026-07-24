import Redis from 'ioredis';

/**
 * Fábrica compartilhada de conexão com o Redis (Upstash). `maxRetriesPerRequest: null` é
 * exigido pelo BullMQ Worker; `enableReadyCheck: false` é recomendado para proxies
 * gerenciados como o Upstash. Cada consumidor (BullMQ, rate limiter) cria sua PRÓPRIA
 * conexão via esta fábrica — não compartilhar a mesma instância com o BullMQ, que usa
 * comandos bloqueantes que não devem dividir conexão com uso genérico.
 */
export function createRedisConnection(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
