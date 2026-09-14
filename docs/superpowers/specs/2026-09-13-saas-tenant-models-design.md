# SaaS tenant, plan and subscription models — design

Date: 2026-09-13. Branch: `SASS`. Scope: plan §9.3 Cloud-1 #6–8 (models only) and
Cloud-3 #13. Status: approved in conversation, awaiting written review.

## 1. What this slice delivers

The domain models, pure use-cases and SQLite persistence that let the cloud edition
say **which company this is, what it has bought, and what that entitles it to**.
Nothing in this slice resolves a tenant per request, renders a screen, or talks to a
billing provider. It produces the two objects the rest of the codebase already
consumes — `Entitlements` (`packages/domain/src/entitlements`) and
`LicenseStateView` (`packages/api/src/license-gate.ts`) — from a subscription record
instead of a signed licence file.

Out of scope, deliberately: per-request tenant routing in `apps/server`, the
onboarding wizard, a platform console, billing integration, Postgres, and enforcement
of branch and warehouse caps.

## 2. Decisions taken

| Decision | Choice | What would reverse it |
|---|---|---|
| Tenant isolation | **One SQLite database per tenant.** A small platform database holds tenants, plans and subscriptions; each tenant's books are a separate file opened through the existing `createBackend({ dbPath })`. | Needing cross-tenant queries inside one SQL statement, or more tenants than one box can hold open file handles for. |
| Plan shape | **Plan catalog as data plus add-ons on the subscription.** Entitlements are the plan bundle plus the subscription's add-on modules and extra capacity. | Selling only fixed tiers with no à la carte add-ons. |
| Placement | Domain in `packages/domain/src/platform/`, stores in `packages/persistence/src/platform-store.ts`, factory `createPlatform` in `packages/backend`. | A second consumer of these models outside this monorepo. |
| Lapse behaviour | Mirrors the desktop licence ethic: a lapse never withholds data. Past grace is READ_ONLY, never locked out. Only an archived tenant is unusable. | A product decision to hard-lock non-payers. |
| Module list | One `MODULE_CATALOG` in the domain, moved from `packages/api/src/app.ts` (`DEFAULT_ACTIVE_MODULES`). Plans, licences and the module gate read the same list. | Never. Two lists is how a licence names a module the gate does not know. |

## 3. Models

All timestamps are ISO-8601 strings in UTC. All ids are opaque strings supplied by
the caller (route layer), as every other domain module does. Money is `Money`
(`packages/domain/src/money`), stored as INTEGER at scale 1e-6, never a float.

### 3.1 Tenant

| Field | Type | Rules |
|---|---|---|
| `id` | string | caller-supplied |
| `code` | string | slug, `^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$`, unique, immutable after creation. Used later as the routing key. |
| `nameAr` | string | required, trimmed, non-empty |
| `nameEn` | string \| null | |
| `ownerEmail` | string | normalised like `User.email` (trimmed, lower-cased), required |
| `status` | `provisioning` \| `active` \| `suspended` \| `archived` | see state machine |
| `dbFile` | string | derived once: `tenants/<code>.db`. Relative to the platform data directory. Never recomputed. |
| `createdAt`, `updatedAt` | string | |

State machine: `provisioning → active` (activateTenant), `active ⇄ suspended`
(suspendTenant / resumeTenant), `active | suspended → archived` (archiveTenant).
Archived is terminal.

### 3.2 Plan

| Field | Type | Rules |
|---|---|---|
| `id`, `code` | string | code unique, slug rules as tenant code |
| `nameAr`, `nameEn` | string | both required |
| `modules` | string[] | every entry in `MODULE_CATALOG`, deduplicated, non-empty |
| `features` | Record<string, boolean> | passed through to `Entitlements.features` |
| `seatsIncluded` | integer ≥ 1 | |
| `branchesIncluded`, `warehousesIncluded` | integer ≥ 1 | stored, not enforced in this slice |
| `priceMonthly`, `priceYearly` | Money (EGP) | ≥ 0 |
| `trialDays` | integer ≥ 0 | 0 means no trial |
| `isPublic` | boolean | whether a self-serve signup may pick it |
| `sortOrder` | integer | |
| `status` | `active` \| `retired` | retired plans keep their subscribers and cannot be picked for new subscriptions |
| `createdAt` | string | |

### 3.3 Subscription

| Field | Type | Rules |
|---|---|---|
| `id`, `tenantId`, `planId` | string | |
| `status` | `trialing` \| `active` \| `past_due` \| `suspended` \| `cancelled` | see state machine |
| `billingCycle` | `monthly` \| `yearly` | |
| `addOnModules` | string[] | each in `MODULE_CATALOG`; may overlap the plan bundle (union is taken) |
| `extraSeats`, `extraBranches`, `extraWarehouses` | integer ≥ 0 | |
| `currentPeriodStart`, `currentPeriodEnd` | string | end is start plus one month or one year, computed by the use-case |
| `trialEndsAt` | string \| null | set only when started as a trial |
| `graceDays` | integer ≥ 0 | default 7, matching the desktop check-in window |
| `cancelledAt` | string \| null | |
| `createdAt`, `updatedAt` | string | |

Invariant: **at most one subscription per tenant whose status is not `cancelled`.**
The repository exposes `findLiveByTenant(tenantId)` and `startSubscription` refuses
when one exists.

State machine:
- `startSubscription` → `trialing` when `plan.trialDays > 0` and the caller asks for
  a trial, else `active`.
- `trialing → active` via `renewSubscription` (first payment) or `changePlan`.
- `active → past_due` via `markPastDue` (only after `currentPeriodEnd`).
- `past_due → active` via `renewSubscription`. A renewal rolls the period from the old
  end when that end is still ahead, and from `now` when the subscription had lapsed.
- Every `now` a use-case receives is normalised to `toISOString()` form before it is stored or
  compared; an unparseable value is an `InvalidSubscriptionError`.
- `active | past_due → suspended` via `suspendSubscription`; `suspended → active` via
  `resumeSubscription`.
- any non-cancelled → `cancelled` via `cancelSubscription`. Terminal.

### 3.4 PlatformUser

| Field | Type |
|---|---|
| `id`, `email` (normalised, unique), `passwordHash` (via the existing `SecretHasher` port), `role` (`owner` \| `support`), `status` (`active` \| `inactive`), `createdAt` |

Model, repository and store only. No login route, no permissions, no screens in this slice.

## 4. Derivations

Both are pure functions in `packages/domain/src/platform/`.

### 4.1 `deriveEntitlements(plan, subscription): Entitlements`

- `plan` = `plan.code`
- `activeModules` = deduplicated union of `plan.modules` and `subscription.addOnModules`
- `features` = `plan.features`
- `seats` = `plan.seatsIncluded + subscription.extraSeats`
- `expiresAt` = `trialEndsAt` while `trialing`, else `currentPeriodEnd`

A cancelled or suspended subscription still derives its modules; whether they may be
used is the licence state's job, not this function's.

### 4.2 `subscriptionLicenseState(tenant, subscription | null, now): LicenseStateView`

Evaluated in order, first match wins. `now` is normalised through `isoTimestamp` first; a
value that does not parse is `INVALID_CLOCK` and never grants writes.

| Condition | state | canWrite | usable |
|---|---|---|---|
| `now` unparseable | `INVALID` | false | true |
| `tenant.status === "archived"` | `INVALID` | false | false |
| `tenant.status === "provisioning"` or no subscription | `UNLICENSED` | false | true |
| `tenant.status === "suspended"` | `READ_ONLY` | false | true |
| subscription `cancelled` or `suspended` | `READ_ONLY` | false | true |
| `trialing` and `now < trialEndsAt` | `ACTIVE` | true | true |
| `trialing` and `now ≥ trialEndsAt` | `READ_ONLY` | false | true |
| `active` or `past_due`, `now < currentPeriodEnd` | `ACTIVE` | true | true |
| `active` or `past_due`, `now < currentPeriodEnd + graceDays` | `GRACE` | true | true |
| otherwise | `READ_ONLY` | false | true |

`licensee` = `tenant.nameAr`, `expiresAt` as in 4.1, `graceEndsAt` set when GRACE,
`reason` is a literal from a closed union (`SubscriptionLicenseReason`) on every non-writable row. A READ_ONLY tenant keeps every read, print and
export; only mutating routes are refused by the existing write gate.

## 5. Use-cases

Every use-case takes a command plus repository ports, validates, throws a typed error
with an Arabic message (the `errors.ts` pattern in `api-keys`), and persists. None
generates ids or reads the clock; both arrive in the command.

Tenant: `createTenant`, `activateTenant`, `suspendTenant`, `resumeTenant`, `archiveTenant`.
Plan: `createPlan`, `updatePlan` (names, features, capacity, prices, isPublic, sortOrder,
modules; `code` is immutable; a module may be added to a plan at any time, and removed
only while the plan has no non-cancelled subscription), `retirePlan`.
Subscription: `startSubscription`, `renewSubscription`, `changePlan`, `markPastDue`,
`suspendSubscription`, `resumeSubscription`, `cancelSubscription`.
Derivations: `deriveEntitlements`, `subscriptionLicenseState`.

Errors: `InvalidTenantError`, `TenantNotFoundError`, `TenantCodeTakenError`,
`InvalidTenantTransitionError`, `InvalidPlanError`, `PlanNotFoundError`, `PlanCodeTakenError`,
`PlanRetiredError`, `PlanInUseError`, `InvalidSubscriptionError`, `SubscriptionNotFoundError`,
`TenantAlreadySubscribedError`, `InvalidSubscriptionTransitionError`,
`InvalidPlatformUserError`, `PlatformUserEmailTakenError`.

## 6. Persistence

`packages/persistence/src/platform-store.ts` opens one connection (`platform.db`, or
`:memory:` in tests) and returns `{ tenants, plans, subscriptions, platformUsers, close }`.
Prepared statements, upsert by id, JSON columns for arrays and feature maps, the same
style as `api-key-store.ts`. Tables: `tenant`, `plan`, `subscription`, `platform_user`.
Unique indexes on `tenant.code`, `plan.code`, `platform_user.email`. A partial unique
index `subscription(tenant_id) WHERE status <> 'cancelled'` enforces the one-live
invariant at the database as well as in the use-case.

## 7. Backend factory and seed

`packages/backend/src/create-platform.ts` exports `createPlatform({ dbPath })`, which
bootstraps the schema and seeds whichever of these three plans is missing, by code, so a
partial earlier seed never leaves one out:

| code | modules | seats | trial |
|---|---|---|---|
| `core` | dashboard, accounting, sales, purchases, inventory, treasury, transactions, workflow, audit, admin, notifications | 3 | 14 days |
| `business` | core plus crm, installments, financial_papers, field, assets, projects | 10 | 14 days |
| `enterprise` | all nineteen (adds hr, manufacturing) | 25 | 14 days |

**Open decision for the owner:** monthly and yearly EGP prices. The seed writes `0` for
all six until they are given; this line is the register for that placeholder.

The demo mount (`apps/server/src/cloud.ts`) is untouched in this slice.

## 8. Testing

`docs/TESTING.md` §1 requires automated tests again. This slice ships vitest unit tests
beside every use-case and derivation (state machines, validation, the union and
capacity arithmetic, every row of the licence-state table) and a store test against
`:memory:` that round-trips each model and proves the partial unique index refuses a
second live subscription. Gates before commit: `pnpm typecheck && pnpm lint && pnpm test`.

## 9. What the next slices build on this

1. **Routing**: `apps/server` resolves the tenant by code, opens or reuses its backend,
   and wires `resolveEntitlements` and `resolveLicenseState` to the two derivations.
   Branch and warehouse caps become enforced there.
2. **Onboarding**: company-code signup that calls `createTenant`, `startSubscription`
   with a trial, and the existing `/bootstrap/*` seed on the new tenant file.
3. **Console**: platform-admin screens over the plans and subscriptions.
4. **Billing**: provider webhook calls `renewSubscription` and `markPastDue`.
