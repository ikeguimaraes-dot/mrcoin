import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

const logger = new Logger('RedisConnection');

/**
 * Fábrica compartilhada de conexão com o Redis. `maxRetriesPerRequest: null` é exigido pelo
 * BullMQ Worker; `enableReadyCheck: false` é recomendado para proxies gerenciados. Cada
 * consumidor (BullMQ, rate limiter) cria sua PRÓPRIA conexão via esta fábrica — não
 * compartilhar a mesma instância com o BullMQ, que usa comandos bloqueantes que não devem
 * dividir conexão com uso genérico.
 *
 * `reconnectOnError` é o que evita um incidente já visto em produção: erros de COMANDO
 * (cota estourada, réplica read-only, timeout) chegam numa conexão que o ioredis considera
 * saudável, então sem isso o `retryStrategy` nunca entra em ação e o loop de polling
 * bloqueante do BullMQ reemite o mesmo comando instantaneamente, sem limite. Forçar
 * reconexão nesses erros faz o backoff do `retryStrategy` valer também para eles.
 */
export function createRedisConnection(url: string): Redis {
  const client = new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    retryStrategy: (times) => Math.min(times * 500, 30_000),
    reconnectOnError: (err) => /max requests limit exceeded|READONLY|ETIMEDOUT|ECONNRESET/i.test(err.message),
  });

  client.on('error', (err) => logger.error(err.message));

  return client;
}
