# coins-api

Backend único da plataforma de loyalty coins. Ver `CLAUDE.md` na raiz para regras de arquitetura, ledger e segurança antes de contribuir.

## Stack

TypeScript estrito · NestJS · Prisma (PostgreSQL/Neon) · Redis + BullMQ (Upstash) · zod · @nestjs/swagger

## Setup local

```bash
pnpm install

# copie .env.example para .env e preencha com a connection string
# de um branch de desenvolvimento no Neon (DATABASE_URL pooled, DIRECT_URL direta)
cp .env.example .env

pnpm prisma:generate
pnpm prisma:migrate       # roda as migrations (a partir da Sessão 2, quando existem models)
pnpm start:dev
```

Sem Docker. Banco e Redis são gerenciados na nuvem (Neon / Upstash) em todos os ambientes, inclusive local.

## Scripts

| Script | O que faz |
|---|---|
| `pnpm start:dev` | Sobe a API em modo watch |
| `pnpm build` | Build de produção |
| `pnpm lint` | ESLint |
| `pnpm format` | Prettier |
| `pnpm test` | Testes (Jest) |
| `pnpm prisma:generate` | Gera o Prisma Client |
| `pnpm prisma:migrate` | Roda `prisma migrate dev` |
| `pnpm gen:openapi` | Gera `openapi.json` na raiz a partir dos decorators do Swagger — contrato consumido por `coins-admin`, `coins-app` e `coins-partner` |

## Health check

`GET /health` retorna o status da API e uma checagem real de conexão com o banco (`SELECT 1` via Prisma).

## Git hooks

O projeto já inclui `.husky/pre-commit` (roda `lint-staged`), mas o hook só é ativado quando este diretório tiver seu próprio repositório git. Depois de rodar `git init` aqui, execute `pnpm dlx husky init` (ou `pnpm exec husky`) uma vez para apontar `core.hooksPath` para `.husky/`.
