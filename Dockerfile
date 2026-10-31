FROM node:22-bookworm-slim AS build

# pnpm runs node-gyp on better-sqlite3's binding.gyp at install time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/
COPY packages/api/package.json packages/api/
COPY packages/backend/package.json packages/backend/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/persistence/package.json packages/persistence/
COPY packages/persistence-postgres/package.json packages/persistence-postgres/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter "@mezan/server..." --filter "web..."

COPY . .
# REQUIRED: the filtered install above is the whole install; pnpm's pre-run
# check would otherwise install every other workspace (Electron) here.
ENV pnpm_config_verify_deps_before_run=false
RUN pnpm --filter web build && pnpm --filter @mezan/server build

# The bundle inlines every JS dependency; better-sqlite3 stays external and
# loads prebuilds/<platform>-<arch>.node from its own directory at runtime.
RUN mkdir -p /runtime/node_modules \
  && cp -rL "$(dirname "$(node -p "require.resolve('better-sqlite3/package.json', { paths: ['packages/persistence'] })")")" /runtime/node_modules/better-sqlite3 \
  && cd /runtime/node_modules/better-sqlite3 \
  && rm -rf deps src build node_modules binding.gyp prebuilds/darwin-* prebuilds/win32-* prebuilds/linuxmusl-*

FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=build /runtime/node_modules node_modules
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/web/dist apps/web/dist

RUN mkdir -p /data && chown node:node /data

# NODE_ENV=production so @mezan/backend's resolveSeedAdminSecrets randomises the
# fallback admin password of every real tenant (audit S-1); cloud.ts refuses to start
# if MEZAN_SEED_ADMIN_PASSWORD pins it process-wide. Only the demo tenant keeps the
# published `Cyag@2026`, pinned in apps/server/src/demo-tenant.ts.
ENV NODE_ENV=production
ARG MEZAN_VERSION=dev
ENV MEZAN_VERSION=$MEZAN_VERSION
ENV MEZAN_PLATFORM_DIR=/data
ENV PORT=8080
EXPOSE 8080
USER node
# SECURITY / read-only root fs: started by node itself, with nothing to fetch
# or compile at boot; deploy/contabo runs this container read_only.
CMD ["node", "--enable-source-maps", "apps/server/dist/cloud.js"]
