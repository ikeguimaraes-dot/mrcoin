# syntax=docker/dockerfile:1

# pnpm 11.5.2 instalado direto via npm, sem corepack — corepack embutido
# (e o corepack@0.24.1 que o Nixpacks força) não carrega pnpm 11.x de forma
# confiável (ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING, reproduzido e
# documentado nos commits anteriores). Manter esta versão em sincronia com
# package.json#packageManager.
FROM node:22.14.0-slim AS base
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@11.5.2
WORKDIR /app

FROM base AS deps
# argon2 tem build nativo aprovado em pnpm-workspace.yaml (allowBuilds) —
# toolchain de compilação fica só nesta stage, não vai pra imagem final.
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm run build
RUN pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json

EXPOSE 3000
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/src/main.js"]
