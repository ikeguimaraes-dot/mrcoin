import { config } from 'dotenv';

config({ quiet: true });
// .env.test é opcional — sobrescreve só as chaves presentes nele (hoje, REDIS_URL: instância
// Upstash separada pra teste, evitando bater na cota da de dev). Sem esse arquivo, os testes
// seguem usando o REDIS_URL do .env normal, como sempre funcionou.
config({ path: '.env.test', override: true, quiet: true });
