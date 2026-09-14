# Deploying the client demo (free)

A single container serves the built web bundle at `/`, the platform console at
`/api/platform`, and every tenant under `/api` — the prefix
`apps/web/src/data/transport.ts` already calls. The platform database and every
tenant's SQLite file live under `/tmp/platform`, so the host's ephemeral disk is
not a problem: every restart re-seeds the platform owner and the demo tenant
from scratch. Anything a client types is lost when the instance restarts.

## Render (no credit card)

1. Push to GitHub. The blueprint tracks `main` (`render.yaml` says so), so every
   merge to `main` redeploys the demo on its own.
2. On <https://dashboard.render.com> → **New → Blueprint**, point it at the repo.
   Render reads `render.yaml` and creates the `mezan-demo` web service on the free plan.
3. Wait for the first build (~5-8 minutes; it installs the workspace and runs
   `pnpm --filter web build`).
4. Open `https://mezan-demo.onrender.com`.

To put the demo behind one shared password, set `MEZAN_DEMO_PASSWORD` in the Render
dashboard (Environment tab). The browser then asks for username `demo` and that
password before anything loads.

### Free-plan behaviour

- The instance sleeps after 15 minutes with no traffic; the next request takes
  **40-60 seconds** to wake it. Open the URL yourself a minute before a client call.
- 512 MB RAM, shared CPU. Fine for a handful of concurrent demo users.
- No persistent disk — see the reseed note above.

## Counting visitors

The demo reports to Cloudflare Web Analytics when `MEZAN_ANALYTICS_TOKEN` holds a
site token, and serves nothing extra when it does not. The tag is injected by
`apps/server/src/cloud.ts` as it serves `index.html`, so it exists only on this
cloud mount — the desktop and LAN builds serve the same bundle and stay offline.

1. Cloudflare dashboard -> Analytics & Logs -> Web Analytics -> **Add a site**, with
   hostname `mezan-demo.onrender.com`. Adding a site here does not move DNS.
2. Copy the `token` out of the JS snippet Cloudflare shows.
3. Render dashboard -> `mezan-demo` -> Environment -> add `MEZAN_ANALYTICS_TOKEN`.
4. Redeploy, open the URL, and the visit appears in Cloudflare within ~60 seconds.

It counts unique visitors, page views, referrers and countries, sets no cookies and
needs no consent banner. Ad blockers suppress some visits, so read the number as a
floor. The free instance also sleeps after 15 minutes, so a client's first hit is the
40-60 second wake described above -- some will give up before the beacon ever fires.

## Demo logins

The demo host seeds two kinds of account. The platform owner manages tenants from
the console; the demo tenant is the seeded company a client actually clicks around
in.

| Login | Where | Credentials |
| --- | --- | --- |
| Platform owner | `/platform/login` | `MEZAN_PLATFORM_OWNER_EMAIL` / `MEZAN_PLATFORM_OWNER_PASSWORD` (set in the Render dashboard) |
| Demo tenant | company code `demo`, then the login screen | `admin@cyag.example` with PIN `123456` |

Every seeded person in the demo tenant uses PIN `123456`, email as the username:

| User | Username | Role |
| --- | --- | --- |
| محمد الشهابي | `admin@cyag.example` | Company admin (all permissions) |

The other seeded people live in `packages/backend/src/demo-seed/access.ts`; they all
use `<local>@cyag.example` with the same PIN and exercise the permission matrix.

## Running the same image locally

```sh
pnpm --filter web build
MEZAN_PLATFORM_DIR=/tmp/platform MEZAN_SEED_DEMO=1 \
  MEZAN_PLATFORM_OWNER_EMAIL=owner@mezan.local MEZAN_PLATFORM_OWNER_PASSWORD=owner-password-123 \
  PORT=8080 pnpm exec tsx apps/server/src/cloud.ts
```

Or through Docker:

```sh
docker build -t mezan-demo .
docker run --rm -p 8080:8080 \
  -e MEZAN_SEED_DEMO=1 -e MEZAN_PLATFORM_OWNER_EMAIL=owner@mezan.local \
  -e MEZAN_PLATFORM_OWNER_PASSWORD=owner-password-123 mezan-demo
```

## Moving to AWS or Firebase later

The same `Dockerfile` runs unchanged on AWS App Runner, ECS/Fargate, an EC2 box, or
Google Cloud Run behind Firebase Hosting. Both require a credit card on the account —
that is the only reason the demo starts on Render.
