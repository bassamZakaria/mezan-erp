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
AWS a sidecar syncs it to S3 — see the `apps/mezan` README in `cyag-devops`.

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
| Browser basic auth | every page, before anything loads | `demo` / `local-demo-password` |
| Platform owner | `/platform/login` | `owner@mezan.local` / `owner-password-123` |
| Demo tenant | company code `demo`, then the login screen | `admin@cyag.example` with PIN `123456` |

Both sit behind basic auth because they seed the demo tenant: `cloud.ts` refuses
to start with `MEZAN_SEED_DEMO=1` unless `MEZAN_DEMO_PASSWORD` holds at least 12
characters. `.data/` is gitignored.

### Why these run cloud.ts, not `pnpm dev`

`pnpm dev` serves the web app from vite and proxies `/api` to a separate
process. That is a convenient dev loop but it is **not** what deploys: the
deployed service is one process serving the built bundle at `/` and the backend
at `/api` from the same origin. Testing and staging run that same entrypoint, so
a same-origin bug — a wrong `/api` prefix, an SPA fallback that 404s, a static
asset path — fails here rather than in front of a client.

## Card checkout (Paymob)

Subscription renewals can be paid by card through Paymob's Intention API and
Unified Checkout. The platform owner gets «ادفع بالبطاقة» on a tenant's
subscription in the console (a payment link to open or send), and a tenant
admin gets «تجديد الاشتراك» on the general settings page and in the licence
banner. A payment is recorded — and the subscription renewed, clearing dunning —
only when Paymob's HMAC-signed transaction callback reaches
`POST /api/billing/paymob/webhook`. The browser's return from the hosted page
carries query parameters too; they are never read as proof of payment.

| Variable | Meaning |
| --- | --- |
| `MEZAN_PAYMOB_SECRET_KEY` | Secret key (Dashboard → Settings → API keys). Sent as `Authorization: Token …` to `POST /v1/intention/`. |
| `MEZAN_PAYMOB_PUBLIC_KEY` | Public key; goes in the Unified Checkout URL. |
| `MEZAN_PAYMOB_HMAC_SECRET` | HMAC secret; verifies every transaction callback (SHA-512 over Paymob's fixed 20-field order). |
| `MEZAN_PAYMOB_INTEGRATION_ID` | Card integration id(s), comma-separated. Test ids with test keys, live with live. |
| `MEZAN_PAYMOB_PUBLIC_URL` | Public `https://` origin of this deployment. Required with live keys: the callback goes to `<url>/api/billing/paymob/webhook` and the customer returns to `<url>/…` (or to the tenant's own subdomain under `MEZAN_TENANT_DOMAIN`). |
| `MEZAN_PAYMOB_BASE_URL` | Optional; default `https://accept.paymob.com` (Egypt). |
| `MEZAN_PAYMOB_TEST_MODE` | `1` runs the local test double when no keys are set; `0` turns card checkout off in dev. |

The four keys are all-or-nothing: setting some but not all refuses to start, as
does combining them with `MEZAN_PAYMOB_TEST_MODE=1`.

**With no keys** the provider is a test double. Checkout links open
`/billing/test-checkout/<id>`, a page labelled «وضع الاختبار — TEST MODE» with
buttons that simulate a successful or a declined card. They do not mark
anything paid themselves: they sign a Paymob-shaped callback with a per-process
secret and send it through the same webhook handler a live payment uses. The dev
entrypoint (`pnpm server`, `pnpm dev`) and `pnpm env:testing|staging` enable it by
default; the deployed `cloud.ts` enables it only with `MEZAN_PAYMOB_TEST_MODE=1`,
so a production host without keys has card checkout off rather than free.

Before the first live payment, in the Paymob dashboard: create the card
integration, note its id, and copy the four secrets above. The callback URL is
set per intention (`notification_url`), so the integration's own callback field
may stay empty. Run one real low-value payment and one decline, and watch the
console's «الدفع بالبطاقة» card and the platform audit log for
`PAYMENT_RECORDED` / `CARD_PAYMENT_DECLINED`.

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
   | `MEZAN_DEMO_PASSWORD` | a shared password of at least 12 characters |

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
