# Environments

Four places Mezan runs. Each is the same code; what differs is the entrypoint,
the database, and who can reach it.

| Environment | Where | Entrypoint | Platform dir | Branch |
| --- | --- | --- | --- | --- |
| dev | `localhost:5173` + `:3000` | vite dev server proxying `apps/server/src/index.ts` | `.data/dev-platform` | whatever you have checked out |
| testing | `localhost:4101` | `apps/server/src/cloud.ts` | `.data/testing-platform` | `testing` |
| staging | `localhost:4102` | `apps/server/src/cloud.ts` | `.data/staging-platform` | `main` |
| production | Contabo VPS (EU, Germany), Caddy in front | `apps/server/src/cloud.ts`, bundled to `apps/server/dist/cloud.js`, in Docker | `/srv/mezan/data` on the host, `/data` in the container | `production`, see [deploy/contabo/README.md](../deploy/contabo/README.md) |

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
On the Contabo VPS an hourly restic job copies it, encrypted, to Object Storage
(`deploy/contabo/backup/`).

A tenant's data is deleted `MEZAN_TENANT_RETENTION_DAYS` days (default 90,
a positive whole number) after the tenant is ARCHIVED — never while it is
active or suspended, and a cancelled subscription alone starts no clock. The
date is fixed when the tenant is archived (a tenant archived before this
existed is scheduled the first time the daily job sees it, never backdated),
shown on the console, and can be moved later or brought forward to "now" by the
platform owner (typed reason + password, audited CRITICAL). The daily
`platform_tenant_purge` job logs `tenant_purge.planned` with every file it is
about to remove, overwrites then unlinks the database and its `-wal`/`-shm`,
the tenant's local backups (and its own files in the legacy by-code folder),
its export offers and, with a local anchor store, its anchor file; then, in
one platform transaction, removes the tenant row, its signup requests and
module trials, writes a `tenant_tombstone` row (id, code, deleted_at) and a
CRITICAL `TENANT_DATA_PURGED` audit row. Subscriptions, payments, card
checkouts and the platform audit trail are the platform's own records and
stay. Off-server restic snapshots and S3 anchors are not touched: the
snapshots age out under restic's retention. Overwriting is best effort on an
SSD and the server disk is not encrypted.

Tenant export downloads (the encrypted file the console offers, valid ten
minutes) are held by the instance that built them, in memory. The download
must reach that same instance (sticky routing, or one instance), until the
offers move to the platform database. A start-up sweep of `<platform dir>/exports/`
removes only entries older than that ten-minute window, so a second instance
sharing the directory does not lose a download in flight. The exported database
has the sign-in attempt log and the lease table emptied; the live database is
never touched.

## Logging and alerts

The cloud server's JSON logs, request ids, mailed alerts (`MEZAN_ALERT_EMAIL`), `/healthz` and `/readyz`, and the UptimeRobot setup are described in [OPERATIONS.md](OPERATIONS.md).

## Stored outbound secrets

Webhook signing secrets and a tenant's SMTP password are sealed with AES-256-GCM before they are written to the tenant database.

- `MEZAN_SECRETS_KEY`: the 32-byte platform key as 64 hex characters. A secret; never commit it. Unset, the server generates one once into `<platform dir>/secrets.key` (mode 0600, outside every tenant directory) and logs that it did. Back the key up apart from the tenant backups: without it the stored secrets cannot be read, webhooks stop signing and the SMTP password must be typed again. Plaintext values written before sealing are sealed when a tenant's books are opened.

## Moving the SQLite books to Postgres

`apps/server/src/sqlite-to-postgres-cli.ts` (`check` / `migrate`, run by `deploy/contabo/deploy.sh --migrate-sqlite`; see deploy/contabo/README.md "Cutover to Postgres") reads `MEZAN_AUDIT_CHAIN_KEY`, `MEZAN_SECRETS_KEY`, and for `migrate` also `MEZAN_DATABASE_URL`, `MEZAN_TENANT_DB_SECRET` and `MEZAN_MIGRATE_OWNER_URL` (a superuser URL `deploy.sh` builds from `pg.env` and passes only to that one-off container; never put it in `/srv/mezan/env`). Without `MEZAN_SECRETS_KEY` or `<data dir>/secrets.key` it refuses rather than mint a key. A book last opened by a build older than schema version 3 still has its `pin_hash` column and is refused: start the server once on the current build so every book is upgraded, then run `check` again. It reads each book through SQLite's backup API, so the app must be stopped; scratch copies go under `TMPDIR`. Run it with `MEZAN_LOG_STDERR=1` so the app's log lines go to stderr and stdout carries only the JSON report. Keep after the cutover: `MEZAN_AUDIT_CHAIN_KEY` and any `audit-chain.key` file, `MEZAN_SECRETS_KEY` / `secrets.key`, each `tenants/<id>.db.evidence-signing.key`, and `audit-anchors/`.

## Audit trail anchors (tamper evidence from outside the database)

The audit trail is hash-chained, but anyone with the files can re-chain it or
restore an older backup. Every `MEZAN_AUDIT_ANCHOR_INTERVAL_MINUTES` (default
15, `0` turns it off) the server signs each open tenant's chain head, and the
platform database's, with Ed25519 and writes it to a store outside the
database. Nothing is anchored until a signing key is set; the server says so at
start-up, and on a production platform that seeds no demo it logs
`audit_anchor.disabled` at error level and raises an operator alert.

- `MEZAN_AUDIT_ANCHOR_SIGNING_KEY`: the 32-byte Ed25519 seed as 64 lowercase hex characters. A secret; never commit it.
- `MEZAN_AUDIT_ANCHOR_PUBLIC_KEY`: the matching public key, for verifying elsewhere (derived from the signing key when that is present).
- `MEZAN_AUDIT_ANCHOR_TRUSTED_PUBLIC_KEYS`: comma-separated Ed25519 public keys (64 hex each) of retired signing keys. Anchors signed by them still verify, and a new signing key extends a chain whose newest anchor a retired key signed. To rotate: put the old key's public key here, then change `MEZAN_AUDIT_ANCHOR_SIGNING_KEY`. Only the current key signs; remove a retired key from the list only when its anchors no longer matter.
- `MEZAN_AUDIT_ANCHOR_S3_BUCKET`, `MEZAN_AUDIT_ANCHOR_S3_REGION`, `MEZAN_AUDIT_ANCHOR_S3_PREFIX` (default `audit-anchors`), `MEZAN_AUDIT_ANCHOR_S3_ENDPOINT` (required with the bucket: the S3-compatible store's URL, for example Contabo Object Storage): one object per anchor at `<prefix>/<scope>/<12-digit seq>.json`, written with `If-None-Match: *`. An accepted restore opens an epoch: the rebase and every anchor after it live under `<prefix>/<scope>/r<13-digit ms>/<12-digit seq>.json`, so a restored chain never collides with the sequence numbers it superseded, and keys still sort in the order they were written. Credentials come from `MEZAN_AUDIT_ANCHOR_S3_ACCESS_KEY_ID` and `MEZAN_AUDIT_ANCHOR_S3_SECRET_ACCESS_KEY`. For real immutability the bucket needs S3 Object Lock; the code works with or without it.
- `MEZAN_AUDIT_ANCHOR_DIR`: without a bucket, anchors are appended to `<dir>/<scope>.jsonl` (default `<platform dir>/audit-anchors`). That is for dev and test: a file on the same host is not external.

Each sweep reads only the newest anchor per scope: the S3 sink keeps a
`<prefix>/<scope>/latest.json` pointer (`{"seq": n}`) beside the anchors, and the
anchor objects stay authoritative (a missing or wrong pointer costs one full
listing and is rewritten). The verifier below still reads every anchor.

Check a tenant (scope is the tenant id, or `platform`) against its anchors,
using a copy of the database file made with `sqlite3 live.db ".backup copy.db"`
(or `VACUUM INTO 'copy.db'`) and the original `audit-chain.key`. Copying only the
`.sqlite` file of a WAL database loses the newest rows, so the tool refuses a
database that has a non-empty `-wal` file beside it:

```sh
pnpm exec tsx apps/server/src/audit-anchor-cli.ts verify --db copy.db --scope <tenant id>
```

Inside the cloud image the same CLI is `node --enable-source-maps apps/server/dist/audit-anchor-cli.js`.

It exits 0 when the chain verifies and extends the latest anchor, 2 on a
rollback (`ROLLED_BACK`), a rewrite (`REWRITTEN`), a broken chain or forged
anchors, and 1 when it could not run. A scope whose newest anchor no longer
matches its database is never re-anchored; the sweep logs
`audit_anchor.refused_possible_tampering` at error level every interval until
someone looks.

After a LEGITIMATE restore of an older snapshot, the platform owner accepts it:
on the console (tenant page, «ختم سجل التدقيق خارج الخادم» → «اعتماد الاستعادة»,
with a typed reason and their password; audited CRITICAL), or with the CLI on the
restored database with the server stopped (needs `MEZAN_AUDIT_ANCHOR_SIGNING_KEY`;
the only way for the `platform` scope):

```sh
pnpm exec tsx apps/server/src/audit-anchor-cli.ts accept-restore --db <restored db> --scope <tenant id | platform> --reason "<why>" --actor <who>
```

It signs a rebase anchor naming the head it supersedes and the reason, and is
refused unless the sweep is refusing that chain as a rollback or rewrite AND the
live chain verifies on its own — a forged anchor trail or a broken chain stays
refused. The sweep then resumes, and `verify` passes while reporting
`SUPERSEDED_BY_RESTORE` with the old head, who accepted it and why.

## Behind a proxy: which address a request is counted against

Sign-in throttling, signup and deletion-form rate limits, and the address a
tenant session is bound to all need the caller's real address. Behind a proxy
the socket's peer is the proxy, and `x-forwarded-for` is a list the caller can
start with anything: each proxy only **appends** the address it saw. The server
therefore never reads the leftmost entry. It counts from the right
(`apps/server/src/client-source.ts`).

| Variable | Default | What it does |
| --- | --- | --- |
| `MEZAN_TRUST_PROXY` | `0` | `1` trusts `x-forwarded-host` and lets the two settings below apply; the socket is then never read. `0`: the socket's peer is the address, whatever the headers say. |
| `MEZAN_TRUSTED_PROXY_HOPS` | none — **required** with `MEZAN_TRUST_PROXY=1` | How many proxies in front of the server append to `x-forwarded-for` (1 or more). The client is the entry that many places from the right. The server **refuses to start** with `MEZAN_TRUST_PROXY=1` and no count, and with a count but no `MEZAN_TRUST_PROXY=1`. |
| `MEZAN_ORIGIN_SECRET` | unset | When set, every `/api/*` request and `POST /legal/account-deletion` must carry `x-mezan-origin: <secret>` or is refused with 403; the legal pages themselves stay public. The Contabo Caddy sets the header on every request it forwards. |
| `MEZAN_TRUSTED_CLIENT_ADDRESS_HEADER` | unset | The name of ONE header the deployment's edge overwrites with the caller's address on every request (`cf-connecting-ip` behind Cloudflare). When set, the caller is read from that header and from nothing else: a request without a usable value there is refused (`503 SOURCE_UNRESOLVED`), never read from `x-forwarded-for` instead. Refused at start-up without `MEZAN_TRUST_PROXY=1`, and for `x-forwarded-for` / `forwarded`, which a caller writes. Every other address header is ignored whatever it says. Set it only where the platform documents that its edge sets the header and a client cannot — and that nothing reaches the server except through that edge. |

Set the hop count to the deployment's real chain, or the limits key on the
wrong machine:

| Deployment | Chain | `MEZAN_TRUSTED_PROXY_HOPS` |
| --- | --- | --- |
| dev, testing, staging on localhost | none | unset (`MEZAN_TRUST_PROXY=0`) |
| Contabo VPS (Caddy → app, `deploy/contabo`) | Caddy replaces any incoming `x-forwarded-for` with the caller it saw | `1` |
| `pnpm test:saas` | the test writes the client, the Vite dev proxy appends its own hop | `2` |

Too low a count keys every client behind one proxy address (one office's typos
hold everybody); too high a count reads an entry the caller wrote.

There is no fallback. With a proxy trusted, a request whose chain is shorter
than the count, or whose entry at that place is not an address (`unknown`, an
obfuscated token, empty), has **no** address: it is answered `503
SOURCE_UNRESOLVED` in Arabic and the server logs `CLIENT ADDRESS UNRESOLVED`
(at most one line a minute). It is never counted as the host's own console and
never as the socket's peer. An entry carrying a port (`1.2.3.4:5678`,
`[2001:db8::1]:5678`) is read without it, and one IPv6 address is one key
however it is spelled.

The tenant router hands the address it worked out to the tenant backend with
each forwarded request, so a tenant session is bound to the address that signed
in: the same token presented from another address is refused and revoked, and
the user signs in again. A phone that moves between Wi-Fi and mobile data is
such a move.

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
| Demo tenant | company code `demo`, then the login screen | `admin@cyag.example` with password `Cyag@2026` |

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
| `MEZAN_PUBLIC_URL` | Public `https://` origin every MAILED link is built on (signup verification, owner hand-over confirmation, the unlock link sent to a locked account's administrators). Never read from a request header. A request that arrived on a tenant's own subdomain gets that subdomain only when a tenant is served under it and its name is not one the platform reserves (`www`, `api`, `admin`, `app`, `platform`, `signup`, `tenants`, `demo`, `released-…`); every other host gets this origin. The unlock link goes to the tenant's own subdomain under `MEZAN_TENANT_DOMAIN` (`<scheme>://<code>.<domain>/unlock`), or to `<url>/unlock` naming the tenant when no tenant domain is set; with neither, the mail carries the one-time code only. When platform mail (`MEZAN_SMTP_HOST`) is configured and neither this, `MEZAN_PAYMOB_PUBLIC_URL` nor `MEZAN_TENANT_DOMAIN` gives a trusted origin, signup answers 503 and sends no mail. |
| `MEZAN_PAYMOB_API_KEY` | Optional; the dashboard **API key** (Settings → Account Info) — a different credential from the secret key. It buys the bearer token (`POST /api/auth/tokens`, 60 min) that `POST /api/ecommerce/orders/transaction_inquiry` needs. Without it the reconciliation sweep cannot ask Paymob about a checkout whose callback never arrived, so it settles and expires nothing and reports every checkout as `unavailable`. |
| `MEZAN_PAYMOB_BASE_URL` | Optional; default `https://accept.paymob.com` (Egypt). |
| `MEZAN_PAYMOB_NOT_FOUND_CONFIRMED` | Optional; default off. `1` lets the reconciliation sweep read Paymob's not-found answer (`HTTP 404` with exactly `{"detail":"Not found."}`) as "no transaction for this order" and expire the checkout. That shape is not in Paymob's public documentation, so while this is off the sweep expires nothing on it: the checkout stays `pending`, marked «بحاجة لمراجعة» (`NEEDS_ATTENTION`, cause `unreadable`), for a person to resolve from the console. Turn it on only after the manual check below. |
| `MEZAN_PAYMOB_TEST_MODE` | `1` runs the local test double when no keys are set; `0` turns card checkout off in dev. |

The four keys are all-or-nothing: setting some but not all refuses to start, as
does combining them with `MEZAN_PAYMOB_TEST_MODE=1`.

**With no keys** the provider is a test double. Checkout links open
`/billing/test-checkout/<id>`, a page labelled «وضع الاختبار — TEST MODE» with
buttons that simulate a successful or a declined card. They do not mark
anything paid themselves: they sign a Paymob-shaped callback with a per-process
secret and send it through the same webhook handler a live payment uses. The dev
entrypoint (`pnpm server`, `pnpm dev`) and `pnpm env:testing|staging` enable it by
default; the deployed `cloud.ts` enables it only with `MEZAN_PAYMOB_TEST_MODE=1`
and refuses to start with that flag unless `MEZAN_SEED_DEMO=1`, so a production
host without keys has card checkout off rather than free.

A checkout's amount is fixed when it opens. If the plan or its price changed
before the payment arrives, the payment is kept but marked «بحاجة لمراجعة»
(`PRICE_CHANGED`) instead of renewing at the old price. Refunds and voids are
audited (`CARD_WEBHOOK_NON_PAYMENT`) and never reverse a renewal on their own;
reverse by hand.

Before the first live payment, in the Paymob dashboard: create the card
integration, note its id, and copy the four secrets above. The callback URL is
set per intention (`notification_url`), so the integration's own callback field
may stay empty. Run one real low-value payment and one decline, and watch the
console's «الدفع بالبطاقة» card and the platform audit log for
`PAYMENT_RECORDED` / `CARD_PAYMENT_DECLINED`.

### Confirming Paymob's not-found answer (manual, once per Paymob account)

The inquiry answer for an order that has no transaction is the one answer that
lets the sweep expire a checkout, and Paymob documents only the 200 answer. The
shape the server recognises — `HTTP 404` with a body that is exactly
`{"detail":"Not found."}` — was seen from Paymob but never confirmed against a
sandbox account from this repository. Until it is, `MEZAN_PAYMOB_NOT_FOUND_CONFIRMED`
stays off and that answer is put in front of a person.

To confirm it:

1. In the Paymob dashboard (test mode), copy the **API key** (Settings →
   Account Info) and the test card **integration id**.
2. Optionally make one test payment and note its Paymob **order id**.
3. Run the contract test against the sandbox:

   ```bash
   MEZAN_PAYMOB_SANDBOX_API_KEY=<api key> \
   MEZAN_PAYMOB_SANDBOX_INTEGRATION_ID=<integration id> \
   MEZAN_PAYMOB_SANDBOX_PAID_ORDER_ID=<order id, optional> \
   pnpm exec vitest run apps/server/src/paymob-contract.test.ts
   ```

   `MEZAN_PAYMOB_SANDBOX_BASE_URL` overrides the host (default
   `https://accept.paymob.com`). Without the API key the file skips itself.
4. If "answers an order with no transaction in a recognised not-found shape"
   passes, set `MEZAN_PAYMOB_NOT_FOUND_CONFIRMED=1` on the deployment and
   restart it. If it fails, the message prints the status and body Paymob
   sent: add that answer as a fixture under
   `apps/server/src/fixtures/paymob-inquiry/` and as an entry in
   `PAYMOB_NOT_FOUND_SHAPES` (`apps/server/src/paymob-inquiry.ts`), re-run, and
   only then turn the setting on.

A checkout flagged while the setting was off stays `pending`, so the next sweep
after the setting is turned on asks Paymob about it again — unless a person
has already resolved it from the console's «الدفع بالبطاقة» card, which the
sweep never overrides.
