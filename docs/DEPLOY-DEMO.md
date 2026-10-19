# Deploying the client demo (free)

A single container serves the built web bundle at `/`, the platform console at
`/api/platform`, and every tenant under `/api` — the prefix
`apps/web/src/data/transport.ts` already calls. The Render free instance has no
persistent disk, so the platform database and every tenant's SQLite file live
under `/tmp/platform` by design: every restart re-seeds the platform owner and
the demo tenant from scratch. Anything a client types is lost when the instance
restarts — the demo is deliberately ephemeral, not a bug to fix.

The container runs with `NODE_ENV=production` (set in the `Dockerfile`), which
makes `@mezan/backend`'s `resolveSeedAdminSecrets` generate the fallback admin
PIN of every real tenant. The demo tenant alone keeps the published `123456`:
`apps/server/src/demo-tenant.ts` pins it for that tenant, in code, because the
free instance re-seeds on every wake and a generated PIN would change each time.
`MEZAN_SEED_ADMIN_PIN` would pin every tenant the process seeds, so `cloud.ts`
refuses to start if it is set at all.

## The demo password

`MEZAN_DEMO_PASSWORD` is **mandatory** whenever `MEZAN_SEED_DEMO=1`: `cloud.ts`
refuses to start without it, or with fewer than 12 characters. Every page then
asks for username `demo` and that password before anything loads. It is the real
gate — every seeded demo persona shares the published PIN `123456`, so the
password is the only thing between the open internet and a writable ERP.

- Sales hands the password to each prospect with the demo link; it is never
  published alongside the URL.
- Rotate it monthly, and immediately after any leak (a forwarded email, a
  screenshot, a prospect who should no longer have access). Rotation is the
  dashboard steps below: change the value, save, redeploy.
- `/healthz` is the only path served without it, so Render's health check passes.

## Render (no credit card)

1. Push to GitHub. The blueprint tracks `production` (`render.yaml` says so), so a
   merge to `main` deploys nothing; the demo redeploys only when `main` is merged
   into `production`. An existing service created while the blueprint said `main`
   needs its branch changed once under **Settings → Build & Deploy → Branch** if a
   blueprint sync has not already done it.
2. On <https://dashboard.render.com> → **New → Blueprint**, point it at the repo.
   Render reads `render.yaml` and creates the `mezan-demo` web service on the free plan.
   It stops and asks for every `sync: false` variable, `MEZAN_DEMO_PASSWORD`
   among them.
3. Wait for the first build (~5-8 minutes; it installs the workspace and runs
   `pnpm --filter web build`).
4. Open `https://mezan-demo.onrender.com` and sign in as `demo` with the password.

### Existing service

Render asks for `sync: false` variables only when a blueprint first creates a
service, and it KEEPS a variable that has since been removed from `render.yaml`.
So a service created before this change still carries `MEZAN_SEED_ADMIN_PIN=123456`
from the old blueprint — `cloud.ts` refuses to start with it, every new deploy
fails its health check, and Render keeps serving the previous build — and may
have no `MEZAN_DEMO_PASSWORD`. Fix both by hand:

1. <https://dashboard.render.com> → **mezan-demo** → **Environment**.
2. Find `MEZAN_SEED_ADMIN_PIN` and delete it (the trash icon on its row).
3. **Add Environment Variable**: key `MEZAN_DEMO_PASSWORD`, value a password of at
   least 12 characters. If it already exists, check its value is at least 12
   characters.
4. **Save, rebuild, and deploy**.
5. **Events**: wait for "Deploy live" on the latest commit. A deploy that fails its
   health check leaves the old build serving, so read the deploy log if it does not
   go live.
6. Check it from any machine:

   ```sh
   curl -s -o /dev/null -w '%{http_code}\n' https://mezan-demo.onrender.com/          # 401
   curl -s -o /dev/null -w '%{http_code}\n' https://mezan-demo.onrender.com/healthz   # 200
   curl -s -o /dev/null -w '%{http_code}\n' -u 'demo:<password>' https://mezan-demo.onrender.com/  # 200
   ```

   A `200` on `/` without credentials means the old build is still serving.

### What `render.yaml` sets

The values the blueprint commits. `apps/server/src/env-docs.test.ts` reads
`render.yaml` itself and this table, and starts the server's configuration
from each; a variable marked `sync: false` in the blueprint is asked for in the
dashboard and is not listed here.

<!-- env-table: render -->

| Variable | Value | Notes |
|---|---|---|
| `MEZAN_PLATFORM_DIR` | `/tmp/platform` | wiped on every restart of the free plan |
| `MEZAN_SEED_DEMO` | `1` | needs `MEZAN_DEMO_PASSWORD` (dashboard) |
| `MEZAN_TRUST_PROXY` | `1` | |
| `MEZAN_TRUSTED_PROXY_HOPS` | `1` | required with the line above; see "Whose address the demo counts" |
| `MEZAN_PUBLIC_URL` | `https://mezan-demo.onrender.com` | every mailed link is built on it; change it with the service's address |
| `NODE_OPTIONS` | `--max-old-space-size=400` | |

<!-- /env-table -->

### Whose address the demo counts

`render.yaml` sets `MEZAN_TRUST_PROXY=1` and `MEZAN_TRUSTED_PROXY_HOPS=1`. The
server refuses to start with the first and no count, and without either it
counts every caller as the one proxy address in front of it, so one visitor's
wrong PINs hold the sign-in for everybody.

Render says public traffic reaches a web service "through Cloudflare and
Render's load balancer", that Cloudflare "appends to `X-Forwarded-For` rather
than replacing it", and that a caller who sends their own copy "controls the
leftmost entry"
(<https://render.com/articles/host-pocketbase-on-render>). Render's
documentation does not say whether its own load balancer appends an entry as
well, so the count ships at `1`: the rightmost entry is always written by
Render's side and never by the caller. If the load balancer does append, that
entry is a Cloudflare address and the count must be `2`.

`MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER=cf-connecting-ip` is supported by the
server and is **not** set in `render.yaml`. It may be set only where the
platform's own documentation says the header is written by its edge and
cannot be supplied by the client, and that could not be confirmed (checked
2026-10-12): Render's web-service documentation
(<https://render.com/docs/web-services>) does not mention `CF-Connecting-IP`,
`True-Client-IP` or how to read a client's address at all, and Cloudflare's
header reference
(<https://developers.cloudflare.com/fundamentals/reference/http-headers/>)
says the header "provides the client IP address connecting to Cloudflare to
the origin web server" and recommends it over `X-Forwarded-For`, but does not
say that a `CF-Connecting-IP` the client sent is replaced. So the demo keeps
counting the hop its last proxy appended. If Render publishes that guarantee,
add the variable to `render.yaml` and the dashboard and run the check below
with `-H 'cf-connecting-ip: 203.0.113.99'` added: `origin` must still be your
own address.

Check it once after a deploy, from a machine whose public address you know:

```sh
curl -s https://api.ipify.org; echo
curl -s -u "demo:$MEZAN_DEMO_PASSWORD" -X POST https://mezan-demo.onrender.com/api/platform/auth/login \
  -H 'content-type: application/json' -H 'x-forwarded-for: 203.0.113.99' \
  -d '{"email":"nobody@example.com","password":"wrong-on-purpose"}'
```

Then sign in to the platform console and open the audit log: the newest
`PLATFORM_LOGIN_FAILED` event carries `origin`.

- `origin` is your own address: the count is right.
- `origin` is some other public address (Cloudflare's): set
  `MEZAN_TRUSTED_PROXY_HOPS` to `2` in `render.yaml` and the dashboard, redeploy,
  and run the check again.
- `origin` is `203.0.113.99`: the count is too high. Lower it by one at once —
  a caller is choosing the address it is counted under.

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
| Browser basic auth | every page, before anything loads | `demo` / `MEZAN_DEMO_PASSWORD` (set in the Render dashboard) |
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
MEZAN_PLATFORM_DIR=/tmp/platform MEZAN_SEED_DEMO=1 MEZAN_DEMO_PASSWORD=local-demo-password \
  MEZAN_PLATFORM_OWNER_EMAIL=owner@mezan.local MEZAN_PLATFORM_OWNER_PASSWORD=owner-password-123 \
  PORT=8080 pnpm exec tsx apps/server/src/cloud.ts
```

Or through Docker:

```sh
docker build -t mezan-demo .
docker run --rm -p 8080:8080 \
  -e MEZAN_SEED_DEMO=1 -e MEZAN_DEMO_PASSWORD=local-demo-password \
  -e MEZAN_PLATFORM_OWNER_EMAIL=owner@mezan.local \
  -e MEZAN_PLATFORM_OWNER_PASSWORD=owner-password-123 mezan-demo
```

## Moving to Firebase later

The same `Dockerfile` runs unchanged on Google Cloud Run behind Firebase Hosting, which
needs a credit card on the account — that is the only reason the demo starts on Render.
