# Deploying the client demo (free)

A single container serves the built web bundle at `/` and the shared Hono backend at
`/api` — the prefix `apps/web/src/data/transport.ts` already calls. SQLite lives in
`/tmp`, so the host's ephemeral disk is not a problem: every restart reseeds the demo
tenant from scratch. Anything a client types is lost when the instance restarts.

## Render (no credit card)

1. Push this branch to GitHub.
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

## Demo logins

Every seeded account uses PIN `123456`. Sign in with the email as the username:

| User | Username | Role |
| --- | --- | --- |
| محمد الشهابي | `admin@cyag.example` | Company admin (all permissions) |

The other seeded people live in `packages/backend/src/demo-seed/access.ts`; they all
use `<local>@cyag.example` with the same PIN and exercise the permission matrix.

## Running the same image locally

```sh
pnpm --filter web build
MEZAN_DB=/tmp/mezan-demo.db PORT=8080 pnpm exec tsx apps/server/src/cloud.ts
```

Or through Docker:

```sh
docker build -t mezan-demo .
docker run --rm -p 8080:8080 mezan-demo
```

## Moving to AWS or Firebase later

The same `Dockerfile` runs unchanged on AWS App Runner, ECS/Fargate, an EC2 box, or
Google Cloud Run behind Firebase Hosting. Both require a credit card on the account —
that is the only reason the demo starts on Render.
