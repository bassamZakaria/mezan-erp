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

# NODE_ENV=production so @mezan/backend's resolveSeedAdminSecrets randomises the
# fallback admin PIN. A "known login" on a public origin was the published
# `123456` company admin (audit S-1); cloud.ts prints the generated PIN once to
# the deploy log instead, and sets this itself if the platform drops it.
ENV NODE_ENV=production
ENV MEZAN_DB=/tmp/mezan-demo.db
ENV PORT=8080
EXPOSE 8080
CMD ["pnpm", "exec", "tsx", "apps/server/src/cloud.ts"]
