# SaaS completion — routing, platform console, onboarding, deploy

Date: 2026-09-14. Branch: `SASS`. Builds on `2026-09-13-saas-tenant-models-design.md`
(models, stores, `createPlatform`). Three slices, each merged to `main` on its own once its
gates and browser proof pass.

## 0. Decisions taken on 2026-09-14

| Decision | Choice |
|---|---|
| Tenant addressing | Both: the subdomain when the request arrives on `<code>.<MEZAN_TENANT_DOMAIN>`, otherwise the `x-mezan-tenant` header the web client sends after the owner types the company code at login. One bundle serves both. |
| Billing | Manual. A platform operator records a payment in the console; that records a `Payment` row and renews the subscription. A `PaymentProvider` port exists for a card processor later. No card checkout in this work. |
| Onboarding | Operator-created tenants only. No public signup. |
| Prices | core 490, business 980, enterprise 1960 EGP per month; yearly is ten times monthly. |
| Console | Pages under `/platform` in the existing web bundle, with their own platform-user session, Arabic first. |

## 1. Slice A — tenant routing and gating

### 1.1 Resolver
`apps/server/src/tenant-resolver.ts`: `resolveTenantCode(request, { tenantDomain })`.
- The host is `Host`, or `x-forwarded-host` when `trustForwardedHost` is on (CloudFront rewrites
  `Host` to the origin's, so the edge copies the viewer host into that header; only a deployment
  behind such a proxy turns this on). The port is stripped.
- If `tenantDomain` is set and the host ends with `.<tenantDomain>`, the code is the
  label before it, lower-cased. A host that is exactly the domain, or has a deeper label, resolves
  to null.
- Otherwise the `x-mezan-tenant` header, trimmed and lower-cased, when `allowTenantHeader` is on
  (default); absent means null.
- A resolved code that fails `isValidSlug` is treated as null.

### 1.2 Router
`apps/server/src/tenant-router.ts`: `createTenantRouter(options)` with
`{ platform: PlatformHandle, dataDir: string, tenantDomain?: string, idleMs?: number, now?: () => Date, createBackendForTenant? }`
returning `{ app: Hono, close(): Promise<void> }`.

- `GET /platform/resolve` (public): `{ mode: "subdomain" | "code", tenant: { code, nameAr, nameEn } | null }`.
  In subdomain mode the tenant is the one the host names; in code mode it is null unless the
  header is present and names a usable tenant.
- Everything else under the mount: resolve the code; null gives 400 `TENANT_REQUIRED`
  («حدّد رمز المنشأة»); unknown, `provisioning` or `archived` gives 404 `TENANT_NOT_FOUND`
  («المنشأة غير موجودة»); `suspended` is still dispatched (its licence state is READ_ONLY, so
  reads work and writes are refused by the existing write gate).
- Dispatch: `backend.app.fetch(request)` on the tenant's backend. Path and headers pass through
  unchanged.

### 1.3 Backend cache
`apps/server/src/backend-cache.ts`: `createBackendCache({ open, idleMs, now })` keyed by tenant
code. `get(code)` opens on first use (`createBackend({ dbPath: <dataDir>/tenants/<code>.db,
resolveEntitlements, resolveLicenseState })`), stamps last use, and a timer (`unref`) closes
handles idle longer than `idleMs` (default 30 minutes). `close()` closes all. Opening is
serialised per code so two concurrent first requests share one handle.

### 1.4 Entitlement and licence resolvers
`apps/server/src/tenant-entitlements.ts`: `createTenantResolvers(platform, code, { now, ttlMs })`
returns `{ resolveEntitlements, resolveLicenseState }`. Both read the tenant, its live
subscription and the plan from the platform stores, cached per tenant for `ttlMs`
(default 30 s), and call `deriveEntitlements` / `subscriptionLicenseState`. A tenant with no
live subscription derives its modules from its most recent subscription so reads keep working,
while the licence state (READ_ONLY after cancellation or lapse) refuses writes; only a tenant
that never had a subscription is `UNLICENSED` with `UNLICENSED_ENTITLEMENTS`. `invalidate(code)` is exposed so the platform routes drop the cache after a
change.

`createBackend` gains `resolveEntitlements?: EntitlementsResolver`, passed to `createApp`
exactly like `resolveLicenseState`. Desktop and LAN keep the default.

### 1.5 Capacity caps
`Entitlements` gains `readonly limits?: { readonly branches: number; readonly warehouses: number }`;
`entitlementsSchema` accepts it optionally; `deriveEntitlements` fills it from plan plus extras.
Enforcement, server-side only, on the create routes:
- `POST /users`: active users (status `active`) ≥ `seats` → 409 `SEAT_LIMIT_REACHED`
  («وصلتم إلى الحد الأقصى للمستخدمين في باقتكم»).
- `POST /branches`: count ≥ `limits.branches` → 409 `BRANCH_LIMIT_REACHED`
  («وصلتم إلى الحد الأقصى للفروع في باقتكم»).
- `POST /warehouses`: count ≥ `limits.warehouses` → 409 `WAREHOUSE_LIMIT_REACHED`
  («وصلتم إلى الحد الأقصى للمستودعات في باقتكم»).
No `limits` (desktop, LAN, tests) means no branch or warehouse cap; `seats` of 0 with no
resolver stays as today (the default resolver serves 10).

### 1.6 Web client
- `apps/web/src/data/session.ts`: persist `tenantCode` beside the session under its own key;
  `authHeaders` adds `x-mezan-tenant` when a code is stored. The code survives logout (the owner
  should not retype it) and is cleared by an explicit «تغيير المنشأة» link on the login screen.
- `apps/web/src/data/hooks.ts`: `usePlatformResolve()` → `GET /platform/resolve`.
- `LoginScreen`: in code mode, a company-code field (`mz-lat`, slug pattern) above the email
  field, prefilled from storage; the tenant name shows once the code resolves. In subdomain mode
  the field is hidden. A 404 `TENANT_NOT_FOUND` on login renders the Arabic message inline.

### 1.7 Tests and proof
Vitest: resolver (both modes, port stripping, deeper labels, bad slugs), cache (lazy open,
shared open, idle close, close-all), resolvers (cache TTL, unlicensed fallback, invalidate),
router (400/404 paths, dispatch to the right tenant, two tenants never share data — prove by
creating a customer in one and listing in the other), caps (each 409 and each success under the
cap). Browser proof is in slice C.

## 2. Slice B — platform API, console, onboarding, manual billing

### 2.1 Payment model
`packages/domain/src/platform/payment.ts`: `Payment { id, tenantId, subscriptionId, amount: Money,
currency: "EGP", reference, paidAt, recordedBy, note: string | null, createdAt }`,
`PaymentRepository { findById, listByTenant, save }`, `recordPayment(cmd, payments, subscriptions)`
which validates (amount > 0, reference non-empty, paidAt ISO), saves the payment and calls
`renewSubscription`. Table `payment` in `platform-store.ts`. `PaymentProvider` port
(`packages/domain/src/platform/payment-provider.ts`): `{ createCheckout, verifyWebhook }`, no
implementation in this work.

### 2.2 Platform sessions and auth
`packages/backend/src/platform-routes.ts`: `createPlatformRoutes(deps)` with
`{ platform, hasher, sessions: SessionRegistry, now, provisionTenant, invalidateEntitlements }`.
- `POST /platform/auth/login { email, password }` → `{ token, user: { id, email, role } }`.
  Wrong credentials 401 «بيانات الدخول غير صحيحة». Uses the existing `SessionRegistry` with
  `roleCode` `platform-owner` or `platform-support` and permissions `["platform.*"]`.
- `POST /platform/auth/logout`, `GET /platform/me`.
- Middleware `requirePlatform(role?)`: 401 without a session, 403 «هذا الإجراء لمالك المنصة فقط»
  when `owner` is required and the session is `support`.

### 2.3 Platform routes (all under `/platform`, read = any platform user, write = owner)
Tenants: `GET /tenants`, `GET /tenants/:id` (tenant + live subscription + plan + entitlements
preview + licence state + payments), `POST /tenants` (provision, §2.4), `POST /tenants/:id/suspend`,
`/resume`, `/archive`.
Subscriptions: `POST /tenants/:id/subscription` (start: planId, billingCycle, trial, add-ons,
extras), `POST /tenants/:id/subscription/change-plan`, `/cancel`, `/suspend`, `/resume`.
Payments: `POST /tenants/:id/payments { amount, reference, paidAt, note }` → records and renews;
`GET /tenants/:id/payments`.
Plans: `GET /plans`, `POST /plans`, `PUT /plans/:id`, `POST /plans/:id/retire`.
Platform users: `GET /users`, `POST /users { email, password, role }`, `POST /users/:id/deactivate`.
Every mutation invalidates the tenant's entitlement cache and writes the platform audit line
(`platform_audit` table: id, actor, action, tenantId, details, at).

### 2.4 Provisioning
`apps/server/src/provision-tenant.ts`: `provisionTenant(cmd)` with
`{ code, nameAr, nameEn, ownerEmail, ownerNameAr, planId, billingCycle, trial }`:
1. `createTenant` (status provisioning).
2. Open the tenant backend, run `seedIfEmpty`, create the company admin through the same path
   `POST /bootstrap/admin` uses, with a generated 6-digit PIN.
3. `startSubscription`, then `activateTenant`.
4. Return `{ tenant, adminEmail, adminPin }`. The PIN is shown once in the console and never
   stored by the platform.
On any failure after step 1 the tenant stays `provisioning` with the error in the response; the
operator can retry `POST /tenants/:id/provision`, which re-runs steps 2 to 3 idempotently.
Activation is the LAST step, so the router never dispatches to a tenant whose admin does not
exist yet. `/bootstrap/*` sits on the licence write-gate allowlist so seeding and the admin claim
work on a still-unlicensed tenant; both routes close themselves (seed is a no-op once non-empty,
admin refuses once claimed). Known trade-off: an unclaimed tenant suspended mid-provision can
still be claimed through `/bootstrap/admin` by whoever holds its code until it is archived.

### 2.5 Dunning sweep
`runDunningSweep(platform, now)`: every `active` subscription whose `currentPeriodEnd` < now →
`markPastDue`. Runs at server start and every 24 hours (timer `unref`). Past-due inside grace
still writes; past grace is READ_ONLY by the existing derivation.

### 2.6 Console UI
`apps/web/src/platform/`: `PlatformApp` mounted when the path starts with `/platform`, before
the tenant app router. Own session in localStorage (`mezan.platform.session`), own `request`
helper adding the bearer token. Pages: login; tenants list (code, name, plan, status, licence
state, period end) with «منشأة جديدة» dialog; tenant detail (facts, subscription actions,
change plan, record payment dialog, payments table, entitlements preview, the one-time admin PIN
after provisioning); plans list and edit form (names, modules as checkboxes from
`MODULE_CATALOG`, capacity, prices, trial, public, retire); platform users. Reuse
`settings/form-controls.tsx` and the users page layout. Every string in both dictionaries.
Support users see every page read-only.

### 2.7 Tests
Route tests over an in-memory platform (login, role gate, each route's happy path and refusal,
provisioning end to end against an in-memory tenant backend, payment renews, sweep marks past
due). UI: vitest component tests for the tenant list, the provisioning dialog and the payment
dialog, following the existing screen test style.

## 3. Slice C — deploy, seed and proof

- `apps/server/src/cloud.ts`: builds `createPlatform({ dbPath: <dir>/platform.db })`, seeds a
  platform owner from `MEZAN_PLATFORM_OWNER_EMAIL` / `MEZAN_PLATFORM_OWNER_PASSWORD` when no
  platform user exists (a generated password is printed once, like the admin PIN), mounts
  `createPlatformRoutes` at `/api/platform` and `createTenantRouter` at `/api`. `MEZAN_SEED_DEMO=1`
  provisions tenant `demo` with the existing demo seed on an enterprise subscription.
  `MEZAN_PLATFORM_DIR` defaults to `.data/platform`; `MEZAN_TENANT_DOMAIN` optional. Exactly one
  process may own a `MEZAN_PLATFORM_DIR` at a time — ECS's deployment min 0 / max 100 guarantees
  that (the old task stops before the new one starts), and `MEZAN_SQLITE_EXCLUSIVE=1` makes a
  second process that opens the same directory anyway fail fast instead of corrupting it.
- `apps/server/src/index.ts` (dev): same wiring on `./.data/dev-platform`.
- `scripts/env.mjs`: `MEZAN_PLATFORM_DIR=.data/<env>-platform`; `render.yaml`: `/tmp/platform`.
- Seed prices become 490 / 980 / 1960 monthly and ten times yearly; the placeholder comment goes.
- Docs: `ENVIRONMENTS.md`, `DEPLOY-DEMO.md` (platform owner login, demo tenant code),
  `ROADMAP.md`.
- Browser proof on `pnpm env:testing` in the session's own Chrome tab group, recorded in
  `docs/TESTING.md` as scenarios `PLT-SAAS-01..08`: operator logs in; creates tenant `cyag` on
  business with a trial; owner logs in with code `cyag` and the one-time PIN; the nav shows only
  business modules and `/hr/*` answers 403 in Arabic; operator records a payment and the period
  advances; operator suspends the tenant and a posting is refused in Arabic while reads still
  work; a second tenant `nile` lists no customers of `cyag`; hosts-file entry `cyag.mezan.test`
  with `MEZAN_TENANT_DOMAIN=mezan.test` logs in with no code field.

## 4. Slice D — AWS infrastructure in Terraform (added 2026-09-14)

Decisions: region `eu-central-1`; the domain lives in a Route 53 hosted zone Terraform creates
(the registrar's nameservers point at it); tenant databases on EFS; minimal cost, no load
balancer, no NAT gateway.

### 4.1 Layout
`infra/terraform/bootstrap/` (run once: state bucket with versioning, DynamoDB lock table) and
`infra/terraform/` (the root: `providers.tf`, `variables.tf`, `network.tf`, `storage.tf`,
`registry.tf`, `compute.tf`, `api.tf`, `cdn.tf`, `dns.tf`, `secrets.tf`, `outputs.tf`,
`envs/demo.tfvars`). Provider versions pinned from the registry at authoring time. No community
modules.

### 4.2 Resources
- **Network**: one VPC, two public subnets in two AZs, internet gateway, no NAT. Security groups:
  task allows 8080 from the VPC link's group and 2049 to EFS; EFS allows 2049 from the task.
- **Frontend**: private S3 bucket, CloudFront distribution with origin access control, default
  root `index.html`, 403 and 404 mapped to `/index.html` 200 (SPA), ACM certificate in
  `us-east-1` for `<domain>` and `*.<domain>` validated by DNS, aliases for both. A CloudFront
  Function on viewer-request copies `host` into `x-forwarded-host`. Cache behaviour `/api/*` →
  API Gateway origin, caching disabled, all headers forwarded except `Host`, all methods.
- **Backend**: ECR repository (keep last 10 images); ECS cluster; Fargate task definition on
  ARM64, 256 CPU / 512 MB, containers: `app` (image from ECR, port 8080, env
  `MEZAN_PLATFORM_DIR=/data`, `MEZAN_SQLITE_EXCLUSIVE=1`, `MEZAN_TENANT_DOMAIN=<domain>`, secrets
  from SSM) and `backup` sidecar (image `public.ecr.aws/aws-cli/aws-cli`, entrypoint a shell loop
  every 15 minutes syncing `/data/backups` to the backup bucket; the app writes its own
  verified archives there through the existing backup feature). EFS filesystem (encrypted,
  bursting, lifecycle to IA after 30 days), access point at `/data` owned by the app UID, mount
  targets in both subnets, task volume with transit encryption. ECS service: desired count 1,
  `assign_public_ip = true`, deployment min 0 / max 100 percent (one writer, so the old task
  stops before the new one starts), Cloud Map service discovery in a private DNS namespace,
  circuit breaker with rollback.
- **API**: API Gateway HTTP API, VPC link in the two subnets, integration to the Cloud Map
  service on port 8080, `$default` route, auto-deploy stage, throttling 50 rps burst 100.
- **DNS**: hosted zone for `<domain>`, A/AAAA alias records for apex and `*.<domain>` to
  CloudFront, ACM validation records.
- **Secrets**: SSM SecureString parameters `/mezan/<env>/platform-owner-email`,
  `/mezan/<env>/platform-owner-password`, values supplied out of band (Terraform creates them
  with `ignore_changes` on value, initial value from a variable).
- **Backups**: versioned S3 bucket, lifecycle expiring noncurrent versions after 30 days,
  bucket policy for the task role only.
- **IAM**: task execution role (ECR pull, logs, SSM read), task role (S3 backup bucket write,
  EFS client). CloudWatch log group with 14-day retention.

### 4.3 Delivery
`.github/workflows/deploy-aws.yml` on push to `main`: build and push the ARM image to ECR with
the commit SHA tag, `terraform apply -auto-approve -var image_tag=<sha>` (state in the bootstrap
bucket, OIDC role, no long-lived keys), `aws s3 sync apps/web/dist s3://<bucket> --delete`,
CloudFront invalidation `/*`. `docs/DEPLOY-AWS.md` documents the one-time bootstrap, the
registrar nameserver step, secrets, cost, and how to run `terraform plan` locally.

### 4.4 App changes this slice needs
`MEZAN_SQLITE_EXCLUSIVE=1` makes `openSqliteConnection` set `locking_mode = EXCLUSIVE` before
WAL, the documented way to run WAL on NFS with a single writer. Nothing else.

### 4.5 Cost target
Fargate ≈ 9 USD, API Gateway < 1 USD, Route 53 0.50 USD, EFS + S3 + ECR + logs cents, CloudFront
and ACM in the free tier: about 11 to 13 USD per month.

## 5. Out of scope
Card checkout, public signup, Postgres, cross-tenant reporting, e-mail delivery of the PIN,
multi-task scaling (one writer per tenant file), Litestream.
