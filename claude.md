# CLAUDE.md — coins-api

Backend único da plataforma de loyalty coins. **Este é o único software com acesso ao banco de dados.** Toda regra de negócio mora aqui.

Em caso de conflito entre um pedido pontual e este arquivo, alertar antes de implementar.

---

## Contexto do produto

Empresas compram coins e distribuem para clientes ou funcionários. Usuários acumulam numa carteira e resgatam em uma rede de parceiros. Esta API atende três clientes: `coins-admin` (painel das empresas), `coins-app` (app do usuário) e `coins-partner` (portal do parceiro).

## Stack

- **TypeScript estrito** (`strict: true`, sem `any`)
- **NestJS** — módulos com controller / service / dto
- **Prisma** — ORM e migrations
- **PostgreSQL** (Neon) · **Redis + BullMQ** (Upstash) para filas e agendamentos
- **zod** para validação de entrada
- **@nestjs/swagger** — o `openapi.json` gerado é o contrato público consumido pelos frontends

## Estrutura

```
src/
├── modules/
│   ├── auth/            organizations/   users/        wallets/
│   ├── ledger/  ★       batches/         distributions/ campaigns/
│   ├── partners/        offers/          redemptions/   settlements/
│   ├── billing/         notifications/   jobs/          webhooks/
├── common/     guards, decorators, filtros de erro, pipes, interceptors
└── config/
prisma/schema.prisma
```

Cada módulo: `*.controller.ts` (rotas), `*.service.ts` (regra), `dto/` (zod). Regra de negócio nunca no controller.

---

## ⛔ REGRAS INVIOLÁVEIS DO LEDGER

O ledger é o coração financeiro. Nunca flexibilizar:

1. **Toda movimentação de coin passa por `LedgerService.post()`.** Nenhum outro módulo escreve em `LedgerEntry` ou em `Wallet.cachedBalance`. Módulo novo que precise mover coins injeta o `LedgerService`.
2. **Atomicidade:** inserir entry + atualizar `cachedBalance` + checar `version` (optimistic lock) no MESMO `prisma.$transaction`.
3. **Idempotência obrigatória:** toda operação recebe `idempotencyKey` única. Chave repetida retorna o resultado original — nunca executa duas vezes.
4. **Débito só com saldo:** validar `cachedBalance - amount >= 0` DENTRO da transação. Saldo negativo é bug crítico, não caso de borda.
5. **`LedgerEntry` é imutável:** nunca UPDATE, nunca DELETE. Correção = novo entry `REVERSAL` referenciando o original.
6. **Hash encadeado:** cada entry grava `hash = sha256(prevHash + payload canônico)`. Não remover nem simplificar.
7. **Expiração via job diário**, FIFO por `batchId`, gerando entries `EXPIRE`. Nunca zerar saldo diretamente.
8. **Resgate é compra instantânea.** `POST /redemptions` já debita na hora (com PIN de transação validado antes do débito) e o resgate nasce `CONFIRMED` — não existe mais estado "aguardando parceiro" nem expiração. `DELIVERED` (marcado pelo parceiro ou por um platform admin) é só a confirmação de entrega física, nunca move coins.

**Valores sempre em inteiros (centavos).** Float para dinheiro é proibido.

---

## 🔒 Segurança

- **Multi-tenant no servidor:** todo query filtra por `organizationId` extraído do JWT. NUNCA aceitar `organizationId` do body ou params para definir escopo de dados.
- **RBAC:** `@Roles(...)` nos endpoints admin. Hierarquia: OWNER > MANAGER > OPERATOR > VIEWER.
- **Senhas:** argon2id. **Tokens:** access 15 min + refresh rotativo com detecção de reuso.
- **MFA TOTP** obrigatório para OWNER e MANAGER.
- **CPF:** criptografado em repouso (AES-256-GCM, chave via env) + coluna `cpfHash` (HMAC) para busca. Nunca logar CPF em claro.
- **`Idempotency-Key`** header obrigatório em POSTs financeiros da API pública.
- **Webhooks recebidos:** verificar assinatura ANTES de processar qualquer coisa.
- **Rate limit** em auth e API pública.
- **`AuditLog`** em toda escrita do admin: actor, action, payload, IP.
- Secrets só em variáveis de ambiente. Nunca commitar `.env`.

## Convenções

- Código, tabelas e variáveis em **inglês**; mensagens de usuário em **pt-BR**.
- Datas em UTC no banco.
- Erros no formato `{ code, message, details? }` com códigos estáveis: `INSUFFICIENT_BALANCE`, `BATCH_EXPIRED`, `REDEMPTION_EXPIRED`, `IDEMPOTENCY_CONFLICT`.
- Trabalho pesado (CSV, notificações em massa, settlement) sempre em fila BullMQ — nunca no request handler.
- Paginação por cursor em listas grandes (extrato, membros).
- Todo endpoint documentado com decorators do Swagger — o contrato gerado é o que os frontends consomem.
- Conventional commits (`feat:`, `fix:`, `chore:`).

## Testes

**Cobertura obrigatória no ledger:** concorrência (dois débitos simultâneos na mesma carteira), idempotência, saldo insuficiente, reversal, expiração FIFO, integridade da cadeia de hashes.

Testes de integração nos fluxos críticos: compra de lote via webhook do PSP, distribuição por CSV, resgate ponta a ponta.

`pnpm test` e `pnpm lint` devem passar antes de qualquer tarefa ser considerada concluída.

## Ambiente local

```bash
pnpm install
# .env aponta para um branch de desenvolvimento no Neon; Redis usa a instância local do Homebrew
brew services start redis  # se ainda não estiver rodando
pnpm prisma migrate dev
pnpm prisma db seed        # 1 org, 20 usuários, 3 parceiros
pnpm start:dev
```

Sem Docker. Banco é gerenciado na nuvem (Neon) em todos os ambientes. Redis roda local via Homebrew (`redis://localhost:6379`) em `development` e `test` — o plano free do Upstash permite só um database e é reservado para produção. Em `production`, Redis continua no Upstash com TLS obrigatório (`rediss://`); `env.schema.ts` exige o esquema `rediss://` apenas quando `NODE_ENV=production`.

## Jobs agendados

| Job | Frequência | O que faz |
|---|---|---|
| `expire-coins` | diário | Expira coins vencidos (FIFO por lote) |
| `reconcile-balances` | diário | Compara soma dos entries com `cachedBalance`; divergência → alerta |
| `verify-hash-chain` | diário | Valida integridade da cadeia de hashes |
| `close-settlements` | semanal | Fecha período e dispara Pix aos parceiros |
| `expiring-reminders` | diário | Notifica usuários com coins vencendo em 30/15/5 dias |

## O que NÃO fazer

- Não dar acesso ao banco a nenhum outro serviço. Quem precisa de dado, consome esta API.
- Não criar endpoint que edite saldo, entries ou resgates confirmados.
- Não permitir saque, transferência entre usuários ou conversão de coins em dinheiro — o circuito fechado é a fronteira regulatória do produto (evita configurar arranjo de pagamento sob o Banco Central).
- Não adicionar blockchain, microserviços ou tecnologia nova sem discussão. A arquitetura é um monólito modular intencional.
- Não usar `any`; não desabilitar regra de lint sem justificativa em comentário.
- Não processar CSV ou disparos em massa dentro do request.