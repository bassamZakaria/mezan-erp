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
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm --filter web build

RUN mkdir -p /data && chown node:node /data

# @mezan/backend's resolveSeedAdminSecrets randomises the fallback admin PIN
# under production; render.yaml sets MEZAN_SEED_ADMIN_PIN so the demo tenant
# keeps a known login despite NODE_ENV=production here.
ENV NODE_ENV=production
ENV MEZAN_PLATFORM_DIR=/data
ENV PORT=8080
EXPOSE 8080
USER node
CMD ["pnpm", "exec", "tsx", "apps/server/src/cloud.ts"]
