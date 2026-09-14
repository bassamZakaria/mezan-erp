# Environments

Four places Mezan runs. Each is the same code; what differs is the entrypoint,
the database, and who can reach it.

| Environment | Where | Entrypoint | Platform dir | Branch |
| --- | --- | --- | --- | --- |
| dev | `localhost:5173` + `:3000` | vite dev server proxying `apps/server/src/index.ts` | `.data/dev-platform` | whatever you have checked out |
| testing | `localhost:4101` | `apps/server/src/cloud.ts` | `.data/testing-platform` | `testing` |
| staging | `localhost:4102` | `apps/server/src/cloud.ts` | `.data/staging-platform` | `main` |
| demo | <https://mezan-demo.onrender.com> | `apps/server/src/cloud.ts` in Docker | `/tmp/platform` | see [DEPLOY-DEMO.md](DEPLOY-DEMO.md) |

Every environment now runs the same multi-tenant entrypoint (`createCloudApp`,
`apps/server/src/cloud-app.ts`): a platform database at `<platform dir>/platform.db`
holding tenants, plans and subscriptions, and one SQLite file per tenant under
`<platform dir>/tenants/`. `MEZAN_SEED_DEMO=1` provisions the seeded demo tenant
(code `demo`) once; `MEZAN_PLATFORM_OWNER_EMAIL` / `MEZAN_PLATFORM_OWNER_PASSWORD`
seed the first platform owner, who signs in at `/platform/login` to create and
manage tenants. See the environment contract table in
`docs/superpowers/plans/2026-09-14-saas-slice-c-deploy.md` for every variable.

Every open tenant, plus the platform database itself, is snapshotted on a timer
into `<platform dir>/backups/` (`MEZAN_BACKUP_INTERVAL_MINUTES`, default 15).
On the demo host that directory sits under `/tmp` and is lost on restart; on
AWS a sidecar syncs it to S3 — see [DEPLOY-AWS.md](DEPLOY-AWS.md) §6.

## Running testing and staging locally

```sh
pnpm env:testing         # builds the web bundle, serves it on :4101
pnpm env:staging         # same, on :4102
```

Both reseed nothing on restart — the platform directory under `.data/` persists,
so data you enter survives a restart. To start from a clean seeded demo tenant:

```sh
pnpm env:testing:fresh   # deletes .data/testing-platform first
pnpm env:staging:fresh
```

Skip the rebuild when only backend code changed:

```sh
node scripts/env.mjs testing --no-build
```

Both can run at once — different ports, different platform directories.
Nothing entered in one is visible in the other.

Two logins, both seeded automatically by `scripts/env.mjs`:

| Login | Where | Credentials |
| --- | --- | --- |
| Platform owner | `/platform/login` | `owner@mezan.local` / `owner-password-123` |
| Demo tenant | company code `demo`, then the login screen | `admin@cyag.example` with PIN `123456` |

Neither environment is password-protected, matching dev; `.data/` is gitignored.

### Why these run cloud.ts, not `pnpm dev`

`pnpm dev` serves the web app from vite and proxies `/api` to a separate
process. That is a convenient dev loop but it is **not** what deploys: the
deployed service is one process serving the built bundle at `/` and the backend
at `/api` from the same origin. Testing and staging run that same entrypoint, so
a same-origin bug — a wrong `/api` prefix, an SPA fallback that 404s, a static
asset path — fails here rather than in front of a client.

## Adding a hosted testing environment later

The `testing` branch already carries the `Dockerfile` and `render.yaml`, so a
hosted testing box is one service away:

1. Render dashboard → **New → Web Service** → repo `bassamZakaria/mezan-erp`.
2. Language **Docker**, Branch **`testing`**, Region Frankfurt, Instance **Free**.
3. Health Check Path `/healthz`.
4. Environment variables:

   | Key | Value |
   | --- | --- |
   | `MEZAN_PLATFORM_DIR` | `/tmp/platform` |
   | `MEZAN_SEED_DEMO` | `1` |
   | `MEZAN_PLATFORM_OWNER_EMAIL` | `owner@mezan.local` |
   | `MEZAN_PLATFORM_OWNER_PASSWORD` | a password you choose |
   | `NODE_OPTIONS` | `--max-old-space-size=400` |
   | `MEZAN_SEED_ADMIN_PIN` | `123456` |

That gives `https://mezan-testing.onrender.com`, on the same free tier as the
demo: it sleeps after 15 minutes idle (40-60 s to wake), and has no persistent
disk, so every restart reseeds from scratch.

Leave the build and start commands **empty** — the Dockerfile supplies both.
Setting them overrides it and the deploy fails.

### Free-tier budget

Render's free plan gives the workspace **750 instance-hours per month**, shared
across every free service. Hours accrue only while a service is awake, and a
free service sleeps after 15 minutes without traffic — so a demo and a testing
box used for calls and QA sit far under the cap, but three free services left
awake around the clock would exceed it in under two weeks.

### Custom domains

Render serves custom domains on the free plan at no charge, but you must own the
domain. Once you have one, add the subdomain in the service's **Settings →
Custom Domains** and Render prints the exact CNAME to create with your registrar.
