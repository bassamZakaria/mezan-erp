# SaaS Slice B — Platform API, Console, Onboarding, Manual Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A platform operator signs in, creates a tenant that is immediately usable, records payments that renew subscriptions, edits plans, and sees each tenant's licence state; past-due subscriptions are marked by a daily sweep.

**Architecture:** A `Payment` model and a platform audit stream join the platform database. A second Hono app (`createPlatformRoutes`) with its own session registry serves `/platform/*`. Provisioning and the dunning sweep live in `apps/server` because they open tenant backends. The console is a React sub-application under `/platform` in the existing web bundle with its own session. Spec: `docs/superpowers/specs/2026-09-14-saas-completion-design.md` §2.

**Tech Stack:** TypeScript ESM (`.js` suffixes), Hono, zod (`@mezan/contracts`), vitest, React 19 + react-router + @tanstack/react-query in `apps/web`.

**Conventions**
- Commit subject only; NEVER `Co-Authored-By` or any trailer; `git commit -m "..." -- <files>`.
- No comments except a hidden invariant. No `any`. Arabic messages, English codes. Money never a float.
- Ids: route layer generates with `crypto.randomUUID()`; timestamps from an injected `now`.
- Run one test with `npx vitest run <path>`; `pnpm typecheck` and `pnpm lint` before every commit.
- Existing building blocks: `createPlatform` / `PlatformHandle` (`packages/backend/src/create-platform.ts`), platform domain (`packages/domain/src/platform/*`), `createSessionRegistry` + `readSessionToken` (`packages/api/src/session-auth.ts`), `createScryptHasher` (`@mezan/persistence`), `createSqliteAuditSink` (`packages/persistence/src/audit-sink.ts`, accepts an existing `Database`), `seedIfEmpty` + `SeedStores` (`packages/backend/src/seed.ts`), the tenant router (`apps/server/src/tenant-router.ts`), `LoginScreen` and `UsersPage` patterns in `apps/web`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/domain/src/platform/payment.ts` (+test) | `Payment`, `PaymentRepository`, `recordPayment` |
| `packages/domain/src/platform/payment-provider.ts` | `PaymentProvider` port, no implementation |
| `packages/domain/src/platform/platform-user.ts` (+test) | add `deactivatePlatformUser`, `verifyPlatformLogin` |
| `packages/persistence/src/platform-store.ts` (+test) | `payment` table and store |
| `packages/backend/src/create-platform.ts` (+test) | `audit` sink on the platform connection, `seedPlatformOwnerIfEmpty` |
| `packages/contracts/src/platform.ts` (+test) | zod schemas and DTOs for every platform request/response |
| `packages/backend/src/platform-auth.ts` (+test) | login/logout/me, `requirePlatform` middleware |
| `packages/backend/src/platform-routes.ts` (+test) | tenants, subscriptions, payments, plans, users |
| `apps/server/src/provision-tenant.ts` (+test) | create → seed → admin → subscribe → activate |
| `apps/server/src/dunning.ts` (+test) | `runDunningSweep`, `startDunningTimer` |
| `apps/web/src/platform/*` (+tests) | console: session, api, login, tenants, tenant detail, plans, users |
| `apps/web/src/router/routes.tsx`, `apps/web/src/i18n/catalog.ts` | mount `/platform/*`, strings |

---

### Task B1: Payment model, provider port, store

**Files:** `packages/domain/src/platform/payment.ts`, `payment.test.ts`, `payment-provider.ts`, `errors.ts` (add `InvalidPaymentError`), `index.ts`; `packages/persistence/src/platform-store.ts`, `platform-store.test.ts`.

- [ ] **Step 1: Failing tests.** Domain: `recordPayment({ id, tenantId, subscriptionId, amount: Money, reference, paidAt, recordedBy, note?, now }, payments, subscriptions)` saves a `Payment` with `currency: "EGP"` and normalised `paidAt`/`createdAt`, then calls `renewSubscription` and returns `{ payment, subscription }`; refuses amount ≤ 0, empty reference, unparseable `paidAt`, a subscription that is not the tenant's, and a cancelled subscription (the renew error surfaces). Store: round-trip, `listByTenant` ordered by `paidAt` desc, Money at scale 1e-6.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.**
```ts
export interface Payment {
  readonly id: string; readonly tenantId: string; readonly subscriptionId: string;
  readonly amount: Money; readonly currency: "EGP"; readonly reference: string;
  readonly paidAt: string; readonly recordedBy: string; readonly note: string | null; readonly createdAt: string;
}
export interface PaymentRepository { findById(id: string): Promise<Payment | null>; listByTenant(tenantId: string): Promise<Payment[]>; save(p: Payment): Promise<void>; }
export interface PaymentProvider {
  createCheckout(input: { tenantId: string; subscriptionId: string; amount: Money; returnUrl: string }): Promise<{ url: string; providerRef: string }>;
  verifyWebhook(rawBody: string, signature: string): Promise<{ providerRef: string; amount: Money; paidAt: string } | null>;
}
```
Table `payment (id PK, tenant_id, subscription_id, amount INTEGER, currency, reference, paid_at, recorded_by, note, created_at)` with an index on `(tenant_id, paid_at)`. Handle gains `payments`.
- [ ] **Step 4: Run + typecheck.**
- [ ] **Step 5: Commit** `feat(platform): a recorded payment renews the subscription`

---

### Task B2: platform user login verification, deactivation, owner seed, audit

**Files:** `packages/domain/src/platform/platform-user.ts` (+test), `packages/backend/src/create-platform.ts` (+test).

- [ ] **Step 1: Failing tests.** `verifyPlatformLogin({ email, password }, repo, hasher)` returns the user when active and the hash verifies, null otherwise (inactive user → null even with the right password; unknown email spends one `hasher.verify` on a decoy so timing does not leak — mirror `auth-routes.ts`'s decoy approach). `deactivatePlatformUser({ id, actorId }, repo)` refuses deactivating yourself (`InvalidPlatformUserError` «لا يمكنك تعطيل حسابك») and the last active owner («لا يمكن تعطيل آخر مالك للمنصة»). `createPlatform({ dbPath, owner: { email, password } })` seeds one owner when the table is empty and never a second; without `owner` and with an empty table, `platform.ownerSeeded` is `false`. `platform.audit` is an `AuditSink` on the same connection (append then `query("security")` returns the row).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** `createPlatform` options gain `owner?: { email; password }`, `hasher?: SecretHasher` (default `createScryptHasher()`); handle gains `audit: AuditSink`, `hasher`, `ownerSeeded: boolean`. Open the audit sink with `createSqliteAuditSink(<the same Database>)`; `createSqlitePlatformStores` must expose its `sqlite` on the handle for that (add `readonly sqlite: Database.Database`).
- [ ] **Step 4: Run + typecheck.**
- [ ] **Step 5: Commit** `feat(platform): platform login verification, the first owner, and an audit stream`

---

### Task B3: contracts

**Files:** `packages/contracts/src/platform.ts`, `platform.test.ts`, `index.ts`.

- [ ] Define and export (with `z.infer` DTO types): `platformLoginRequestSchema { email, password }`, `platformSessionSchema { token, user: { id, email, role } }`, `createTenantRequestSchema { code (slug regex), nameAr, nameEn?, ownerEmail, ownerNameAr, planId, billingCycle, trial: boolean }`, `provisionResultSchema { tenant, adminEmail, adminPin }`, `startSubscriptionRequestSchema`, `changePlanRequestSchema { planId }`, `recordPaymentRequestSchema { amount: decimal string, reference, paidAt, note? }`, `planUpsertRequestSchema` (every editable plan field; prices as decimal strings; modules from `MODULE_CATALOG`), `createPlatformUserRequestSchema { email, password (min 12), role }`, and response DTOs `TenantSummaryDTO { tenant, subscription | null, plan | null, licenseState, entitlements | null }`, `PaymentDTO`, `PlanDTO` (prices as decimal strings via `Money.toString()`). Tests: each schema accepts a valid body and rejects one bad field.
- [ ] Commit `feat(contracts): the platform console's request and response shapes`

---

### Task B4: platform auth routes

**Files:** `packages/backend/src/platform-auth.ts`, `platform-auth.test.ts`.

- [ ] **Step 1: Failing tests.** `createPlatformAuth({ platform, sessions, now })` returns `{ app, requirePlatform }`. `POST /auth/login` with the seeded owner → 200 `{ token, user }` and an audit row `PLATFORM_LOGIN_SUCCEEDED`; wrong password → 401 `{ error: "INVALID_CREDENTIALS", message: "بيانات الدخول غير صحيحة" }` and `PLATFORM_LOGIN_FAILED`; inactive → 401. `GET /me` with bearer → the user; without → 401 `{ error: "UNAUTHENTICATED" }`. `POST /auth/logout` revokes. `requirePlatform("owner")` on a test route → 403 `{ error: "OWNER_ONLY", message: "هذا الإجراء لمالك المنصة فقط" }` for a support session, passes for owner. Use the existing `LoginThrottle` if it is exported from `@mezan/api`; if not, skip throttling and say so in the report.
- [ ] **Step 3: Implement.** Sessions via `createSessionRegistry()`, grant `{ userId, permissions: ["platform.*"], roleCode: "platform-owner" | "platform-support", branchScope: ALL_SCOPE, warehouseScope: ALL_SCOPE }`; `requirePlatform(role?)` reads `readSessionToken`, `sessions.find(token, origin)`, sets `c.set("platformUser", { id, role })` (augment `ContextVariableMap`).
- [ ] Commit `feat(platform): operators sign in to the platform with email and password`

---

### Task B5: platform routes

**Files:** `packages/backend/src/platform-routes.ts`, `platform-routes.test.ts`, `packages/backend/src/index.ts`.

- [ ] **Step 1: Failing tests** (in-memory platform, seeded owner and one support user, sessions minted through the auth app). Every route in spec §2.3: reads succeed for support, writes 403 for support; `GET /tenants` lists summaries; `GET /tenants/:id` returns the summary with `licenseState` and `entitlements`; `POST /tenants` calls the injected `provisionTenant` and returns 201 with the one-time PIN; `/suspend`, `/resume`, `/archive` move the tenant and call `invalidateEntitlements(code)`; subscription start/change-plan/cancel/suspend/resume; `POST /payments` records and the summary's `currentPeriodEnd` advances; `GET /payments` lists; plans CRUD with Money parsed from decimal strings and `retire`; users create (owner only) and deactivate; every mutation appends a `platform` audit row (`stream: "security"`, `module: "platform"`, actor = platform user id). Domain errors map: `*NotFound` → 404, `Invalid*` → 422 `{ error: code, message }`, transition errors → 409.
- [ ] **Step 3: Implement.** `createPlatformRoutes({ platform, auth, now, provisionTenant, invalidateEntitlements, idOf = randomUUID })` returns a Hono app that mounts `auth.app` at `/auth` and the resource routes under `requirePlatform()` / `requirePlatform("owner")`. Summary builder: `tenantSummary(platform, tenant, nowIso)` reused by list and detail. Export from `packages/backend/src/index.ts`.
- [ ] Commit `feat(platform): the platform API — tenants, subscriptions, payments, plans, operators`

---

### Task B6: provisioning and the dunning sweep

**Files:** `apps/server/src/provision-tenant.ts` (+test), `apps/server/src/dunning.ts` (+test).

- [ ] **Step 1: Failing tests.** `provisionTenant(cmd, { platform, router, now, pinOf })`: creates the tenant, opens its backend through the router's cache (add `router.backendFor(code)` to the tenant router if not present), runs `seedIfEmpty` through the backend's seed stores (expose `seedStores` on `BackendHandle` if `createBackend` does not already; the test in `create-backend.test.ts` shows how `/bootstrap/seed` is reached — calling the backend's own `POST /bootstrap/seed` and `POST /bootstrap/admin` over `app.fetch` is acceptable and needs no new surface), creates the admin with `ownerEmail`, `ownerNameAr` and the generated PIN, starts the subscription, activates the tenant, returns `{ tenant, adminEmail, adminPin }`. A failure in seeding leaves the tenant `provisioning` and rethrows with the tenant id; a second call on a provisioning tenant with the same code resumes (idempotent: bootstrap seed is a no-op on a seeded tenant, `/bootstrap/admin` 409 is tolerated, subscription start is skipped when live). `runDunningSweep(platform, now)`: marks every active subscription past its period end `past_due`, leaves others, returns the count; `startDunningTimer` runs once immediately and every 24 h with an `unref` timer, returns `stop()`.
- [ ] **Step 3: Implement.** PIN: six digits from `crypto.randomInt`, injected as `pinOf` for tests.
- [ ] Commit `feat(server): an operator provisions a usable tenant in one call, and past-due is swept daily`

---

### Task B7: console — session, API client, login, shell

**Files:** `apps/web/src/platform/session.ts`, `api.ts`, `PlatformApp.tsx`, `PlatformLogin.tsx`, `PlatformShell.tsx`, tests; `apps/web/src/router/routes.tsx`; `apps/web/src/i18n/catalog.ts`.

- [ ] **Step 1: Failing tests.** `PlatformLogin` posts to `/platform/auth/login` and stores the session under `mezan.platform.session`; a 401 shows «بيانات الدخول غير صحيحة»; `PlatformApp` renders the login when no session and the shell (rail with «المنشآت», «الباقات», «المشغّلون», sign-out) when there is one; a 401 from any request clears the session.
- [ ] **Step 3: Implement.** Mount `{ path: "/platform/*", Component: PlatformApp }` as a sibling of the tenant app route in `routes.tsx` (before the `/` route). The console reuses the app's `AppI18nProvider`, tokens and `@mezan/ui` primitives; `dir="rtl"`; strings under `platform.*` in both dictionaries.
- [ ] Commit `feat(web): the platform console has a door and a shell`

---

### Task B8: console — tenants list, create dialog, tenant detail

**Files:** `apps/web/src/platform/TenantsPage.tsx`, `TenantDetailPage.tsx`, `NewTenantDialog.tsx`, `RecordPaymentDialog.tsx`, `hooks.ts`, tests; catalog strings.

- [ ] **Step 1: Failing tests** (jsdom, mocked transport like `UsersPage.test.tsx`): the list shows code, name, plan, status chip, licence chip, period end; «منشأة جديدة» opens the dialog, submit posts `createTenantRequest`, the result panel shows the code, admin email and PIN once with a copy button; detail shows subscription facts, buttons per state (suspend/resume/archive, change plan, cancel), «تسجيل دفعة» dialog posts and refreshes; support role sees no write buttons.
- [ ] Commit `feat(web): operators create tenants, record payments and see licence state`

---

### Task B9: console — plans and operators

**Files:** `apps/web/src/platform/PlansPage.tsx`, `PlanEditor.tsx`, `OperatorsPage.tsx`, tests; catalog strings.

- [ ] Plans list (code, names, modules count, seats, prices, status) and editor (names, modules as `MultiChipField` over `MODULE_CATALOG` with Arabic labels from the permission catalog's `MODULES`, capacity, prices as decimal strings, trial, public, sort, retire). Operators list and create (owner only), deactivate. Tests as B8.
- [ ] Commit `feat(web): plans and operators are edited in the console`

---

### Task B10: gates

- [ ] `pnpm typecheck && pnpm lint && pnpm test` exit 0. `pnpm lint:permission-labels` still passes (no new permission codes were added; `platform.*` is a session role, not a catalog permission).
