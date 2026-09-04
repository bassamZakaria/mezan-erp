# Environments

Four places Mezan runs. Each is the same code; what differs is the entrypoint,
the database, and who can reach it.

| Environment | Where | Entrypoint | Database | Branch |
| --- | --- | --- | --- | --- |
| dev | `localhost:5173` + `:3000` | vite dev server proxying `apps/server/src/index.ts` | `./mezan.db` | whatever you have checked out |
| testing | `localhost:4101` | `apps/server/src/cloud.ts` | `.data/testing.db` | `testing` |
| staging | `localhost:4102` | `apps/server/src/cloud.ts` | `.data/staging.db` | `main` |
| demo | <https://mezan-demo.onrender.com> | `apps/server/src/cloud.ts` in Docker | `/tmp/mezan-demo.db` | see [DEPLOY-DEMO.md](DEPLOY-DEMO.md) |

## Running testing and staging locally

```sh
pnpm env:testing         # builds the web bundle, serves it on :4101
pnpm env:staging         # same, on :4102
```

Both reseed nothing on restart — the SQLite file under `.data/` persists, so
data you enter survives a restart. To start from a clean seeded tenant:

```sh
pnpm env:testing:fresh   # deletes .data/testing.db first
pnpm env:staging:fresh
```

Skip the rebuild when only backend code changed:

```sh
node scripts/env.mjs testing --no-build
```

Both can run at once — different ports, different database files. Nothing
entered in one is visible in the other.

Sign in as `admin@cyag.example` with PIN `123456`. Neither environment is
password-protected, matching dev; `.data/` is gitignored.

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
   | `MEZAN_DB` | `/tmp/mezan-testing.db` |
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
