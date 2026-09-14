# SaaS Slice C — Cloud Entrypoint, Seed, Deploy and Proof Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One cloud entrypoint that composes the platform database, the platform API, the tenant router, provisioning, dunning and backups from environment variables; a seeded demo tenant and platform owner; the local, Render and AWS deploy shapes updated; and the eight browser scenarios proven on `pnpm env:testing`.

**Architecture:** `apps/server/src/cloud-app.ts` exports `createCloudApp(env, options)` returning `{ root: Hono, close }`; `cloud.ts` and `index.ts` become thin. Spec: `docs/superpowers/specs/2026-09-14-saas-completion-design.md` §3, plus the slice D review's app-side items (origin secret, `/data/backups`, env wiring).

**Conventions:** commit subject only, NEVER any trailer, commit by pathspec; no comments except a hidden invariant; no `any`; Arabic messages, English codes; `npx vitest run <path>`; `pnpm typecheck && pnpm lint` before every commit.

## Environment contract (`apps/server/src/env.ts`)
| Variable | Default | Meaning |
|---|---|---|
| `MEZAN_PLATFORM_DIR` | `.data/platform` | holds `platform.db`, `tenants/<code>.db`, `backups/` |
| `MEZAN_TENANT_DOMAIN` | unset | wildcard base domain; unset means code-at-login only |
| `MEZAN_TRUST_PROXY` | `0` | `1` trusts `x-forwarded-host` (behind CloudFront) |
| `MEZAN_ORIGIN_SECRET` | unset | when set, every `/api/*` request must carry `x-mezan-origin: <secret>` (CloudFront adds it as a custom origin header); missing → 403 |
| `MEZAN_SQLITE_EXCLUSIVE` | `0` | `1` opens every SQLite file with `exclusive: true` (EFS) |
| `MEZAN_PLATFORM_OWNER_EMAIL` / `_PASSWORD` | unset | seeds the first platform owner when the table is empty; a missing password is generated and printed once |
| `MEZAN_SEED_DEMO` | `0` | `1` provisions tenant `demo` (nameAr «شركة سياج التجريبية», owner `admin@cyag.example`, PIN from `MEZAN_SEED_ADMIN_PIN` or `123456`) on the enterprise plan with the existing demo seed, once |
| `MEZAN_BACKUP_INTERVAL_MINUTES` | `15` | `0` disables the in-app backup scheduler |
| `MEZAN_WEB_DIST`, `MEZAN_DEMO_PASSWORD`, `MEZAN_ANALYTICS_TOKEN`, `PORT` | as today | unchanged |

## Tasks

### C1: `createCloudApp`
**Files:** `apps/server/src/env.ts` (+test), `apps/server/src/cloud-app.ts` (+test), `apps/server/src/cloud.ts`, `apps/server/src/index.ts`, `apps/server/src/tenant-router.ts` (origin secret option), `packages/backend/src/create-backend.ts` (accept `connection` passthrough if not already).
- [ ] Tests (temp dir per test): `GET /healthz` 200; `GET /api/platform/resolve` answers; `POST /api/platform/auth/login` with the env owner succeeds; provisioning through `POST /api/platform/tenants` creates `tenants/<code>.db` on disk and the owner can `POST /api/auth/login` with header `x-mezan-tenant`; with `MEZAN_ORIGIN_SECRET` set, a request without `x-mezan-origin` → 403 `ORIGIN_REQUIRED` and with it passes (both `/api/platform/*` and `/api/*`); `MEZAN_SEED_DEMO=1` provisions `demo` once (second start is a no-op) and `demo`'s `GET /dashboard/summary` works with the seed admin; `close()` stops dunning and backup timers and closes every backend (no open handles: the test process exits).
- [ ] Implement: `parseEnv(process.env)` with validation (bad `MEZAN_BACKUP_INTERVAL_MINUTES` throws at start). `createCloudApp` builds `createPlatform({ dbPath: <dir>/platform.db, owner, connection: { exclusive } })`, prints the generated owner password once (same style as the admin PIN), `createTenantRouter({ platform, dataDir, tenantDomain, trustForwardedHost, allowTenantHeader: true, connection })`, `createPlatformRoutes({ platform, auth, provisionTenant, invalidateEntitlements: router.invalidate, now })`, mounts `root.route("/api/platform", platformApp)` BEFORE `root.route("/api", router.app)`, `startDunningTimer`, the backup scheduler (C2), the static bundle and SPA fallback exactly as `cloud.ts` does today, `app.onError` logging `err` with `console.error` before the JSON body. `cloud.ts` keeps only the demo password, analytics tag and `serve`; `index.ts` (dev) uses `.data/dev-platform` with `MEZAN_SEED_DEMO` honoured.
- [ ] Commit `feat(server): one cloud entrypoint composes the platform, the tenants and the console`

### C2: in-app backups to `<dir>/backups`
**Files:** `packages/backend/src/create-backend.ts` (`backupTo(path: string): Promise<void>` on `BackendHandle` using better-sqlite3's `db.backup`), `packages/backend/src/create-platform.ts` (same on the platform handle), `apps/server/src/backup-scheduler.ts` (+test).
- [ ] Tests: `runBackups({ platform, router, dir, now })` writes `backups/platform/<iso>.sqlite` and `backups/<code>/<iso>.sqlite` for every OPEN tenant backend (closed ones are skipped: their file is at rest), each file opens as a valid SQLite database with the expected tables, keeps the newest `keep` (default 12) per folder and deletes older, and `startBackupTimer(intervalMs)` runs immediately, repeats, `unref`s, returns `stop()`.
- [ ] Commit `feat(server): every open tenant is snapshotted to the backups folder on a timer`

### C3: prices, demo tenant, owner seed
**Files:** `packages/backend/src/create-platform.ts` (+test), `apps/server/src/demo-tenant.ts` (+test), `docs/superpowers/specs/2026-09-13-saas-tenant-models-design.md` §7 (close the price placeholder).
- [ ] Seed prices: core 490 / 4900, business 980 / 9800, enterprise 1960 / 19600 EGP; delete the placeholder comment; update `create-platform.test.ts`. `provisionDemoTenant({ platform, router, pin })`: code `demo`, enterprise, paid yearly (no trial), then run the existing demo seed against that tenant's backend (`createBackend` already accepts `seedDemoData`; if the router's `openBackend` cannot pass it, add a per-code option `seedDemoData` to the router or open the demo backend once with the flag before the router caches it: pick the smaller change and say which). Idempotent.
- [ ] Commit `feat(server): the demo tenant, the plan prices, and the first platform owner`

### C4: local, Render and container shapes; docs
**Files:** `scripts/env.mjs`, `render.yaml`, `Dockerfile`, `docs/ENVIRONMENTS.md`, `docs/DEPLOY-DEMO.md`, `docs/ROADMAP.md` §4.3, `docs/TESTING.md` §11 (new scenarios `PLT-SAAS-01..08` exactly as spec §3 lists them, with steps and expected results), `infra/terraform/compute.tf` env block if any name changed.
- [ ] `env.mjs`: `MEZAN_PLATFORM_DIR=.data/<env>-platform`, `MEZAN_SEED_DEMO=1`, `MEZAN_PLATFORM_OWNER_EMAIL=owner@mezan.local`, `MEZAN_PLATFORM_OWNER_PASSWORD=owner-password-123`; `render.yaml`: `MEZAN_PLATFORM_DIR=/tmp/platform`, `MEZAN_SEED_DEMO=1`, owner email, password `sync: false`; `Dockerfile`: drop `MEZAN_DB`, set `MEZAN_PLATFORM_DIR=/data`, healthcheck-free (ECS does it), `USER node` after `chown`.
- [ ] Commit `docs(deploy): every environment runs the multi-tenant entrypoint, and the eight SaaS scenarios are written down`

### C5: browser proof
- [ ] `pnpm env:testing:fresh` in the background; in the session's own Chrome tab group, execute `PLT-SAAS-01..08` from `docs/TESTING.md`: platform login at `/platform/login`; create tenant `cyag` on business with trial; copy the PIN; sign out; tenant login with code `cyag`; nav shows business modules only and `/hr/*` answers 403 in Arabic; record a payment and see the period advance; suspend → posting refused in Arabic while lists still load; second tenant `nile` lists no customers of `cyag`; hosts-file `cyag.mezan.test` with `MEZAN_TENANT_DOMAIN=mezan.test` logs in without the code field (run a second instance on another port with that env). Fix every defect found through the normal task → review loop, and tick each scenario in `docs/TESTING.md` with the date.
- [ ] Commit `test(saas): the eight platform scenarios pass in a real browser`

### C6: gates and merge
- [ ] `pnpm typecheck && pnpm lint && pnpm test`, `pnpm smoke`, `pnpm check:seed`; whole-slice Opus review; fast-forward `main`.
