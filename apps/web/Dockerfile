FROM node:22.21.1-bookworm-slim AS base
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @cdc/web... --filter @cdc/shared
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @cdc/shared build && pnpm --filter @cdc/web build

FROM node:22.21.1-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=America/Manaus
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
RUN useradd --system --uid 1001 cdc
USER cdc
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
