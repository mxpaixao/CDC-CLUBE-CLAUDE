# Imagem da API e do worker (mesmo código, comandos diferentes).
FROM node:22.21.1-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/rules/package.json packages/rules/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @cdc/api... --filter @cdc/shared --filter @cdc/rules
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm --filter @cdc/shared build && pnpm --filter @cdc/rules build && pnpm --filter @cdc/api build
RUN pnpm deploy --filter @cdc/api --prod --legacy /out && cp -r apps/api/dist apps/api/prisma /out/ \
 && cd /out && npx prisma generate --schema prisma/schema.prisma

FROM base AS runtime
ENV NODE_ENV=production TZ=America/Manaus
WORKDIR /app
COPY --from=build /out ./
RUN useradd --system --uid 1001 cdc && mkdir -p /app/importacoes /app/uploads && chown -R cdc /app/importacoes /app/uploads
USER cdc
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://localhost:3001/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# migrations versionadas são aplicadas na subida (idempotente)
CMD ["sh", "-c", "npx prisma migrate deploy --schema prisma/schema.prisma && node dist/src/main.js"]
