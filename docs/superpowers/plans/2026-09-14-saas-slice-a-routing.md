# SaaS Slice A — Tenant Routing and Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every `/api/*` request on the cloud mount reaches the backend of the tenant it names, gated by that tenant's subscription-derived entitlements, licence state and capacity caps; the web login learns the company code.

**Architecture:** `apps/server` gains a tenant resolver (subdomain or header), a per-tenant `createBackend` cache with idle eviction, per-tenant entitlement and licence resolvers over the platform database, and a router that dispatches to the cached backend. `Entitlements` gains optional `limits`; three create routes enforce seats and caps. The web client stores the tenant code and sends it as a header. Spec: `docs/superpowers/specs/2026-09-14-saas-completion-design.md` §1.

**Tech Stack:** TypeScript ESM (`.js` suffixes), Hono, vitest, better-sqlite3, React 19 in `apps/web`.

**Conventions every task follows**
- Commit message: subject only. NEVER `Co-Authored-By`, `Claude-Session` or any trailer. Commit with `git commit -m "..." -- <files>`; never `git add -A`.
- No comments except a hidden invariant. No `any`. Arabic refusal messages, English error codes.
- Run one test file with `npx vitest run <path>`; `pnpm typecheck` before every commit (the hook runs it too).
- Existing helpers: `isValidSlug`, `deriveEntitlements`, `subscriptionLicenseState`, `createEntitlements`, `PlatformHandle` (`stores.tenants/plans/subscriptions`) from `@mezan/domain` / `@mezan/backend`; `createBackend({ dbPath, resolveLicenseState })` from `@mezan/backend`; `EntitlementsResolver` from `@mezan/api` (`packages/api/src/module-gate.ts`), `LicenseStateResolver` and `LicenseStateView` from `packages/api/src/license-gate.ts`.

---

## File map

| File | Responsibility |
|---|---|
| `packages/domain/src/entitlements/entitlements.ts` | `limits?` on `Entitlements`; `UNLICENSED_ENTITLEMENTS` constant |
| `packages/contracts/src/entitlements.ts` | optional `limits` in `entitlementsSchema` |
| `packages/domain/src/platform/derive.ts` | `deriveEntitlements` fills `limits` |
| `packages/backend/src/create-backend.ts` | `resolveEntitlements?` option passthrough |
| `packages/api/src/users-routes.ts`, `branches-routes.ts`, `warehouses-routes.ts`, `app.ts` | caps |
| `apps/server/src/tenant-resolver.ts` | code from host or header |
| `apps/server/src/backend-cache.ts` | lazy, idle-evicting backend handles |
| `apps/server/src/tenant-entitlements.ts` | per-tenant resolvers over the platform db |
| `apps/server/src/tenant-router.ts` | `/platform/resolve` + dispatch |
| `apps/web/src/data/session.ts`, `hooks.ts`, `login/LoginScreen.tsx`, `i18n/catalog.ts` | company code at login |

---

### Task A1: `limits` on Entitlements, contract and derivation

**Files:**
- Modify: `packages/domain/src/entitlements/entitlements.ts`
- Modify: `packages/domain/src/entitlements/entitlements.test.ts`
- Modify: `packages/contracts/src/entitlements.ts`, `packages/contracts/src/entitlements.test.ts`
- Modify: `packages/domain/src/platform/derive.ts`, `derive.test.ts`

- [ ] **Step 1: Failing tests**

In `entitlements.test.ts` add: `createEntitlements` preserves `limits` when given and leaves it `undefined` when not; `UNLICENSED_ENTITLEMENTS` has plan `"UNLICENSED"`, no modules, no features, 0 seats, `expiresAt` null, no limits. In `contracts/entitlements.test.ts`: schema accepts `limits: { branches: 3, warehouses: 3 }`, rejects `limits: { branches: -1 }`, accepts absent `limits`. In `derive.test.ts`: `deriveEntitlements` returns `limits: { branches: plan.branchesIncluded + sub.extraBranches, warehouses: plan.warehousesIncluded + sub.extraWarehouses }` (use the existing fixtures: plan 1/1, extras 0/0 → 1/1; add a case with extras 2/3 → 3/4).

- [ ] **Step 2: Run, see them fail.** `npx vitest run packages/domain/src/entitlements packages/contracts/src/entitlements.test.ts packages/domain/src/platform/derive.test.ts`

- [ ] **Step 3: Implement**

```ts
// entitlements.ts additions
export interface EntitlementLimits {
  readonly branches: number;
  readonly warehouses: number;
}
// on Entitlements:
  readonly limits?: EntitlementLimits;
// createEntitlements copies `limits: data.limits` (only when defined, so toEqual stays exact).
export const UNLICENSED_ENTITLEMENTS: EntitlementsView = createEntitlements({
  plan: "UNLICENSED", activeModules: [], features: {}, seats: 0, expiresAt: null,
});
```
Contracts: `limits: z.object({ branches: z.number().int().nonnegative(), warehouses: z.number().int().nonnegative() }).optional()`.
`derive.ts`: add `limits: { branches: plan.branchesIncluded + subscription.extraBranches, warehouses: plan.warehousesIncluded + subscription.extraWarehouses }` and fix the existing exact `toEqual` in `derive.test.ts` to include it. Export `EntitlementLimits` and `UNLICENSED_ENTITLEMENTS` from `entitlements/index.ts`. If `apps/desktop/src/main/entitlements.ts` defines its own `UNLICENSED_ENTITLEMENTS`, replace it with the domain import.

- [ ] **Step 4: Run tests + `pnpm typecheck`.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(entitlements): a plan's branch and warehouse caps travel with the entitlements`

---

### Task A2: `resolveEntitlements` through `createBackend`

**Files:** `packages/backend/src/create-backend.ts`, `packages/backend/src/create-backend.test.ts`

- [ ] **Step 1: Failing test.** In `create-backend.test.ts`, following its existing `keep`/session helpers: create a backend with `resolveEntitlements: () => createEntitlements({ plan: "core", activeModules: ["sales"], features: {}, seats: 1, expiresAt: null })`, mint an admin session, and assert `GET /entitlements` returns plan `"core"` and `GET /hr/employees` (or any `hr`-gated route the file already exercises) returns 403 with `error: "MODULE_NOT_LICENSED"`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** Add `readonly resolveEntitlements?: CreateAppOptions["resolveEntitlements"];` to `CreateBackendOptions` beside `resolveLicenseState` (same doc-comment style, one sentence) and spread it into `createApp` exactly like `resolveLicenseState`.
- [ ] **Step 4: Run + typecheck.** PASS.
- [ ] **Step 5: Commit** `feat(backend): the cloud edition can hand createBackend its tenant's entitlements`

---

### Task A2b: wire the module gate (found during A2: built, never called)

**Files:** `packages/api/src/permission-gate.ts`, `packages/api/src/module-gate.ts`, `packages/api/src/app.ts`, `packages/api/src/module-gate.test.ts` (extend) and `packages/backend/src/create-backend.test.ts` (one end-to-end case).

The module gate is exported and unit-tested but no route calls it, so an unlicensed module has never been refused. Wire it the way refusal reporting is wired: a middleware mounted once by `createApp` binds the request's entitlements on the Hono context, and the permission gates read it.

- [ ] **Step 1: Failing tests.** In `module-gate.test.ts`: `entitlementsBinding(resolver)` sets `c.get("entitlements")`. In a new describe using `createApp` (or the backend test harness): with a resolver giving `activeModules: ["sales"]`, a route gated on `hr.employee.view` returns 403 `{ error: "MODULE_NOT_LICENSED", module: "hr", message: "وحدة الموارد البشرية غير مفعّلة في باقتكم" }` even for the `"*"` admin; a route gated on `sales.invoice.view` passes the module check; a route gated on `admin.users.view` passes (always-licensed module); with no binding at all (desktop, tests that build routes directly) nothing is refused. In `create-backend.test.ts`: the A2 case now asserts `GET /hr/employees` (or the hr route the file already uses) is 403 `MODULE_NOT_LICENSED` under `activeModules: ["sales"]`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** `module-gate.ts`: `declare module "hono" { interface ContextVariableMap { entitlements?: Entitlements } }`; `export function entitlementsBinding(resolve: EntitlementsResolver): MiddlewareHandler` that sets `entitlements` when the resolver returns one; `export function moduleRefusal(moduleId: string)` returning the 403 body with the Arabic message «وحدة <labelAr> غير مفعّلة في باقتكم» using `MODULES.find(m => m.id === moduleId)?.labelAr` from the catalog (fall back to the id). `permission-gate.ts`: in `createPermissionGate` and `createAnyPermissionGate`, before the permission check, `const ent = c.get("entitlements"); const def = getPermission(code); if (ent && def && !isModuleLicensed(def.module, ent)) return c.json(moduleRefusal(def.module), 403);` (for the any-gate, refuse only when every candidate permission's module is unlicensed). `app.ts`: `app.use("*", entitlementsBinding(resolveEntitlements))` right after `permissionRefusalReporting`. `isModuleLicensed` already maps `cheques` → `financial_papers` and passes the always-licensed set.
- [ ] **Step 4: Run + typecheck.** Also run `npx vitest run packages/api packages/backend` since every gated route is affected; the default resolver serves all nineteen modules so nothing should change.
- [ ] **Step 5: Commit** `fix(api): the module gate was built and never wired; every permission now checks its module`

---

### Task A3: seat, branch and warehouse caps

**Files:** `packages/api/src/users-routes.ts`, `branches-routes.ts`, `warehouses-routes.ts`, `app.ts`, tests beside each (`users-routes.test.ts` exists? check; else add `capacity-caps.test.ts` in `packages/api/src`).

- [ ] **Step 1: Failing tests.** Using the file's existing test harness (or `createApp` with an in-memory uow the way `packages/api/src/*.test.ts` do), prove: with `resolveEntitlements` giving `seats: 1` and one active user, `POST /users` → 409 `{ error: "SEAT_LIMIT_REACHED", message: "وصلتم إلى الحد الأقصى للمستخدمين في باقتكم" }`; with `seats: 2` it succeeds; an `inactive` user does not count. With `limits: { branches: 1, warehouses: 1 }` and one branch, `POST /branches` → 409 `BRANCH_LIMIT_REACHED` «وصلتم إلى الحد الأقصى للفروع في باقتكم»; same for warehouses «وصلتم إلى الحد الأقصى للمستودعات في باقتكم»; with no `limits` both succeed regardless of count.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** `UsersRoutesOptions` gains `readonly resolveEntitlements?: EntitlementsResolver`; before `saveUser` on create: `const ent = await options.resolveEntitlements?.(c); if (ent) { const active = (await uow.users.list()).filter(u => u.status === "active").length; if (active >= ent.seats) return c.json({ error: "SEAT_LIMIT_REACHED", message: "..." }, 409); }` (use whatever the users repository accessor is in that file). `createBranchesRoutes(store, resolveAuth, resolveEntitlements?)` and `createWarehousesRoutes(store, resolveAuth, resolveEntitlements?)`: after schema validation and the `ALREADY_EXISTS` check: `const limit = (await resolveEntitlements?.(c))?.limits?.branches; if (limit !== undefined && (await store.findAll()).length >= limit) return 409`. In `app.ts` pass `resolveEntitlements` to all three.
- [ ] **Step 4: Run + typecheck.** PASS.
- [ ] **Step 5: Commit** `feat(api): seats, branches and warehouses stop at the plan's cap, in Arabic`

---

### Task A4: tenant resolver

**Files:** create `apps/server/src/tenant-resolver.ts`, `apps/server/src/tenant-resolver.test.ts`; modify `apps/server/package.json` (add `"@mezan/domain": "workspace:*"`, `"@mezan/api": "workspace:*"`, `"@mezan/persistence": "workspace:*"`, then `pnpm install --offline` or plain `pnpm install`).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveTenantCode } from "./tenant-resolver.js";

const req = (headers: Record<string, string>) => new Request("http://ignored/api/x", { headers });

describe("resolveTenantCode", () => {
  it("reads the subdomain when a tenant domain is configured", () => {
    expect(resolveTenantCode(req({ host: "cyag.mezan.app" }), { tenantDomain: "mezan.app" })).toBe("cyag");
    expect(resolveTenantCode(req({ host: "CYAG.mezan.app:8080" }), { tenantDomain: "mezan.app" })).toBe("cyag");
  });
  it("prefers x-forwarded-host over host", () => {
    expect(resolveTenantCode(req({ host: "d1.proxy.example", "x-forwarded-host": "nile.mezan.app" }), { tenantDomain: "mezan.app" })).toBe("nile");
  });
  it("gives null for the bare domain, a deeper label, or a host outside the domain", () => {
    expect(resolveTenantCode(req({ host: "mezan.app" }), { tenantDomain: "mezan.app" })).toBeNull();
    expect(resolveTenantCode(req({ host: "a.b.mezan.app" }), { tenantDomain: "mezan.app" })).toBeNull();
    expect(resolveTenantCode(req({ host: "cyag.other.app" }), { tenantDomain: "mezan.app" })).toBeNull();
  });
  it("falls back to the x-mezan-tenant header, trimmed and lower-cased", () => {
    expect(resolveTenantCode(req({ host: "localhost:4101", "x-mezan-tenant": " Cyag " }), {})).toBe("cyag");
    expect(resolveTenantCode(req({ host: "mezan.app", "x-mezan-tenant": "nile" }), { tenantDomain: "mezan.app" })).toBe("nile");
  });
  it("rejects a code that is not a slug", () => {
    expect(resolveTenantCode(req({ "x-mezan-tenant": "no spaces" }), {})).toBeNull();
    expect(resolveTenantCode(req({ host: "bad_code.mezan.app" }), { tenantDomain: "mezan.app" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement**

```ts
import { isValidSlug } from "@mezan/domain";

export interface TenantResolverOptions {
  readonly tenantDomain?: string;
}

export const TENANT_HEADER = "x-mezan-tenant";

function hostOf(request: Request): string | null {
  const raw = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!raw) return null;
  return raw.split(",")[0]!.trim().toLowerCase().replace(/:\d+$/, "");
}

function slugOrNull(value: string | null): string | null {
  if (!value) return null;
  const code = value.trim().toLowerCase();
  return isValidSlug(code) ? code : null;
}

export function resolveTenantCode(request: Request, options: TenantResolverOptions): string | null {
  const domain = options.tenantDomain?.toLowerCase();
  const host = hostOf(request);
  if (domain && host && host.endsWith(`.${domain}`)) {
    const label = host.slice(0, -(domain.length + 1));
    if (!label.includes(".")) return slugOrNull(label);
  }
  return slugOrNull(request.headers.get(TENANT_HEADER));
}
```

- [ ] **Step 4: Run + typecheck.** PASS.
- [ ] **Step 5: Commit** `feat(server): a request names its tenant by subdomain or header`

---

### Task A5: backend cache

**Files:** create `apps/server/src/backend-cache.ts`, `apps/server/src/backend-cache.test.ts`.

- [ ] **Step 1: Failing test.** Use fake handles: `open = vi.fn(async (code) => ({ code, close: vi.fn() }))`; fake clock `let t = 0; now = () => t`. Assert: `get("a")` calls `open` once and a second `get("a")` reuses it; two concurrent `get("a")` (call both before awaiting) call `open` once; `get("b")` opens a second; after advancing `t` past `idleMs` and calling `sweep()`, `a` and `b` are closed and the next `get("a")` reopens; `close()` closes everything open and later `get` throws `CACHE_CLOSED`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement**

```ts
export interface CachedHandle { close(): void | Promise<void> }

export interface BackendCacheOptions<H extends CachedHandle> {
  readonly open: (code: string) => Promise<H>;
  readonly idleMs?: number;
  readonly now?: () => number;
  readonly sweepEveryMs?: number;
}

export interface BackendCache<H> {
  get(code: string): Promise<H>;
  sweep(): Promise<void>;
  close(): Promise<void>;
  readonly size: number;
}

export const DEFAULT_IDLE_MS = 30 * 60 * 1000;

export function createBackendCache<H extends CachedHandle>(options: BackendCacheOptions<H>): BackendCache<H> {
  const idleMs = options.idleMs ?? DEFAULT_IDLE_MS;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { handle: Promise<H>; lastUsed: number }>();
  let closed = false;
  const timer = options.sweepEveryMs === 0 ? null : setInterval(() => void sweep(), options.sweepEveryMs ?? 60_000);
  timer?.unref();

  async function sweep(): Promise<void> {
    const cutoff = now() - idleMs;
    for (const [code, entry] of entries) {
      if (entry.lastUsed <= cutoff) {
        entries.delete(code);
        await (await entry.handle).close();
      }
    }
  }

  return {
    get size() { return entries.size; },
    async get(code) {
      if (closed) throw new Error("CACHE_CLOSED");
      const existing = entries.get(code);
      if (existing) { existing.lastUsed = now(); return existing.handle; }
      const entry = { handle: options.open(code), lastUsed: now() };
      entries.set(code, entry);
      try { return await entry.handle; } catch (err) { entries.delete(code); throw err; }
    },
    sweep,
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      const open = [...entries.values()]; entries.clear();
      for (const entry of open) await (await entry.handle).close();
    },
  };
}
```
Tests pass `sweepEveryMs: 0` to avoid the interval.

- [ ] **Step 4: Run + typecheck.** PASS.
- [ ] **Step 5: Commit** `feat(server): tenant backends open on first use and close when idle`

---

### Task A6: per-tenant entitlement and licence resolvers

**Files:** create `apps/server/src/tenant-entitlements.ts`, `apps/server/src/tenant-entitlements.test.ts`.

- [ ] **Step 1: Failing test.** Build `createPlatform({ dbPath: ":memory:" })`, create a tenant `cyag` (active) through `createTenant` + `activateTenant`, start an active subscription on `PLAN-BUSINESS` with `extraSeats: 2`. Then `const r = createTenantResolvers(platform, "cyag", { now: () => T, ttlMs: 1000 })`. Assert `await r.resolveEntitlements()` has plan `"business"`, `seats` 12, `limits.branches` 3, `activeModules` including `crm` and excluding `hr`; `await r.resolveLicenseState()` has `state: "ACTIVE"`, `canWrite: true`, `licensee` the tenant nameAr. Cancel the subscription directly through `cancelSubscription`; the resolver still answers ACTIVE within the TTL; after `r.invalidate()` it answers `READ_ONLY`. A tenant with no subscription resolves `UNLICENSED_ENTITLEMENTS` and state `UNLICENSED`. An unknown code resolves `UNLICENSED_ENTITLEMENTS` and `{ state: "INVALID", usable: false }`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement**

```ts
import {
  createEntitlements, deriveEntitlements, subscriptionLicenseState, UNLICENSED_ENTITLEMENTS,
  type Entitlements,
} from "@mezan/domain";
import type { PlatformHandle } from "@mezan/backend";
import type { LicenseStateView } from "@mezan/api";

export interface TenantResolvers {
  resolveEntitlements(): Promise<Entitlements>;
  resolveLicenseState(): Promise<LicenseStateView>;
  invalidate(): void;
}

interface Snapshot { readonly entitlements: Entitlements; readonly license: LicenseStateView; readonly at: number }

const MISSING_TENANT: LicenseStateView = { state: "INVALID", canWrite: false, usable: false, reason: "TENANT_NOT_FOUND" };

export function createTenantResolvers(
  platform: PlatformHandle,
  code: string,
  options: { readonly now?: () => Date; readonly ttlMs?: number } = {},
): TenantResolvers {
  const now = options.now ?? (() => new Date());
  const ttl = options.ttlMs ?? 30_000;
  let snapshot: Snapshot | null = null;

  async function load(): Promise<Snapshot> {
    const at = now();
    const tenant = await platform.stores.tenants.findByCode(code);
    if (!tenant) return { entitlements: UNLICENSED_ENTITLEMENTS, license: MISSING_TENANT, at: at.getTime() };
    const subscription = await platform.stores.subscriptions.findLiveByTenant(tenant.id);
    const plan = subscription ? await platform.stores.plans.findById(subscription.planId) : null;
    const entitlements = subscription && plan
      ? createEntitlements(deriveEntitlements(plan, subscription))
      : UNLICENSED_ENTITLEMENTS;
    const license = subscriptionLicenseState(tenant, subscription, at.toISOString());
    return { entitlements, license, at: at.getTime() };
  }

  async function current(): Promise<Snapshot> {
    if (snapshot && now().getTime() - snapshot.at < ttl) return snapshot;
    snapshot = await load();
    return snapshot;
  }

  return {
    async resolveEntitlements() { return (await current()).entitlements; },
    async resolveLicenseState() { return (await current()).license; },
    invalidate() { snapshot = null; },
  };
}
```
Check that `packages/api/src/index.ts` exports `LicenseStateView`; add it if not.

- [ ] **Step 4: Run + typecheck.** PASS.
- [ ] **Step 5: Commit** `feat(server): a tenant's entitlements and licence come from its subscription`

---

### Task A7: tenant router

**Files:** create `apps/server/src/tenant-router.ts`, `apps/server/src/tenant-router.test.ts`.

- [ ] **Step 1: Failing test.** Build an in-memory platform with tenants `cyag` (active, enterprise subscription), `nile` (active, core), `old` (archived), `new` (provisioning). Create the router with `dataDir` a temp dir (`mkdtempSync`), `tenantDomain: "mezan.test"`, `sweepEveryMs: 0`, and an injected `openBackend` that calls `createBackend({ dbPath: ":memory:", resolveEntitlements, resolveLicenseState })` so tests need no files. Through `router.app.fetch`: `GET /platform/resolve` with host `cyag.mezan.test` → `{ mode: "subdomain", tenant: { code: "cyag", ... } }`; with host `localhost` and no header → `{ mode: "code", tenant: null }`; with header `x-mezan-tenant: nile` → tenant nile. `GET /tenant` with no code → 400 `TENANT_REQUIRED` and Arabic message; with `x-mezan-tenant: ghost` → 404 `TENANT_NOT_FOUND`; `old` and `new` → 404. Isolation: `POST /bootstrap/admin` on `cyag` and on `nile` (each gets its own session), create a customer in `cyag` via `POST /customers`, list customers in `nile` → empty, in `cyag` → one. Module gate: on `nile` (core plan) `GET /crm/leads` → 403 `MODULE_NOT_LICENSED`; on `cyag` → 200. `router.close()` closes every opened backend (spy on `close`).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement**

```ts
import { Hono } from "hono";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { createBackend, type BackendHandle, type PlatformHandle } from "@mezan/backend";
import { createBackendCache, type BackendCache } from "./backend-cache.js";
import { createTenantResolvers, type TenantResolvers } from "./tenant-entitlements.js";
import { resolveTenantCode, TENANT_HEADER } from "./tenant-resolver.js";

export interface TenantRouterOptions {
  readonly platform: PlatformHandle;
  readonly dataDir: string;
  readonly tenantDomain?: string;
  readonly idleMs?: number;
  readonly sweepEveryMs?: number;
  readonly now?: () => Date;
  readonly openBackend?: (code: string, dbPath: string, resolvers: TenantResolvers) => Promise<BackendHandle>;
}

export interface TenantRouter {
  readonly app: Hono;
  invalidate(code: string): void;
  close(): Promise<void>;
}

export function tenantDbPath(dataDir: string, dbFile: string): string {
  return path.join(dataDir, dbFile);
}

export function createTenantRouter(options: TenantRouterOptions): TenantRouter {
  const resolvers = new Map<string, TenantResolvers>();
  const resolversFor = (code: string) => {
    let r = resolvers.get(code);
    if (!r) { r = createTenantResolvers(options.platform, code, { now: options.now }); resolvers.set(code, r); }
    return r;
  };
  const openBackend = options.openBackend ?? (async (_code, dbPath, r) => {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    return createBackend({
      dbPath,
      resolveEntitlements: () => r.resolveEntitlements(),
      resolveLicenseState: () => r.resolveLicenseState(),
    });
  });
  const cache: BackendCache<BackendHandle> = createBackendCache({
    idleMs: options.idleMs,
    sweepEveryMs: options.sweepEveryMs,
    open: async (code) => {
      const tenant = await options.platform.stores.tenants.findByCode(code);
      if (!tenant) throw new Error("TENANT_NOT_FOUND");
      return openBackend(code, tenantDbPath(options.dataDir, tenant.dbFile), resolversFor(code));
    },
  });

  const app = new Hono();
  const resolverOptions = { tenantDomain: options.tenantDomain };

  app.get("/platform/resolve", async (c) => {
    const mode = options.tenantDomain ? "subdomain" : "code";
    const code = resolveTenantCode(c.req.raw, resolverOptions);
    const tenant = code ? await options.platform.stores.tenants.findByCode(code) : null;
    const usable = tenant && (tenant.status === "active" || tenant.status === "suspended");
    return c.json({ mode, tenant: usable ? { code: tenant.code, nameAr: tenant.nameAr, nameEn: tenant.nameEn } : null });
  });

  app.all("/*", async (c) => {
    const code = resolveTenantCode(c.req.raw, resolverOptions);
    if (!code) return c.json({ error: "TENANT_REQUIRED", message: "حدّد رمز المنشأة" }, 400);
    const tenant = await options.platform.stores.tenants.findByCode(code);
    if (!tenant || tenant.status === "archived" || tenant.status === "provisioning") {
      return c.json({ error: "TENANT_NOT_FOUND", message: "المنشأة غير موجودة" }, 404);
    }
    const backend = await cache.get(code);
    return backend.app.fetch(c.req.raw);
  });

  return {
    app,
    invalidate(code) { resolvers.get(code)?.invalidate(); },
    close: () => cache.close(),
  };
}
```
Note for the implementer: `backend.app.fetch(c.req.raw)` must receive the request with the path the tenant app expects (`/tenant`, `/customers`, …). The router is mounted at `/api` by `cloud.ts` later; inside the router the path is already stripped by Hono's `route()`. Verify in the test that `router.app.fetch(new Request("http://x/tenant", …))` reaches the tenant app's `/tenant`; if Hono passes the original URL through, rebuild the request with the sub-path before dispatch. Header `TENANT_HEADER` is passed through unchanged.

- [ ] **Step 4: Run + typecheck.** PASS.
- [ ] **Step 5: Commit** `feat(server): every API request is dispatched to the backend of the tenant it names`

---

### Task A8: company code at login (web)

**Files:** `apps/web/src/data/session.ts`, `apps/web/src/data/hooks.ts`, `apps/web/src/login/LoginScreen.tsx`, `apps/web/src/i18n/catalog.ts` (both `webAr` and `webEn`), tests: `apps/web/src/data/session.test.ts` (extend or create), `apps/web/src/login/LoginScreen.test.tsx` (extend the existing one if present).

- [ ] **Step 1: Failing tests.** `session.ts`: `persistTenantCode("Cyag")` stores `"cyag"` under `mezan.tenantCode`, `loadTenantCode()` returns it, `clearTenantCode()` removes it, and `authHeaders(null)` includes `"x-mezan-tenant": "cyag"` when a code is stored and omits the key when none. LoginScreen: with `GET /platform/resolve` mocked to `{ mode: "code", tenant: null }` the screen renders the company-code input labelled «رمز المنشأة» (and "Company code" in en); typing `cyag` and blurring stores the code and refetches `/tenant`; with `{ mode: "subdomain", tenant: { code: "cyag", nameAr: "سياج" } }` no code input renders and the header shows «سياج»; a login answering 404 `TENANT_NOT_FOUND` shows «المنشأة غير موجودة» inline.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** `session.ts`: three functions plus `authHeaders` adding the header (guard the storage accessor with the same try/catch the file uses). `hooks.ts`: `usePlatformResolve()` → `useQuery(["platform","resolve"], GET /platform/resolve)` typed `{ mode: "subdomain" | "code"; tenant: { code: string; nameAr: string; nameEn: string | null } | null }`; `useTenantInfo` gets `enabled` only when a code is stored or mode is subdomain, and its query key includes the code. LoginScreen: a `TextInput` (`mz-lat`, `autoComplete="organization"`, pattern hint) above the email field when `mode === "code"`, prefilled from `loadTenantCode()`, on change lower-cases and persists; a «تغيير المنشأة» link clears it; error mapping for 400 `TENANT_REQUIRED` and 404 `TENANT_NOT_FOUND`. i18n keys: `login.tenantCode`, `login.tenantCodeHint`, `login.changeTenant`, `login.tenantNotFound`, `login.tenantRequired` in both dictionaries (`pnpm lint` checks the two dictionaries agree).
- [ ] **Step 4: Run + `pnpm typecheck` + `pnpm lint`.** PASS.
- [ ] **Step 5: Commit** `feat(web): the login screen learns the company code`

---

### Task A9: gates

- [ ] `pnpm typecheck && pnpm lint && pnpm test` all exit 0.
- [ ] `git diff --stat main..HEAD -- . ':!docs/superpowers'` shows only files in the File map plus `apps/server/package.json` and `pnpm-lock.yaml`.
- [ ] Commit nothing new unless the gates required a fix; report.
