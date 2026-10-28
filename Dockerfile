FROM node:22-bookworm-slim

# better-sqlite3 falls back to a source build when no prebuild matches the host.
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
COPY apps/desktop/package.json apps/desktop/
COPY packages/api/package.json packages/api/
COPY packages/backend/package.json packages/backend/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/persistence/package.json packages/persistence/
COPY packages/persistence-postgres/package.json packages/persistence-postgres/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter web build

RUN mkdir -p /data && chown node:node /data

# NODE_ENV=production so @mezan/backend's resolveSeedAdminSecrets randomises the
# fallback admin PIN of every real tenant (audit S-1); cloud.ts refuses to start
# if MEZAN_SEED_ADMIN_PIN pins it process-wide. Only the demo tenant keeps the
# published `123456`, pinned in apps/server/src/demo-tenant.ts.
ENV NODE_ENV=production
ARG MEZAN_VERSION=dev
ENV MEZAN_VERSION=$MEZAN_VERSION
ENV MEZAN_PLATFORM_DIR=/data
ENV PORT=8080
EXPOSE 8080
USER node
# SECURITY / read-only root fs: started by node itself, not `pnpm exec`. The
# corepack pnpm download lives in root's cache and is missing for `node`, so
# `pnpm exec` would fetch pnpm at boot and fail under deploy/contabo's
# read_only container. tsx is a root devDependency linked at /app/node_modules.
CMD ["node", "--import", "tsx", "apps/server/src/cloud.ts"]
