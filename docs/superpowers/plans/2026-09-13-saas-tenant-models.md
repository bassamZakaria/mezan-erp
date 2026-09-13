# SaaS Tenant, Plan and Subscription Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Domain models, pure use-cases, SQLite stores and a `createPlatform` factory that turn a tenant's subscription into the `Entitlements` and licence-state objects the API gates already consume.

**Architecture:** A new `packages/domain/src/platform/` module (tenant, plan, subscription, platform user, two derivations), one `packages/persistence/src/platform-store.ts` over a single `platform.db`, and `packages/backend/src/create-platform.ts` that bootstraps and seeds three plans. One SQLite file per tenant is a routing concern for the next slice; this slice only records each tenant's `dbFile`. Spec: `docs/superpowers/specs/2026-09-13-saas-tenant-models-design.md`.

**Tech Stack:** TypeScript (ESM, `.js` import suffixes), vitest, better-sqlite3 via `openSqliteConnection`, `Money` from `@mezan/domain`.

**Conventions every task follows**
- Ids and timestamps arrive in the command. The domain never calls `randomUUID` or `new Date()`.
- Errors extend `Error`, carry a `code`, and have an Arabic `message` (pattern: `packages/domain/src/api-keys/errors.ts`).
- Money is `Money`; stored as INTEGER at scale 1e-6 via `money.toScaledNumber()` / `Money.fromScaled(n)`.
- No comments except a hidden invariant. Run `pnpm test -- <path>` for a single file.
- Commit after each task. No `Co-Authored-By` trailers.

---

## File map

| File | Responsibility |
|---|---|
| `packages/domain/src/platform/module-catalog.ts` | The one list of licensable module ids; `isKnownModule` |
| `packages/domain/src/platform/errors.ts` | Every typed error for the module |
| `packages/domain/src/platform/slug.ts` | Slug validation shared by tenant and plan codes |
| `packages/domain/src/platform/tenant.ts` | `Tenant`, `TenantRepository`, tenant use-cases |
| `packages/domain/src/platform/plan.ts` | `Plan`, `PlanRepository`, plan use-cases |
| `packages/domain/src/platform/subscription.ts` | `Subscription`, `SubscriptionRepository`, subscription use-cases |
| `packages/domain/src/platform/platform-user.ts` | `PlatformUser`, `PlatformUserRepository`, `createPlatformUser` |
| `packages/domain/src/platform/derive.ts` | `deriveEntitlements`, `subscriptionLicenseState` |
| `packages/domain/src/platform/index.ts` | Barrel |
| `packages/persistence/src/platform-store.ts` | SQLite stores for the four models, one connection |
| `packages/backend/src/create-platform.ts` | `createPlatform({ dbPath })`, plan seed |

---

### Task 1: Module catalog in the domain

**Files:**
- Create: `packages/domain/src/platform/module-catalog.ts`
- Create: `packages/domain/src/platform/module-catalog.test.ts`
- Create: `packages/domain/src/platform/index.ts`
- Modify: `packages/domain/src/index.ts` (append export)
- Modify: `packages/api/src/app.ts:213-235` (replace `DEFAULT_ACTIVE_MODULES`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/platform/module-catalog.test.ts
import { describe, it, expect } from "vitest";
import { MODULE_CATALOG, isKnownModule } from "./module-catalog.js";

describe("MODULE_CATALOG", () => {
  it("holds the nineteen modules the default entitlements served, each once", () => {
    expect(MODULE_CATALOG).toHaveLength(19);
    expect(new Set(MODULE_CATALOG).size).toBe(19);
    expect(MODULE_CATALOG).toContain("notifications");
    expect(MODULE_CATALOG).toContain("projects");
    expect(MODULE_CATALOG).toContain("accounting");
    expect(MODULE_CATALOG).toContain("hr");
  });

  it("recognises a catalog module and rejects anything else", () => {
    expect(isKnownModule("sales")).toBe(true);
    expect(isKnownModule("pos")).toBe(false);
    expect(isKnownModule("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/domain/src/platform/module-catalog.test.ts`
Expected: FAIL, cannot resolve `./module-catalog.js`.

- [ ] **Step 3: Write the catalog**

Copy the nineteen ids exactly from `DEFAULT_ACTIVE_MODULES` in `packages/api/src/app.ts` (read lines 205 to 235 first). Keep its doc comment with the list: it records why `pos` must stay out and that the ids are entitlement ids, not catalog ids, which is a hidden invariant.

```ts
// packages/domain/src/platform/module-catalog.ts
export const MODULE_CATALOG = [
  "dashboard",
  "sales",
  "purchases",
  "inventory",
  "accounting",
  "treasury",
  "installments",
  "financial_papers",
  "crm",
  "hr",
  "manufacturing",
  "assets",
  "field",
  "workflow",
  "audit",
  "transactions",
  "admin",
  "notifications",
  "projects",
] as const;

export type ModuleId = (typeof MODULE_CATALOG)[number];

const KNOWN = new Set<string>(MODULE_CATALOG);

export function isKnownModule(id: string): id is ModuleId {
  return KNOWN.has(id);
}
```

```ts
// packages/domain/src/platform/index.ts
export { MODULE_CATALOG, isKnownModule, type ModuleId } from "./module-catalog.js";
```

Append to `packages/domain/src/index.ts`:

```ts
/** SaaS platform — tenants, plans, subscriptions and what they entitle. */
export * from "./platform/index.js";
```

- [ ] **Step 4: Point the API at the catalog**

In `packages/api/src/app.ts` delete the `DEFAULT_ACTIVE_MODULES` const (and its doc comment above it) and replace every use of `DEFAULT_ACTIVE_MODULES` with `MODULE_CATALOG`, adding `MODULE_CATALOG` to the existing `@mezan/domain` import. If the doc comment on `CreateAppOptions.resolveEntitlements` (around line 765) names `DEFAULT_ACTIVE_MODULES`, rename it there too.

- [ ] **Step 5: Run tests and typecheck**

Run: `pnpm test -- packages/domain/src/platform packages/api/src/app.test.ts && pnpm typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/platform packages/domain/src/index.ts packages/api/src/app.ts
git commit -m "feat(platform): one module catalog, read by the gate and the plans alike"
```

---

### Task 2: Errors and slug validation

**Files:**
- Create: `packages/domain/src/platform/errors.ts`
- Create: `packages/domain/src/platform/slug.ts`
- Create: `packages/domain/src/platform/slug.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/platform/slug.test.ts
import { describe, it, expect } from "vitest";
import { isValidSlug } from "./slug.js";

describe("isValidSlug", () => {
  it("accepts lower-case letters, digits and inner hyphens, 3 to 32 long", () => {
    expect(isValidSlug("abc")).toBe(true);
    expect(isValidSlug("cyag-2026")).toBe(true);
    expect(isValidSlug("a".repeat(32))).toBe(true);
  });

  it("rejects upper case, edges hyphens, spaces, Arabic, and bad lengths", () => {
    expect(isValidSlug("Cyag")).toBe(false);
    expect(isValidSlug("-cyag")).toBe(false);
    expect(isValidSlug("cyag-")).toBe(false);
    expect(isValidSlug("cy ag")).toBe(false);
    expect(isValidSlug("سياج")).toBe(false);
    expect(isValidSlug("ab")).toBe(false);
    expect(isValidSlug("a".repeat(33))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/domain/src/platform/slug.test.ts`
Expected: FAIL, cannot resolve `./slug.js`.

- [ ] **Step 3: Write slug and errors**

```ts
// packages/domain/src/platform/slug.ts
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;

export function isValidSlug(value: string): boolean {
  return SLUG.test(value);
}
```

```ts
// packages/domain/src/platform/errors.ts
export class InvalidTenantError extends Error {
  readonly code = "INVALID_TENANT";
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
    this.name = "InvalidTenantError";
  }
}

export class TenantNotFoundError extends Error {
  readonly code = "TENANT_NOT_FOUND";
  constructor(readonly id: string) {
    super(`المنشأة "${id}" غير موجودة`);
    this.name = "TenantNotFoundError";
  }
}

export class TenantCodeTakenError extends Error {
  readonly code = "TENANT_CODE_TAKEN";
  constructor(readonly tenantCode: string) {
    super(`رمز المنشأة "${tenantCode}" مستخدم بالفعل`);
    this.name = "TenantCodeTakenError";
  }
}

export class InvalidTenantTransitionError extends Error {
  readonly code = "INVALID_TENANT_TRANSITION";
  constructor(readonly from: string, readonly to: string) {
    super(`لا يمكن نقل المنشأة من الحالة "${from}" إلى "${to}"`);
    this.name = "InvalidTenantTransitionError";
  }
}

export class InvalidPlanError extends Error {
  readonly code = "INVALID_PLAN";
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
    this.name = "InvalidPlanError";
  }
}

export class PlanNotFoundError extends Error {
  readonly code = "PLAN_NOT_FOUND";
  constructor(readonly id: string) {
    super(`الباقة "${id}" غير موجودة`);
    this.name = "PlanNotFoundError";
  }
}

export class PlanCodeTakenError extends Error {
  readonly code = "PLAN_CODE_TAKEN";
  constructor(readonly planCode: string) {
    super(`رمز الباقة "${planCode}" مستخدم بالفعل`);
    this.name = "PlanCodeTakenError";
  }
}

export class PlanRetiredError extends Error {
  readonly code = "PLAN_RETIRED";
  constructor(readonly id: string) {
    super(`الباقة "${id}" متوقفة ولا تقبل اشتراكات جديدة`);
    this.name = "PlanRetiredError";
  }
}

export class PlanInUseError extends Error {
  readonly code = "PLAN_IN_USE";
  constructor(readonly id: string, readonly modules: string[]) {
    super(`لا يمكن إزالة وحدات من الباقة "${id}" وبها اشتراكات سارية: ${modules.join("، ")}`);
    this.name = "PlanInUseError";
  }
}

export class InvalidSubscriptionError extends Error {
  readonly code = "INVALID_SUBSCRIPTION";
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
    this.name = "InvalidSubscriptionError";
  }
}

export class SubscriptionNotFoundError extends Error {
  readonly code = "SUBSCRIPTION_NOT_FOUND";
  constructor(readonly id: string) {
    super(`الاشتراك "${id}" غير موجود`);
    this.name = "SubscriptionNotFoundError";
  }
}

export class TenantAlreadySubscribedError extends Error {
  readonly code = "TENANT_ALREADY_SUBSCRIBED";
  constructor(readonly tenantId: string) {
    super(`المنشأة "${tenantId}" لديها اشتراك ساري بالفعل`);
    this.name = "TenantAlreadySubscribedError";
  }
}

export class InvalidSubscriptionTransitionError extends Error {
  readonly code = "INVALID_SUBSCRIPTION_TRANSITION";
  constructor(readonly from: string, readonly to: string) {
    super(`لا يمكن نقل الاشتراك من الحالة "${from}" إلى "${to}"`);
    this.name = "InvalidSubscriptionTransitionError";
  }
}

export class InvalidPlatformUserError extends Error {
  readonly code = "INVALID_PLATFORM_USER";
  constructor(readonly reasons: string[]) {
    super(reasons.join("; "));
    this.name = "InvalidPlatformUserError";
  }
}

export class PlatformUserEmailTakenError extends Error {
  readonly code = "PLATFORM_USER_EMAIL_TAKEN";
  constructor(readonly email: string) {
    super(`البريد "${email}" مستخدم بالفعل`);
    this.name = "PlatformUserEmailTakenError";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/domain/src/platform/slug.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/platform
git commit -m "feat(platform): slug rule and the typed errors the platform use-cases throw"
```

---

### Task 3: Tenant model and use-cases

**Files:**
- Create: `packages/domain/src/platform/tenant.ts`
- Create: `packages/domain/src/platform/tenant.test.ts`
- Modify: `packages/domain/src/platform/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/platform/tenant.test.ts
import { describe, it, expect } from "vitest";
import {
  createTenant,
  activateTenant,
  suspendTenant,
  resumeTenant,
  archiveTenant,
  type Tenant,
  type TenantRepository,
} from "./tenant.js";
import {
  InvalidTenantError,
  InvalidTenantTransitionError,
  TenantCodeTakenError,
  TenantNotFoundError,
} from "./errors.js";

function memoryRepo(seed: Tenant[] = []): TenantRepository & { rows: Map<string, Tenant> } {
  const rows = new Map(seed.map((t) => [t.id, t]));
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(code) { return [...rows.values()].find((t) => t.code === code) ?? null; },
    async list() { return [...rows.values()]; },
    async save(t) { rows.set(t.id, t); },
  };
}

const NOW = "2026-09-13T10:00:00.000Z";
const cmd = { id: "T1", code: "cyag", nameAr: "سياج", nameEn: "Cyag", ownerEmail: " Owner@Cyag.EG ", now: NOW };

describe("createTenant", () => {
  it("creates a provisioning tenant with a derived db file and a normalised email", async () => {
    const repo = memoryRepo();
    const t = await createTenant(cmd, repo);
    expect(t).toEqual({
      id: "T1", code: "cyag", nameAr: "سياج", nameEn: "Cyag", ownerEmail: "owner@cyag.eg",
      status: "provisioning", dbFile: "tenants/cyag.db", createdAt: NOW, updatedAt: NOW,
    });
    expect(repo.rows.get("T1")).toEqual(t);
  });

  it("refuses a bad slug, an empty Arabic name and an empty email, all at once", async () => {
    await expect(createTenant({ ...cmd, code: "Cy ag", nameAr: " ", ownerEmail: "" }, memoryRepo()))
      .rejects.toThrow(InvalidTenantError);
    await expect(createTenant({ ...cmd, code: "Cy ag", nameAr: " ", ownerEmail: "" }, memoryRepo()))
      .rejects.toMatchObject({ reasons: expect.arrayContaining([
        expect.stringContaining("code"), expect.stringContaining("nameAr"), expect.stringContaining("ownerEmail"),
      ]) });
  });

  it("refuses a code another tenant already holds", async () => {
    const repo = memoryRepo();
    await createTenant(cmd, repo);
    await expect(createTenant({ ...cmd, id: "T2" }, repo)).rejects.toThrow(TenantCodeTakenError);
  });
});

describe("tenant state machine", () => {
  async function seeded(status: Tenant["status"]) {
    const repo = memoryRepo();
    const t = await createTenant(cmd, repo);
    repo.rows.set(t.id, { ...t, status });
    return repo;
  }
  const LATER = "2026-09-14T00:00:00.000Z";

  it("provisioning → active, and stamps updatedAt", async () => {
    const repo = await seeded("provisioning");
    const t = await activateTenant({ id: "T1", now: LATER }, repo);
    expect(t.status).toBe("active");
    expect(t.updatedAt).toBe(LATER);
  });

  it("active ⇄ suspended", async () => {
    const repo = await seeded("active");
    expect((await suspendTenant({ id: "T1", now: LATER }, repo)).status).toBe("suspended");
    expect((await resumeTenant({ id: "T1", now: LATER }, repo)).status).toBe("active");
  });

  it("active or suspended → archived, and archived is terminal", async () => {
    const repo = await seeded("suspended");
    expect((await archiveTenant({ id: "T1", now: LATER }, repo)).status).toBe("archived");
    await expect(resumeTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
    await expect(activateTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
  });

  it("refuses provisioning → suspended and provisioning → archived", async () => {
    const repo = await seeded("provisioning");
    await expect(suspendTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
    await expect(archiveTenant({ id: "T1", now: LATER }, repo)).rejects.toThrow(InvalidTenantTransitionError);
  });

  it("reports a missing tenant", async () => {
    await expect(activateTenant({ id: "nope", now: LATER }, memoryRepo())).rejects.toThrow(TenantNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/domain/src/platform/tenant.test.ts`
Expected: FAIL, cannot resolve `./tenant.js`.

- [ ] **Step 3: Write the model and use-cases**

```ts
// packages/domain/src/platform/tenant.ts
import { normalizeEmail } from "../users/save-user.js";
import { isValidSlug } from "./slug.js";
import {
  InvalidTenantError,
  InvalidTenantTransitionError,
  TenantCodeTakenError,
  TenantNotFoundError,
} from "./errors.js";

export type TenantStatus = "provisioning" | "active" | "suspended" | "archived";

export interface Tenant {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly ownerEmail: string;
  readonly status: TenantStatus;
  readonly dbFile: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TenantRepository {
  findById(id: string): Promise<Tenant | null>;
  findByCode(code: string): Promise<Tenant | null>;
  list(): Promise<Tenant[]>;
  save(tenant: Tenant): Promise<void>;
}

export interface CreateTenantCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn?: string | null;
  readonly ownerEmail: string;
  readonly now: string;
}

export function tenantDbFile(code: string): string {
  return `tenants/${code}.db`;
}

function validate(cmd: CreateTenantCommand): string[] {
  const reasons: string[] = [];
  if (cmd.id.trim() === "") reasons.push("id is required");
  if (!isValidSlug(cmd.code)) reasons.push("code must be a slug of 3 to 32 lower-case letters, digits or inner hyphens");
  if (cmd.nameAr.trim() === "") reasons.push("nameAr is required");
  if (normalizeEmail(cmd.ownerEmail) === "") reasons.push("ownerEmail is required");
  return reasons;
}

export async function createTenant(cmd: CreateTenantCommand, repo: TenantRepository): Promise<Tenant> {
  const reasons = validate(cmd);
  if (reasons.length > 0) throw new InvalidTenantError(reasons);
  if (await repo.findByCode(cmd.code)) throw new TenantCodeTakenError(cmd.code);
  const tenant: Tenant = {
    id: cmd.id,
    code: cmd.code,
    nameAr: cmd.nameAr.trim(),
    nameEn: cmd.nameEn?.trim() || null,
    ownerEmail: normalizeEmail(cmd.ownerEmail),
    status: "provisioning",
    dbFile: tenantDbFile(cmd.code),
    createdAt: cmd.now,
    updatedAt: cmd.now,
  };
  await repo.save(tenant);
  return tenant;
}

export interface TenantTransitionCommand {
  readonly id: string;
  readonly now: string;
}

const TRANSITIONS: Readonly<Record<TenantStatus, readonly TenantStatus[]>> = {
  provisioning: ["active"],
  active: ["suspended", "archived"],
  suspended: ["active", "archived"],
  archived: [],
};

async function transition(
  cmd: TenantTransitionCommand,
  to: TenantStatus,
  repo: TenantRepository,
): Promise<Tenant> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new TenantNotFoundError(cmd.id);
  if (!TRANSITIONS[current.status].includes(to)) {
    throw new InvalidTenantTransitionError(current.status, to);
  }
  const next: Tenant = { ...current, status: to, updatedAt: cmd.now };
  await repo.save(next);
  return next;
}

export const activateTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "active", repo);
export const suspendTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "suspended", repo);
export const archiveTenant = (cmd: TenantTransitionCommand, repo: TenantRepository) => transition(cmd, "archived", repo);

export async function resumeTenant(cmd: TenantTransitionCommand, repo: TenantRepository): Promise<Tenant> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new TenantNotFoundError(cmd.id);
  if (current.status !== "suspended") throw new InvalidTenantTransitionError(current.status, "active");
  return transition(cmd, "active", repo);
}
```

Add to `packages/domain/src/platform/index.ts`:

```ts
export * from "./errors.js";
export { isValidSlug } from "./slug.js";
export {
  createTenant, activateTenant, suspendTenant, resumeTenant, archiveTenant,
  tenantDbFile,
  type Tenant, type TenantStatus, type TenantRepository,
  type CreateTenantCommand, type TenantTransitionCommand,
} from "./tenant.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/domain/src/platform/tenant.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/platform
git commit -m "feat(platform): the tenant record and its four-state lifecycle"
```

---

### Task 4: Plan model and use-cases

**Files:**
- Create: `packages/domain/src/platform/plan.ts`
- Create: `packages/domain/src/platform/plan.test.ts`
- Modify: `packages/domain/src/platform/index.ts`

Note: `updatePlan` needs to know whether a plan has live subscribers. It receives a `hasLiveSubscribers(planId)` port rather than the whole subscription repository, so this task does not depend on Task 5.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/platform/plan.test.ts
import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import { createPlan, updatePlan, retirePlan, type Plan, type PlanRepository } from "./plan.js";
import { InvalidPlanError, PlanCodeTakenError, PlanInUseError, PlanNotFoundError } from "./errors.js";

function memoryRepo(): PlanRepository & { rows: Map<string, Plan> } {
  const rows = new Map<string, Plan>();
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(code) { return [...rows.values()].find((p) => p.code === code) ?? null; },
    async list() { return [...rows.values()]; },
    async save(p) { rows.set(p.id, p); },
  };
}

const NOW = "2026-09-13T10:00:00.000Z";
const cmd = {
  id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core",
  modules: ["accounting", "sales", "sales"], features: { "reports.export": true },
  seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
  priceMonthly: Money.fromMajor("490"), priceYearly: Money.fromMajor("4900"),
  trialDays: 14, isPublic: true, sortOrder: 1, now: NOW,
};
const noSubscribers = async () => false;

describe("createPlan", () => {
  it("creates an active plan with deduplicated modules", async () => {
    const repo = memoryRepo();
    const plan = await createPlan(cmd, repo);
    expect(plan.status).toBe("active");
    expect(plan.modules).toEqual(["accounting", "sales"]);
    expect(plan.priceMonthly.equals(Money.fromMajor("490"))).toBe(true);
    expect(plan.createdAt).toBe(NOW);
    expect(repo.rows.get("P1")).toBe(plan);
  });

  it("refuses an unknown module, an empty bundle, zero seats, a negative price and a bad code", async () => {
    await expect(createPlan({ ...cmd, modules: ["pos"] }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, modules: [] }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, seatsIncluded: 0 }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, priceMonthly: Money.fromMajor("-1") }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, code: "Core!" }, memoryRepo())).rejects.toThrow(InvalidPlanError);
    await expect(createPlan({ ...cmd, trialDays: -1 }, memoryRepo())).rejects.toThrow(InvalidPlanError);
  });

  it("refuses a duplicate code", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    await expect(createPlan({ ...cmd, id: "P2" }, repo)).rejects.toThrow(PlanCodeTakenError);
  });
});

describe("updatePlan", () => {
  it("changes names, prices, capacity and adds a module, keeping code and createdAt", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    const next = await updatePlan(
      { id: "P1", nameEn: "Core+", priceMonthly: Money.fromMajor("590"), seatsIncluded: 5, modules: ["accounting", "sales", "inventory"], now: "2026-10-01T00:00:00.000Z" },
      repo, noSubscribers,
    );
    expect(next.code).toBe("core");
    expect(next.createdAt).toBe(NOW);
    expect(next.nameEn).toBe("Core+");
    expect(next.nameAr).toBe("الأساسية");
    expect(next.seatsIncluded).toBe(5);
    expect(next.modules).toEqual(["accounting", "sales", "inventory"]);
    expect(next.priceMonthly.equals(Money.fromMajor("590"))).toBe(true);
  });

  it("removes a module only while nobody live subscribes", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    await expect(updatePlan({ id: "P1", modules: ["accounting"], now: NOW }, repo, async () => true))
      .rejects.toThrow(PlanInUseError);
    const next = await updatePlan({ id: "P1", modules: ["accounting"], now: NOW }, repo, noSubscribers);
    expect(next.modules).toEqual(["accounting"]);
  });

  it("still validates on update and reports a missing plan", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    await expect(updatePlan({ id: "P1", seatsIncluded: 0, now: NOW }, repo, noSubscribers)).rejects.toThrow(InvalidPlanError);
    await expect(updatePlan({ id: "nope", now: NOW }, repo, noSubscribers)).rejects.toThrow(PlanNotFoundError);
  });
});

describe("retirePlan", () => {
  it("marks the plan retired and is idempotent", async () => {
    const repo = memoryRepo();
    await createPlan(cmd, repo);
    expect((await retirePlan({ id: "P1", now: NOW }, repo)).status).toBe("retired");
    expect((await retirePlan({ id: "P1", now: NOW }, repo)).status).toBe("retired");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/domain/src/platform/plan.test.ts`
Expected: FAIL, cannot resolve `./plan.js`.

- [ ] **Step 3: Write the model and use-cases**

```ts
// packages/domain/src/platform/plan.ts
import { Money } from "../money/money.js";
import { isKnownModule } from "./module-catalog.js";
import { isValidSlug } from "./slug.js";
import { InvalidPlanError, PlanCodeTakenError, PlanInUseError, PlanNotFoundError } from "./errors.js";

export type PlanStatus = "active" | "retired";

export interface Plan {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly modules: readonly string[];
  readonly features: Readonly<Record<string, boolean>>;
  readonly seatsIncluded: number;
  readonly branchesIncluded: number;
  readonly warehousesIncluded: number;
  readonly priceMonthly: Money;
  readonly priceYearly: Money;
  readonly trialDays: number;
  readonly isPublic: boolean;
  readonly sortOrder: number;
  readonly status: PlanStatus;
  readonly createdAt: string;
}

export interface PlanRepository {
  findById(id: string): Promise<Plan | null>;
  findByCode(code: string): Promise<Plan | null>;
  list(): Promise<Plan[]>;
  save(plan: Plan): Promise<void>;
}

export interface CreatePlanCommand {
  readonly id: string;
  readonly code: string;
  readonly nameAr: string;
  readonly nameEn: string;
  readonly modules: readonly string[];
  readonly features?: Readonly<Record<string, boolean>>;
  readonly seatsIncluded: number;
  readonly branchesIncluded: number;
  readonly warehousesIncluded: number;
  readonly priceMonthly: Money;
  readonly priceYearly: Money;
  readonly trialDays: number;
  readonly isPublic: boolean;
  readonly sortOrder: number;
  readonly now: string;
}

export type UpdatePlanCommand = { readonly id: string; readonly now: string } & Partial<
  Pick<Plan, "nameAr" | "nameEn" | "modules" | "features" | "seatsIncluded" | "branchesIncluded" | "warehousesIncluded" | "priceMonthly" | "priceYearly" | "trialDays" | "isPublic" | "sortOrder">
>;

export type HasLiveSubscribers = (planId: string) => Promise<boolean>;

function isCount(n: number, min: number): boolean {
  return Number.isInteger(n) && n >= min;
}

export function dedupeModules(modules: readonly string[]): string[] {
  return [...new Set(modules)];
}

function validate(plan: Omit<Plan, "status" | "createdAt">): string[] {
  const reasons: string[] = [];
  if (plan.id.trim() === "") reasons.push("id is required");
  if (!isValidSlug(plan.code)) reasons.push("code must be a slug of 3 to 32 lower-case letters, digits or inner hyphens");
  if (plan.nameAr.trim() === "") reasons.push("nameAr is required");
  if (plan.nameEn.trim() === "") reasons.push("nameEn is required");
  if (plan.modules.length === 0) reasons.push("at least one module is required");
  for (const m of plan.modules) if (!isKnownModule(m)) reasons.push(`unknown module "${m}"`);
  if (!isCount(plan.seatsIncluded, 1)) reasons.push("seatsIncluded must be an integer of at least 1");
  if (!isCount(plan.branchesIncluded, 1)) reasons.push("branchesIncluded must be an integer of at least 1");
  if (!isCount(plan.warehousesIncluded, 1)) reasons.push("warehousesIncluded must be an integer of at least 1");
  if (plan.priceMonthly.scaled < 0n) reasons.push("priceMonthly must not be negative");
  if (plan.priceYearly.scaled < 0n) reasons.push("priceYearly must not be negative");
  if (!isCount(plan.trialDays, 0)) reasons.push("trialDays must be an integer of at least 0");
  if (!Number.isInteger(plan.sortOrder)) reasons.push("sortOrder must be an integer");
  return reasons;
}

export async function createPlan(cmd: CreatePlanCommand, repo: PlanRepository): Promise<Plan> {
  const candidate: Plan = {
    id: cmd.id,
    code: cmd.code,
    nameAr: cmd.nameAr.trim(),
    nameEn: cmd.nameEn.trim(),
    modules: dedupeModules(cmd.modules),
    features: { ...(cmd.features ?? {}) },
    seatsIncluded: cmd.seatsIncluded,
    branchesIncluded: cmd.branchesIncluded,
    warehousesIncluded: cmd.warehousesIncluded,
    priceMonthly: cmd.priceMonthly,
    priceYearly: cmd.priceYearly,
    trialDays: cmd.trialDays,
    isPublic: cmd.isPublic,
    sortOrder: cmd.sortOrder,
    status: "active",
    createdAt: cmd.now,
  };
  const reasons = validate(candidate);
  if (reasons.length > 0) throw new InvalidPlanError(reasons);
  if (await repo.findByCode(cmd.code)) throw new PlanCodeTakenError(cmd.code);
  await repo.save(candidate);
  return candidate;
}

export async function updatePlan(
  cmd: UpdatePlanCommand,
  repo: PlanRepository,
  hasLiveSubscribers: HasLiveSubscribers,
): Promise<Plan> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new PlanNotFoundError(cmd.id);
  const { id: _id, now: _now, ...patch } = cmd;
  const next: Plan = {
    ...current,
    ...patch,
    nameAr: (patch.nameAr ?? current.nameAr).trim(),
    nameEn: (patch.nameEn ?? current.nameEn).trim(),
    modules: dedupeModules(patch.modules ?? current.modules),
    features: { ...(patch.features ?? current.features) },
  };
  const reasons = validate(next);
  if (reasons.length > 0) throw new InvalidPlanError(reasons);
  const removed = current.modules.filter((m) => !next.modules.includes(m));
  if (removed.length > 0 && (await hasLiveSubscribers(current.id))) {
    throw new PlanInUseError(current.id, removed);
  }
  await repo.save(next);
  return next;
}

export async function retirePlan(cmd: { readonly id: string; readonly now: string }, repo: PlanRepository): Promise<Plan> {
  const current = await repo.findById(cmd.id);
  if (!current) throw new PlanNotFoundError(cmd.id);
  if (current.status === "retired") return current;
  const next: Plan = { ...current, status: "retired" };
  await repo.save(next);
  return next;
}
```

Add to `packages/domain/src/platform/index.ts`:

```ts
export {
  createPlan, updatePlan, retirePlan, dedupeModules,
  type Plan, type PlanStatus, type PlanRepository,
  type CreatePlanCommand, type UpdatePlanCommand, type HasLiveSubscribers,
} from "./plan.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/domain/src/platform/plan.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/platform
git commit -m "feat(platform): the plan catalog, priced in Money and bounded by the module catalog"
```

---

### Task 5: Subscription model and use-cases

**Files:**
- Create: `packages/domain/src/platform/subscription.ts`
- Create: `packages/domain/src/platform/subscription.test.ts`
- Modify: `packages/domain/src/platform/index.ts`

Period arithmetic: `addPeriod(startIso, cycle)` adds one calendar month or one calendar year in UTC using `Date.UTC`. A month added to 31 January lands on the last day of February (clamp), matching how billing providers roll periods.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/platform/subscription.test.ts
import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import type { Plan, PlanRepository } from "./plan.js";
import {
  addPeriod, startSubscription, renewSubscription, changePlan, markPastDue,
  suspendSubscription, resumeSubscription, cancelSubscription,
  type Subscription, type SubscriptionRepository,
} from "./subscription.js";
import {
  InvalidSubscriptionError, InvalidSubscriptionTransitionError, PlanNotFoundError,
  PlanRetiredError, SubscriptionNotFoundError, TenantAlreadySubscribedError,
} from "./errors.js";

const NOW = "2026-01-31T10:00:00.000Z";

function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: ["accounting", "sales"], features: {},
    seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
    priceMonthly: Money.fromMajor("490"), priceYearly: Money.fromMajor("4900"),
    trialDays: 14, isPublic: true, sortOrder: 1, status: "active", createdAt: NOW, ...overrides,
  };
}

function plans(...items: Plan[]): PlanRepository {
  const rows = new Map(items.map((p) => [p.id, p]));
  return {
    async findById(id) { return rows.get(id) ?? null; },
    async findByCode(code) { return [...rows.values()].find((p) => p.code === code) ?? null; },
    async list() { return [...rows.values()]; },
    async save(p) { rows.set(p.id, p); },
  };
}

function subs(): SubscriptionRepository & { rows: Map<string, Subscription> } {
  const rows = new Map<string, Subscription>();
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async findLiveByTenant(tenantId) {
      return [...rows.values()].find((s) => s.tenantId === tenantId && s.status !== "cancelled") ?? null;
    },
    async listByTenant(tenantId) { return [...rows.values()].filter((s) => s.tenantId === tenantId); },
    async hasLiveByPlan(planId) {
      return [...rows.values()].some((s) => s.planId === planId && s.status !== "cancelled");
    },
    async save(s) { rows.set(s.id, s); },
  };
}

describe("addPeriod", () => {
  it("adds a calendar month, clamping to the last day", () => {
    expect(addPeriod("2026-01-31T10:00:00.000Z", "monthly")).toBe("2026-02-28T10:00:00.000Z");
    expect(addPeriod("2026-03-15T00:00:00.000Z", "monthly")).toBe("2026-04-15T00:00:00.000Z");
  });
  it("adds a calendar year, clamping 29 February", () => {
    expect(addPeriod("2028-02-29T00:00:00.000Z", "yearly")).toBe("2029-02-28T00:00:00.000Z");
    expect(addPeriod("2026-09-13T00:00:00.000Z", "yearly")).toBe("2027-09-13T00:00:00.000Z");
  });
});

const base = { id: "S1", tenantId: "T1", planId: "P1", billingCycle: "monthly" as const, now: NOW };

describe("startSubscription", () => {
  it("starts a trial when asked and the plan allows one", async () => {
    const repo = subs();
    const s = await startSubscription({ ...base, trial: true }, repo, plans(plan()));
    expect(s).toMatchObject({
      status: "trialing", planId: "P1", billingCycle: "monthly", addOnModules: [], extraSeats: 0,
      extraBranches: 0, extraWarehouses: 0, currentPeriodStart: NOW,
      currentPeriodEnd: "2026-02-28T10:00:00.000Z", trialEndsAt: "2026-02-14T10:00:00.000Z",
      graceDays: 7, cancelledAt: null, createdAt: NOW, updatedAt: NOW,
    });
  });

  it("starts active when not a trial, or when the plan has no trial days", async () => {
    expect((await startSubscription(base, subs(), plans(plan()))).status).toBe("active");
    const s = await startSubscription({ ...base, trial: true }, subs(), plans(plan({ trialDays: 0 })));
    expect(s.status).toBe("active");
    expect(s.trialEndsAt).toBeNull();
  });

  it("carries add-ons, extra capacity and a yearly period", async () => {
    const s = await startSubscription(
      { ...base, billingCycle: "yearly", addOnModules: ["hr", "hr"], extraSeats: 2, extraBranches: 1, extraWarehouses: 3, graceDays: 10 },
      subs(), plans(plan()),
    );
    expect(s.addOnModules).toEqual(["hr"]);
    expect(s.extraSeats).toBe(2);
    expect(s.graceDays).toBe(10);
    expect(s.currentPeriodEnd).toBe("2027-01-31T10:00:00.000Z");
  });

  it("refuses an unknown add-on and negative capacity", async () => {
    await expect(startSubscription({ ...base, addOnModules: ["pos"] }, subs(), plans(plan()))).rejects.toThrow(InvalidSubscriptionError);
    await expect(startSubscription({ ...base, extraSeats: -1 }, subs(), plans(plan()))).rejects.toThrow(InvalidSubscriptionError);
  });

  it("refuses a missing or retired plan", async () => {
    await expect(startSubscription(base, subs(), plans())).rejects.toThrow(PlanNotFoundError);
    await expect(startSubscription(base, subs(), plans(plan({ status: "retired" })))).rejects.toThrow(PlanRetiredError);
  });

  it("refuses a second live subscription for the same tenant, but allows one after cancellation", async () => {
    const repo = subs();
    await startSubscription(base, repo, plans(plan()));
    await expect(startSubscription({ ...base, id: "S2" }, repo, plans(plan()))).rejects.toThrow(TenantAlreadySubscribedError);
    await cancelSubscription({ id: "S1", now: NOW }, repo);
    expect((await startSubscription({ ...base, id: "S2" }, repo, plans(plan()))).id).toBe("S2");
  });
});

describe("lifecycle", () => {
  const LATER = "2026-03-05T00:00:00.000Z";
  async function started(status: Subscription["status"], trial = false) {
    const repo = subs();
    const s = await startSubscription({ ...base, trial }, repo, plans(plan()));
    repo.rows.set(s.id, { ...s, status });
    return repo;
  }

  it("renew: trialing → active and rolls the period from the old end", async () => {
    const repo = await started("trialing", true);
    const s = await renewSubscription({ id: "S1", now: LATER }, repo);
    expect(s.status).toBe("active");
    expect(s.trialEndsAt).toBeNull();
    expect(s.currentPeriodStart).toBe("2026-02-28T10:00:00.000Z");
    expect(s.currentPeriodEnd).toBe("2026-03-28T10:00:00.000Z");
    expect(s.updatedAt).toBe(LATER);
  });

  it("renew: past_due → active; active → active; cancelled refused", async () => {
    expect((await renewSubscription({ id: "S1", now: LATER }, await started("past_due"))).status).toBe("active");
    expect((await renewSubscription({ id: "S1", now: LATER }, await started("active"))).status).toBe("active");
    await expect(renewSubscription({ id: "S1", now: LATER }, await started("cancelled"))).rejects.toThrow(InvalidSubscriptionTransitionError);
    await expect(renewSubscription({ id: "S1", now: LATER }, await started("suspended"))).rejects.toThrow(InvalidSubscriptionTransitionError);
  });

  it("markPastDue only after the period end, only from active", async () => {
    await expect(markPastDue({ id: "S1", now: "2026-02-01T00:00:00.000Z" }, await started("active"))).rejects.toThrow(InvalidSubscriptionError);
    expect((await markPastDue({ id: "S1", now: LATER }, await started("active"))).status).toBe("past_due");
    await expect(markPastDue({ id: "S1", now: LATER }, await started("trialing", true))).rejects.toThrow(InvalidSubscriptionTransitionError);
  });

  it("suspend from active or past_due, resume only from suspended", async () => {
    expect((await suspendSubscription({ id: "S1", now: LATER }, await started("active"))).status).toBe("suspended");
    expect((await suspendSubscription({ id: "S1", now: LATER }, await started("past_due"))).status).toBe("suspended");
    await expect(suspendSubscription({ id: "S1", now: LATER }, await started("trialing", true))).rejects.toThrow(InvalidSubscriptionTransitionError);
    expect((await resumeSubscription({ id: "S1", now: LATER }, await started("suspended"))).status).toBe("active");
    await expect(resumeSubscription({ id: "S1", now: LATER }, await started("active"))).rejects.toThrow(InvalidSubscriptionTransitionError);
  });

  it("cancel from any live state stamps cancelledAt; cancelled is terminal", async () => {
    for (const status of ["trialing", "active", "past_due", "suspended"] as const) {
      const s = await cancelSubscription({ id: "S1", now: LATER }, await started(status));
      expect(s.status).toBe("cancelled");
      expect(s.cancelledAt).toBe(LATER);
    }
    await expect(cancelSubscription({ id: "S1", now: LATER }, await started("cancelled"))).rejects.toThrow(InvalidSubscriptionTransitionError);
  });

  it("changePlan swaps the plan, keeps the period, moves a trial to active, refuses retired", async () => {
    const repo = await started("trialing", true);
    const pro = plan({ id: "P2", code: "business" });
    const s = await changePlan({ id: "S1", planId: "P2", now: LATER }, repo, plans(plan(), pro));
    expect(s.planId).toBe("P2");
    expect(s.status).toBe("active");
    expect(s.trialEndsAt).toBeNull();
    expect(s.currentPeriodEnd).toBe("2026-02-28T10:00:00.000Z");
    await expect(changePlan({ id: "S1", planId: "P3", now: LATER }, repo, plans(plan(), pro))).rejects.toThrow(PlanNotFoundError);
    await expect(changePlan({ id: "S1", planId: "P2", now: LATER }, repo, plans(plan(), { ...pro, status: "retired" }))).rejects.toThrow(PlanRetiredError);
  });

  it("reports a missing subscription", async () => {
    await expect(renewSubscription({ id: "nope", now: LATER }, subs())).rejects.toThrow(SubscriptionNotFoundError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/domain/src/platform/subscription.test.ts`
Expected: FAIL, cannot resolve `./subscription.js`.

- [ ] **Step 3: Write the model and use-cases**

```ts
// packages/domain/src/platform/subscription.ts
import { isKnownModule } from "./module-catalog.js";
import { dedupeModules, type PlanRepository } from "./plan.js";
import {
  InvalidSubscriptionError,
  InvalidSubscriptionTransitionError,
  PlanNotFoundError,
  PlanRetiredError,
  SubscriptionNotFoundError,
  TenantAlreadySubscribedError,
} from "./errors.js";

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "suspended" | "cancelled";
export type BillingCycle = "monthly" | "yearly";

export interface Subscription {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly status: SubscriptionStatus;
  readonly billingCycle: BillingCycle;
  readonly addOnModules: readonly string[];
  readonly extraSeats: number;
  readonly extraBranches: number;
  readonly extraWarehouses: number;
  readonly currentPeriodStart: string;
  readonly currentPeriodEnd: string;
  readonly trialEndsAt: string | null;
  readonly graceDays: number;
  readonly cancelledAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SubscriptionRepository {
  findById(id: string): Promise<Subscription | null>;
  findLiveByTenant(tenantId: string): Promise<Subscription | null>;
  listByTenant(tenantId: string): Promise<Subscription[]>;
  hasLiveByPlan(planId: string): Promise<boolean>;
  save(subscription: Subscription): Promise<void>;
}

export const DEFAULT_GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

export function addPeriod(startIso: string, cycle: BillingCycle): string {
  const d = new Date(startIso);
  const year = d.getUTCFullYear() + (cycle === "yearly" ? 1 : 0);
  const month = d.getUTCMonth() + (cycle === "monthly" ? 1 : 0);
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).toISOString();
}

export function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

export interface StartSubscriptionCommand {
  readonly id: string;
  readonly tenantId: string;
  readonly planId: string;
  readonly billingCycle: BillingCycle;
  readonly trial?: boolean;
  readonly addOnModules?: readonly string[];
  readonly extraSeats?: number;
  readonly extraBranches?: number;
  readonly extraWarehouses?: number;
  readonly graceDays?: number;
  readonly now: string;
}

function isCount(n: number, min: number): boolean {
  return Number.isInteger(n) && n >= min;
}

function validateExtras(s: Pick<Subscription, "addOnModules" | "extraSeats" | "extraBranches" | "extraWarehouses" | "graceDays">): string[] {
  const reasons: string[] = [];
  for (const m of s.addOnModules) if (!isKnownModule(m)) reasons.push(`unknown add-on module "${m}"`);
  if (!isCount(s.extraSeats, 0)) reasons.push("extraSeats must be an integer of at least 0");
  if (!isCount(s.extraBranches, 0)) reasons.push("extraBranches must be an integer of at least 0");
  if (!isCount(s.extraWarehouses, 0)) reasons.push("extraWarehouses must be an integer of at least 0");
  if (!isCount(s.graceDays, 0)) reasons.push("graceDays must be an integer of at least 0");
  return reasons;
}

async function activePlan(planId: string, plans: PlanRepository) {
  const plan = await plans.findById(planId);
  if (!plan) throw new PlanNotFoundError(planId);
  if (plan.status === "retired") throw new PlanRetiredError(planId);
  return plan;
}

export async function startSubscription(
  cmd: StartSubscriptionCommand,
  repo: SubscriptionRepository,
  plans: PlanRepository,
): Promise<Subscription> {
  if (cmd.id.trim() === "" || cmd.tenantId.trim() === "") {
    throw new InvalidSubscriptionError(["id and tenantId are required"]);
  }
  const plan = await activePlan(cmd.planId, plans);
  if (await repo.findLiveByTenant(cmd.tenantId)) throw new TenantAlreadySubscribedError(cmd.tenantId);
  const trial = cmd.trial === true && plan.trialDays > 0;
  const candidate: Subscription = {
    id: cmd.id,
    tenantId: cmd.tenantId,
    planId: plan.id,
    status: trial ? "trialing" : "active",
    billingCycle: cmd.billingCycle,
    addOnModules: dedupeModules(cmd.addOnModules ?? []),
    extraSeats: cmd.extraSeats ?? 0,
    extraBranches: cmd.extraBranches ?? 0,
    extraWarehouses: cmd.extraWarehouses ?? 0,
    currentPeriodStart: cmd.now,
    currentPeriodEnd: addPeriod(cmd.now, cmd.billingCycle),
    trialEndsAt: trial ? addDays(cmd.now, plan.trialDays) : null,
    graceDays: cmd.graceDays ?? DEFAULT_GRACE_DAYS,
    cancelledAt: null,
    createdAt: cmd.now,
    updatedAt: cmd.now,
  };
  const reasons = validateExtras(candidate);
  if (reasons.length > 0) throw new InvalidSubscriptionError(reasons);
  await repo.save(candidate);
  return candidate;
}

export interface SubscriptionCommand {
  readonly id: string;
  readonly now: string;
}

async function load(id: string, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await repo.findById(id);
  if (!s) throw new SubscriptionNotFoundError(id);
  return s;
}

function assertFrom(s: Subscription, allowed: readonly SubscriptionStatus[], to: SubscriptionStatus): void {
  if (!allowed.includes(s.status)) throw new InvalidSubscriptionTransitionError(s.status, to);
}

export async function renewSubscription(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  assertFrom(s, ["trialing", "active", "past_due"], "active");
  const next: Subscription = {
    ...s,
    status: "active",
    trialEndsAt: null,
    currentPeriodStart: s.currentPeriodEnd,
    currentPeriodEnd: addPeriod(s.currentPeriodEnd, s.billingCycle),
    updatedAt: cmd.now,
  };
  await repo.save(next);
  return next;
}

export async function markPastDue(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  assertFrom(s, ["active"], "past_due");
  if (cmd.now < s.currentPeriodEnd) {
    throw new InvalidSubscriptionError([`period has not ended (ends ${s.currentPeriodEnd})`]);
  }
  const next: Subscription = { ...s, status: "past_due", updatedAt: cmd.now };
  await repo.save(next);
  return next;
}

export async function suspendSubscription(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  assertFrom(s, ["active", "past_due"], "suspended");
  const next: Subscription = { ...s, status: "suspended", updatedAt: cmd.now };
  await repo.save(next);
  return next;
}

export async function resumeSubscription(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  assertFrom(s, ["suspended"], "active");
  const next: Subscription = { ...s, status: "active", updatedAt: cmd.now };
  await repo.save(next);
  return next;
}

export async function cancelSubscription(cmd: SubscriptionCommand, repo: SubscriptionRepository): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  assertFrom(s, ["trialing", "active", "past_due", "suspended"], "cancelled");
  const next: Subscription = { ...s, status: "cancelled", cancelledAt: cmd.now, updatedAt: cmd.now };
  await repo.save(next);
  return next;
}

export interface ChangePlanCommand extends SubscriptionCommand {
  readonly planId: string;
}

export async function changePlan(
  cmd: ChangePlanCommand,
  repo: SubscriptionRepository,
  plans: PlanRepository,
): Promise<Subscription> {
  const s = await load(cmd.id, repo);
  assertFrom(s, ["trialing", "active", "past_due"], s.status === "trialing" ? "active" : s.status);
  const plan = await activePlan(cmd.planId, plans);
  const next: Subscription = {
    ...s,
    planId: plan.id,
    status: s.status === "trialing" ? "active" : s.status,
    trialEndsAt: null,
    updatedAt: cmd.now,
  };
  await repo.save(next);
  return next;
}
```

Add to `packages/domain/src/platform/index.ts`:

```ts
export {
  addPeriod, addDays, DEFAULT_GRACE_DAYS,
  startSubscription, renewSubscription, changePlan, markPastDue,
  suspendSubscription, resumeSubscription, cancelSubscription,
  type Subscription, type SubscriptionStatus, type BillingCycle, type SubscriptionRepository,
  type StartSubscriptionCommand, type SubscriptionCommand, type ChangePlanCommand,
} from "./subscription.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/domain/src/platform/subscription.test.ts`
Expected: PASS, 14 tests. If `addPeriod` for `2026-01-31` monthly yields `2026-03-03`, the clamp is missing: `Date.UTC(year, month + 1, 0)` must be computed before building the result.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/platform
git commit -m "feat(platform): a subscription with one live row per tenant and a five-state lifecycle"
```

---

### Task 6: Derivations — entitlements and licence state

**Files:**
- Create: `packages/domain/src/platform/derive.ts`
- Create: `packages/domain/src/platform/derive.test.ts`
- Modify: `packages/domain/src/platform/index.ts`

`SubscriptionLicenseState` is declared here with exactly the fields of `LicenseStateView` in `packages/api/src/license-gate.ts` (`state, canWrite, usable, licensee?, expiresAt?, graceEndsAt?, reason?`). The domain cannot import from the API package; structural typing makes the two interchangeable at the wiring site.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/platform/derive.test.ts
import { describe, it, expect } from "vitest";
import { Money } from "../money/money.js";
import type { Plan } from "./plan.js";
import type { Subscription } from "./subscription.js";
import type { Tenant } from "./tenant.js";
import { deriveEntitlements, subscriptionLicenseState } from "./derive.js";

const plan: Plan = {
  id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: ["accounting", "sales"],
  features: { "reports.export": true }, seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
  priceMonthly: Money.fromMajor("490"), priceYearly: Money.fromMajor("4900"), trialDays: 14,
  isPublic: true, sortOrder: 1, status: "active", createdAt: "2026-01-01T00:00:00.000Z",
};

const sub: Subscription = {
  id: "S1", tenantId: "T1", planId: "P1", status: "active", billingCycle: "monthly",
  addOnModules: ["hr", "sales"], extraSeats: 2, extraBranches: 0, extraWarehouses: 0,
  currentPeriodStart: "2026-09-01T00:00:00.000Z", currentPeriodEnd: "2026-10-01T00:00:00.000Z",
  trialEndsAt: null, graceDays: 7, cancelledAt: null,
  createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

const tenant: Tenant = {
  id: "T1", code: "cyag", nameAr: "سياج", nameEn: "Cyag", ownerEmail: "o@cyag.eg", status: "active",
  dbFile: "tenants/cyag.db", createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("deriveEntitlements", () => {
  it("unions modules, sums seats, passes features, expires at period end", () => {
    expect(deriveEntitlements(plan, sub)).toEqual({
      plan: "core", activeModules: ["accounting", "sales", "hr"], features: { "reports.export": true },
      seats: 5, expiresAt: "2026-10-01T00:00:00.000Z",
    });
  });

  it("expires at the trial end while trialing", () => {
    const trial = { ...sub, status: "trialing" as const, trialEndsAt: "2026-09-15T00:00:00.000Z" };
    expect(deriveEntitlements(plan, trial).expiresAt).toBe("2026-09-15T00:00:00.000Z");
  });
});

describe("subscriptionLicenseState", () => {
  const at = (now: string, s: Subscription | null = sub, t: Tenant = tenant) => subscriptionLicenseState(t, s, now);

  it("archived tenant is INVALID and unusable", () => {
    expect(at("2026-09-13T00:00:00.000Z", sub, { ...tenant, status: "archived" })).toMatchObject({ state: "INVALID", canWrite: false, usable: false });
  });

  it("provisioning tenant or no subscription is UNLICENSED, readable", () => {
    expect(at("2026-09-13T00:00:00.000Z", sub, { ...tenant, status: "provisioning" })).toMatchObject({ state: "UNLICENSED", canWrite: false, usable: true });
    expect(at("2026-09-13T00:00:00.000Z", null)).toMatchObject({ state: "UNLICENSED", canWrite: false, usable: true });
  });

  it("suspended tenant, suspended or cancelled subscription are READ_ONLY", () => {
    expect(at("2026-09-13T00:00:00.000Z", sub, { ...tenant, status: "suspended" })).toMatchObject({ state: "READ_ONLY", canWrite: false, usable: true });
    expect(at("2026-09-13T00:00:00.000Z", { ...sub, status: "suspended" })).toMatchObject({ state: "READ_ONLY" });
    expect(at("2026-09-13T00:00:00.000Z", { ...sub, status: "cancelled" })).toMatchObject({ state: "READ_ONLY" });
  });

  it("trial: ACTIVE before its end, READ_ONLY after, no grace", () => {
    const trial = { ...sub, status: "trialing" as const, trialEndsAt: "2026-09-15T00:00:00.000Z" };
    expect(at("2026-09-14T23:59:59.000Z", trial)).toMatchObject({ state: "ACTIVE", canWrite: true, expiresAt: "2026-09-15T00:00:00.000Z" });
    expect(at("2026-09-15T00:00:00.000Z", trial)).toMatchObject({ state: "READ_ONLY", canWrite: false });
  });

  it("active or past_due: ACTIVE in period, GRACE for graceDays after, then READ_ONLY", () => {
    expect(at("2026-09-30T23:59:59.000Z")).toMatchObject({ state: "ACTIVE", canWrite: true, licensee: "سياج" });
    expect(at("2026-10-01T00:00:00.000Z")).toMatchObject({ state: "GRACE", canWrite: true, graceEndsAt: "2026-10-08T00:00:00.000Z" });
    expect(at("2026-10-07T23:59:59.000Z", { ...sub, status: "past_due" })).toMatchObject({ state: "GRACE", canWrite: true });
    expect(at("2026-10-08T00:00:00.000Z")).toMatchObject({ state: "READ_ONLY", canWrite: false, usable: true });
  });

  it("every non-writable result carries a reason", () => {
    for (const r of [
      at("2026-09-13T00:00:00.000Z", sub, { ...tenant, status: "archived" }),
      at("2026-09-13T00:00:00.000Z", null),
      at("2026-09-13T00:00:00.000Z", { ...sub, status: "cancelled" }),
      at("2026-10-08T00:00:00.000Z"),
    ]) {
      expect(r.canWrite).toBe(false);
      expect(typeof r.reason).toBe("string");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/domain/src/platform/derive.test.ts`
Expected: FAIL, cannot resolve `./derive.js`.

- [ ] **Step 3: Write the derivations**

```ts
// packages/domain/src/platform/derive.ts
import type { Entitlements } from "../entitlements/entitlements.js";
import { dedupeModules, type Plan } from "./plan.js";
import { addDays, type Subscription } from "./subscription.js";
import type { Tenant } from "./tenant.js";

export function subscriptionExpiresAt(s: Subscription): string {
  return s.status === "trialing" && s.trialEndsAt ? s.trialEndsAt : s.currentPeriodEnd;
}

export function deriveEntitlements(plan: Plan, subscription: Subscription): Entitlements {
  return {
    plan: plan.code,
    activeModules: dedupeModules([...plan.modules, ...subscription.addOnModules]),
    features: { ...plan.features },
    seats: plan.seatsIncluded + subscription.extraSeats,
    expiresAt: subscriptionExpiresAt(subscription),
  };
}

export type SubscriptionLicenseStateName = "ACTIVE" | "GRACE" | "READ_ONLY" | "INVALID" | "UNLICENSED";

export interface SubscriptionLicenseState {
  readonly state: SubscriptionLicenseStateName;
  readonly canWrite: boolean;
  readonly usable: boolean;
  readonly licensee?: string;
  readonly expiresAt?: string;
  readonly graceEndsAt?: string;
  readonly reason?: string;
}

export function subscriptionLicenseState(
  tenant: Tenant,
  subscription: Subscription | null,
  now: string,
): SubscriptionLicenseState {
  const licensee = tenant.nameAr;
  if (tenant.status === "archived") {
    return { state: "INVALID", canWrite: false, usable: false, licensee, reason: "TENANT_ARCHIVED" };
  }
  if (tenant.status === "provisioning" || !subscription) {
    return { state: "UNLICENSED", canWrite: false, usable: true, licensee, reason: "NO_SUBSCRIPTION" };
  }
  const expiresAt = subscriptionExpiresAt(subscription);
  if (tenant.status === "suspended") {
    return { state: "READ_ONLY", canWrite: false, usable: true, licensee, expiresAt, reason: "TENANT_SUSPENDED" };
  }
  if (subscription.status === "cancelled" || subscription.status === "suspended") {
    return { state: "READ_ONLY", canWrite: false, usable: true, licensee, expiresAt, reason: `SUBSCRIPTION_${subscription.status.toUpperCase()}` };
  }
  if (subscription.status === "trialing") {
    return now < expiresAt
      ? { state: "ACTIVE", canWrite: true, usable: true, licensee, expiresAt }
      : { state: "READ_ONLY", canWrite: false, usable: true, licensee, expiresAt, reason: "TRIAL_ENDED" };
  }
  if (now < subscription.currentPeriodEnd) {
    return { state: "ACTIVE", canWrite: true, usable: true, licensee, expiresAt };
  }
  const graceEndsAt = addDays(subscription.currentPeriodEnd, subscription.graceDays);
  if (now < graceEndsAt) {
    return { state: "GRACE", canWrite: true, usable: true, licensee, expiresAt, graceEndsAt };
  }
  return { state: "READ_ONLY", canWrite: false, usable: true, licensee, expiresAt, graceEndsAt, reason: "GRACE_ENDED" };
}
```

Add to `packages/domain/src/platform/index.ts`:

```ts
export {
  deriveEntitlements, subscriptionLicenseState, subscriptionExpiresAt,
  type SubscriptionLicenseState, type SubscriptionLicenseStateName,
} from "./derive.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/domain/src/platform/derive.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/platform
git commit -m "feat(platform): a subscription derives the entitlements and licence state the gates already read"
```

---

### Task 7: Platform user model

**Files:**
- Create: `packages/domain/src/platform/platform-user.ts`
- Create: `packages/domain/src/platform/platform-user.test.ts`
- Modify: `packages/domain/src/platform/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/platform/platform-user.test.ts
import { describe, it, expect } from "vitest";
import { createPlatformUser, type PlatformUser, type PlatformUserRepository } from "./platform-user.js";
import { InvalidPlatformUserError, PlatformUserEmailTakenError } from "./errors.js";
import type { SecretHasher } from "../users/user.js";

const hasher: SecretHasher = {
  async hash(secret) { return `hashed:${secret}`; },
  async verify(secret, hash) { return hash === `hashed:${secret}`; },
};

function memoryRepo(): PlatformUserRepository & { rows: Map<string, PlatformUser> } {
  const rows = new Map<string, PlatformUser>();
  return {
    rows,
    async findById(id) { return rows.get(id) ?? null; },
    async findByEmail(email) { return [...rows.values()].find((u) => u.email === email) ?? null; },
    async list() { return [...rows.values()]; },
    async save(u) { rows.set(u.id, u); },
  };
}

const NOW = "2026-09-13T10:00:00.000Z";
const cmd = { id: "U1", email: " Root@Mezan.APP ", password: "correct horse", role: "owner" as const, now: NOW };

describe("createPlatformUser", () => {
  it("normalises the email, hashes the password, starts active", async () => {
    const repo = memoryRepo();
    const u = await createPlatformUser(cmd, repo, hasher);
    expect(u).toEqual({ id: "U1", email: "root@mezan.app", passwordHash: "hashed:correct horse", role: "owner", status: "active", createdAt: NOW });
    expect(repo.rows.get("U1")).toEqual(u);
  });

  it("refuses an empty email, a short password and a duplicate email", async () => {
    await expect(createPlatformUser({ ...cmd, email: " " }, memoryRepo(), hasher)).rejects.toThrow(InvalidPlatformUserError);
    await expect(createPlatformUser({ ...cmd, password: "short" }, memoryRepo(), hasher)).rejects.toThrow(InvalidPlatformUserError);
    const repo = memoryRepo();
    await createPlatformUser(cmd, repo, hasher);
    await expect(createPlatformUser({ ...cmd, id: "U2", email: "ROOT@mezan.app" }, repo, hasher)).rejects.toThrow(PlatformUserEmailTakenError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/domain/src/platform/platform-user.test.ts`
Expected: FAIL, cannot resolve `./platform-user.js`.

- [ ] **Step 3: Write the model**

```ts
// packages/domain/src/platform/platform-user.ts
import type { SecretHasher } from "../users/user.js";
import { normalizeEmail } from "../users/save-user.js";
import { InvalidPlatformUserError, PlatformUserEmailTakenError } from "./errors.js";

export type PlatformRole = "owner" | "support";
export type PlatformUserStatus = "active" | "inactive";

export interface PlatformUser {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: PlatformRole;
  readonly status: PlatformUserStatus;
  readonly createdAt: string;
}

export interface PlatformUserRepository {
  findById(id: string): Promise<PlatformUser | null>;
  findByEmail(email: string): Promise<PlatformUser | null>;
  list(): Promise<PlatformUser[]>;
  save(user: PlatformUser): Promise<void>;
}

export interface CreatePlatformUserCommand {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly role: PlatformRole;
  readonly now: string;
}

export const MIN_PLATFORM_PASSWORD_LENGTH = 12;

export async function createPlatformUser(
  cmd: CreatePlatformUserCommand,
  repo: PlatformUserRepository,
  hasher: SecretHasher,
): Promise<PlatformUser> {
  const email = normalizeEmail(cmd.email);
  const reasons: string[] = [];
  if (cmd.id.trim() === "") reasons.push("id is required");
  if (email === "") reasons.push("email is required");
  if (cmd.password.length < MIN_PLATFORM_PASSWORD_LENGTH) {
    reasons.push(`password must be at least ${MIN_PLATFORM_PASSWORD_LENGTH} characters`);
  }
  if (reasons.length > 0) throw new InvalidPlatformUserError(reasons);
  if (await repo.findByEmail(email)) throw new PlatformUserEmailTakenError(email);
  const user: PlatformUser = {
    id: cmd.id,
    email,
    passwordHash: await hasher.hash(cmd.password),
    role: cmd.role,
    status: "active",
    createdAt: cmd.now,
  };
  await repo.save(user);
  return user;
}
```

Add to `packages/domain/src/platform/index.ts`:

```ts
export {
  createPlatformUser, MIN_PLATFORM_PASSWORD_LENGTH,
  type PlatformUser, type PlatformRole, type PlatformUserStatus,
  type PlatformUserRepository, type CreatePlatformUserCommand,
} from "./platform-user.js";
```

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm test -- packages/domain/src/platform && pnpm typecheck`
Expected: PASS for every platform test, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/platform
git commit -m "feat(platform): the platform operator account, hashed through the existing SecretHasher port"
```

---

### Task 8: SQLite platform stores

**Files:**
- Create: `packages/persistence/src/platform-store.ts`
- Create: `packages/persistence/src/platform-store.test.ts`
- Modify: `packages/persistence/src/index.ts` (append export)

Read `packages/persistence/src/api-key-store.ts` and `sqlite-connection.ts` first. Follow the same shape: `CREATE TABLE IF NOT EXISTS`, prepared statements built in the constructor, upsert by id.

- [ ] **Step 1: Write the failing test**

```ts
// packages/persistence/src/platform-store.test.ts
import { describe, it, expect } from "vitest";
import { Money, type Plan, type Subscription, type Tenant, type PlatformUser } from "@mezan/domain";
import { createSqlitePlatformStores } from "./platform-store.js";

const NOW = "2026-09-13T10:00:00.000Z";

const tenant: Tenant = {
  id: "T1", code: "cyag", nameAr: "سياج", nameEn: null, ownerEmail: "o@cyag.eg", status: "provisioning",
  dbFile: "tenants/cyag.db", createdAt: NOW, updatedAt: NOW,
};
const plan: Plan = {
  id: "P1", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: ["accounting", "sales"],
  features: { "reports.export": true }, seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
  priceMonthly: Money.fromMajor("490.50"), priceYearly: Money.fromMajor("4900"), trialDays: 14,
  isPublic: true, sortOrder: 1, status: "active", createdAt: NOW,
};
const sub: Subscription = {
  id: "S1", tenantId: "T1", planId: "P1", status: "active", billingCycle: "monthly", addOnModules: ["hr"],
  extraSeats: 2, extraBranches: 0, extraWarehouses: 0, currentPeriodStart: NOW,
  currentPeriodEnd: "2026-10-13T10:00:00.000Z", trialEndsAt: null, graceDays: 7, cancelledAt: null,
  createdAt: NOW, updatedAt: NOW,
};
const user: PlatformUser = { id: "U1", email: "root@mezan.app", passwordHash: "h", role: "owner", status: "active", createdAt: NOW };

describe("createSqlitePlatformStores", () => {
  it("round-trips every model, Money included, and finds by code and email", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant);
    await stores.plans.save(plan);
    await stores.subscriptions.save(sub);
    await stores.platformUsers.save(user);

    expect(await stores.tenants.findById("T1")).toEqual(tenant);
    expect(await stores.tenants.findByCode("cyag")).toEqual(tenant);
    expect(await stores.tenants.list()).toEqual([tenant]);

    const p = await stores.plans.findByCode("core");
    expect(p).toEqual(plan);
    expect(p?.priceMonthly.equals(Money.fromMajor("490.50"))).toBe(true);
    expect(await stores.plans.list()).toEqual([plan]);

    expect(await stores.subscriptions.findById("S1")).toEqual(sub);
    expect(await stores.subscriptions.findLiveByTenant("T1")).toEqual(sub);
    expect(await stores.subscriptions.listByTenant("T1")).toEqual([sub]);
    expect(await stores.subscriptions.hasLiveByPlan("P1")).toBe(true);
    expect(await stores.subscriptions.hasLiveByPlan("P9")).toBe(false);

    expect(await stores.platformUsers.findByEmail("root@mezan.app")).toEqual(user);
    stores.close();
  });

  it("upserts by id and treats cancelled subscriptions as not live", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant);
    await stores.tenants.save({ ...tenant, status: "active" });
    expect((await stores.tenants.list()).map((t) => t.status)).toEqual(["active"]);

    await stores.subscriptions.save({ ...sub, status: "cancelled", cancelledAt: NOW });
    expect(await stores.subscriptions.findLiveByTenant("T1")).toBeNull();
    expect(await stores.subscriptions.hasLiveByPlan("P1")).toBe(false);
    expect(await stores.subscriptions.listByTenant("T1")).toHaveLength(1);
    stores.close();
  });

  it("refuses a second live subscription for one tenant at the database", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.subscriptions.save(sub);
    await expect(stores.subscriptions.save({ ...sub, id: "S2" })).rejects.toThrow(/UNIQUE/);
    await stores.subscriptions.save({ ...sub, id: "S2", status: "cancelled", cancelledAt: NOW });
    expect(await stores.subscriptions.listByTenant("T1")).toHaveLength(2);
    stores.close();
  });

  it("refuses duplicate tenant codes, plan codes and platform emails", async () => {
    const stores = createSqlitePlatformStores(":memory:");
    await stores.tenants.save(tenant);
    await expect(stores.tenants.save({ ...tenant, id: "T2" })).rejects.toThrow(/UNIQUE/);
    await stores.plans.save(plan);
    await expect(stores.plans.save({ ...plan, id: "P2" })).rejects.toThrow(/UNIQUE/);
    await stores.platformUsers.save(user);
    await expect(stores.platformUsers.save({ ...user, id: "U2" })).rejects.toThrow(/UNIQUE/);
    stores.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/persistence/src/platform-store.test.ts`
Expected: FAIL, cannot resolve `./platform-store.js`.

- [ ] **Step 3: Write the stores**

```ts
// packages/persistence/src/platform-store.ts
import Database from "better-sqlite3";
import { openSqliteConnection, type SqliteConnectionInput } from "./sqlite-connection.js";
import {
  Money,
  type Plan, type PlanRepository,
  type PlatformUser, type PlatformUserRepository,
  type Subscription, type SubscriptionRepository,
  type Tenant, type TenantRepository,
} from "@mezan/domain";

const CREATE_TABLES = `
CREATE TABLE IF NOT EXISTS tenant (
  id           TEXT PRIMARY KEY,
  code         TEXT NOT NULL,
  name_ar      TEXT NOT NULL,
  name_en      TEXT,
  owner_email  TEXT NOT NULL,
  status       TEXT NOT NULL,
  db_file      TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_code ON tenant(code);

CREATE TABLE IF NOT EXISTS plan (
  id                   TEXT PRIMARY KEY,
  code                 TEXT NOT NULL,
  name_ar              TEXT NOT NULL,
  name_en              TEXT NOT NULL,
  modules              TEXT NOT NULL,
  features             TEXT NOT NULL,
  seats_included       INTEGER NOT NULL,
  branches_included    INTEGER NOT NULL,
  warehouses_included  INTEGER NOT NULL,
  price_monthly        INTEGER NOT NULL,
  price_yearly         INTEGER NOT NULL,
  trial_days           INTEGER NOT NULL,
  is_public            INTEGER NOT NULL,
  sort_order           INTEGER NOT NULL,
  status               TEXT NOT NULL,
  created_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_plan_code ON plan(code);

CREATE TABLE IF NOT EXISTS subscription (
  id                    TEXT PRIMARY KEY,
  tenant_id             TEXT NOT NULL,
  plan_id               TEXT NOT NULL,
  status                TEXT NOT NULL,
  billing_cycle         TEXT NOT NULL,
  add_on_modules        TEXT NOT NULL,
  extra_seats           INTEGER NOT NULL,
  extra_branches        INTEGER NOT NULL,
  extra_warehouses      INTEGER NOT NULL,
  current_period_start  TEXT NOT NULL,
  current_period_end    TEXT NOT NULL,
  trial_ends_at         TEXT,
  grace_days            INTEGER NOT NULL,
  cancelled_at          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_tenant ON subscription(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subscription_plan ON subscription(plan_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_one_live
  ON subscription(tenant_id) WHERE status <> 'cancelled';

CREATE TABLE IF NOT EXISTS platform_user (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL,
  status         TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_platform_user_email ON platform_user(email);
`;

interface TenantRow {
  id: string; code: string; name_ar: string; name_en: string | null; owner_email: string;
  status: Tenant["status"]; db_file: string; created_at: string; updated_at: string;
}

function toTenant(r: TenantRow): Tenant {
  return {
    id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en, ownerEmail: r.owner_email,
    status: r.status, dbFile: r.db_file, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

class SqliteTenantStore implements TenantRepository {
  private readonly upsert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly byCode: Database.Statement;
  private readonly all: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO tenant (id, code, name_ar, name_en, owner_email, status, db_file, created_at, updated_at)
       VALUES (@id, @code, @nameAr, @nameEn, @ownerEmail, @status, @dbFile, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, name_en = @nameEn, owner_email = @ownerEmail,
         status = @status, db_file = @dbFile, created_at = @createdAt, updated_at = @updatedAt`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM tenant WHERE id = ?`);
    this.byCode = sqlite.prepare(`SELECT * FROM tenant WHERE code = ?`);
    this.all = sqlite.prepare(`SELECT * FROM tenant ORDER BY created_at, id`);
  }

  async findById(id: string): Promise<Tenant | null> {
    const row = this.byId.get(id) as TenantRow | undefined;
    return row ? toTenant(row) : null;
  }

  async findByCode(code: string): Promise<Tenant | null> {
    const row = this.byCode.get(code) as TenantRow | undefined;
    return row ? toTenant(row) : null;
  }

  async list(): Promise<Tenant[]> {
    return (this.all.all() as TenantRow[]).map(toTenant);
  }

  async save(t: Tenant): Promise<void> {
    this.upsert.run({ ...t });
  }
}

interface PlanRow {
  id: string; code: string; name_ar: string; name_en: string; modules: string; features: string;
  seats_included: number; branches_included: number; warehouses_included: number;
  price_monthly: number; price_yearly: number; trial_days: number; is_public: number;
  sort_order: number; status: Plan["status"]; created_at: string;
}

function toPlan(r: PlanRow): Plan {
  return {
    id: r.id, code: r.code, nameAr: r.name_ar, nameEn: r.name_en,
    modules: JSON.parse(r.modules) as string[],
    features: JSON.parse(r.features) as Record<string, boolean>,
    seatsIncluded: r.seats_included, branchesIncluded: r.branches_included, warehousesIncluded: r.warehouses_included,
    priceMonthly: Money.fromScaled(r.price_monthly), priceYearly: Money.fromScaled(r.price_yearly),
    trialDays: r.trial_days, isPublic: r.is_public === 1, sortOrder: r.sort_order,
    status: r.status, createdAt: r.created_at,
  };
}

class SqlitePlanStore implements PlanRepository {
  private readonly upsert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly byCode: Database.Statement;
  private readonly all: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO plan (id, code, name_ar, name_en, modules, features, seats_included, branches_included,
         warehouses_included, price_monthly, price_yearly, trial_days, is_public, sort_order, status, created_at)
       VALUES (@id, @code, @nameAr, @nameEn, @modules, @features, @seatsIncluded, @branchesIncluded,
         @warehousesIncluded, @priceMonthly, @priceYearly, @trialDays, @isPublic, @sortOrder, @status, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         code = @code, name_ar = @nameAr, name_en = @nameEn, modules = @modules, features = @features,
         seats_included = @seatsIncluded, branches_included = @branchesIncluded, warehouses_included = @warehousesIncluded,
         price_monthly = @priceMonthly, price_yearly = @priceYearly, trial_days = @trialDays, is_public = @isPublic,
         sort_order = @sortOrder, status = @status, created_at = @createdAt`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM plan WHERE id = ?`);
    this.byCode = sqlite.prepare(`SELECT * FROM plan WHERE code = ?`);
    this.all = sqlite.prepare(`SELECT * FROM plan ORDER BY sort_order, code`);
  }

  async findById(id: string): Promise<Plan | null> {
    const row = this.byId.get(id) as PlanRow | undefined;
    return row ? toPlan(row) : null;
  }

  async findByCode(code: string): Promise<Plan | null> {
    const row = this.byCode.get(code) as PlanRow | undefined;
    return row ? toPlan(row) : null;
  }

  async list(): Promise<Plan[]> {
    return (this.all.all() as PlanRow[]).map(toPlan);
  }

  async save(p: Plan): Promise<void> {
    this.upsert.run({
      id: p.id, code: p.code, nameAr: p.nameAr, nameEn: p.nameEn,
      modules: JSON.stringify(p.modules), features: JSON.stringify(p.features),
      seatsIncluded: p.seatsIncluded, branchesIncluded: p.branchesIncluded, warehousesIncluded: p.warehousesIncluded,
      priceMonthly: p.priceMonthly.toScaledNumber(), priceYearly: p.priceYearly.toScaledNumber(),
      trialDays: p.trialDays, isPublic: p.isPublic ? 1 : 0, sortOrder: p.sortOrder,
      status: p.status, createdAt: p.createdAt,
    });
  }
}

interface SubscriptionRow {
  id: string; tenant_id: string; plan_id: string; status: Subscription["status"];
  billing_cycle: Subscription["billingCycle"]; add_on_modules: string;
  extra_seats: number; extra_branches: number; extra_warehouses: number;
  current_period_start: string; current_period_end: string; trial_ends_at: string | null;
  grace_days: number; cancelled_at: string | null; created_at: string; updated_at: string;
}

function toSubscription(r: SubscriptionRow): Subscription {
  return {
    id: r.id, tenantId: r.tenant_id, planId: r.plan_id, status: r.status, billingCycle: r.billing_cycle,
    addOnModules: JSON.parse(r.add_on_modules) as string[],
    extraSeats: r.extra_seats, extraBranches: r.extra_branches, extraWarehouses: r.extra_warehouses,
    currentPeriodStart: r.current_period_start, currentPeriodEnd: r.current_period_end,
    trialEndsAt: r.trial_ends_at, graceDays: r.grace_days, cancelledAt: r.cancelled_at,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

class SqliteSubscriptionStore implements SubscriptionRepository {
  private readonly upsert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly liveByTenant: Database.Statement;
  private readonly byTenant: Database.Statement;
  private readonly liveByPlan: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO subscription (id, tenant_id, plan_id, status, billing_cycle, add_on_modules, extra_seats,
         extra_branches, extra_warehouses, current_period_start, current_period_end, trial_ends_at, grace_days,
         cancelled_at, created_at, updated_at)
       VALUES (@id, @tenantId, @planId, @status, @billingCycle, @addOnModules, @extraSeats, @extraBranches,
         @extraWarehouses, @currentPeriodStart, @currentPeriodEnd, @trialEndsAt, @graceDays, @cancelledAt,
         @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         tenant_id = @tenantId, plan_id = @planId, status = @status, billing_cycle = @billingCycle,
         add_on_modules = @addOnModules, extra_seats = @extraSeats, extra_branches = @extraBranches,
         extra_warehouses = @extraWarehouses, current_period_start = @currentPeriodStart,
         current_period_end = @currentPeriodEnd, trial_ends_at = @trialEndsAt, grace_days = @graceDays,
         cancelled_at = @cancelledAt, created_at = @createdAt, updated_at = @updatedAt`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM subscription WHERE id = ?`);
    this.liveByTenant = sqlite.prepare(`SELECT * FROM subscription WHERE tenant_id = ? AND status <> 'cancelled'`);
    this.byTenant = sqlite.prepare(`SELECT * FROM subscription WHERE tenant_id = ? ORDER BY created_at, id`);
    this.liveByPlan = sqlite.prepare(`SELECT 1 FROM subscription WHERE plan_id = ? AND status <> 'cancelled' LIMIT 1`);
  }

  async findById(id: string): Promise<Subscription | null> {
    const row = this.byId.get(id) as SubscriptionRow | undefined;
    return row ? toSubscription(row) : null;
  }

  async findLiveByTenant(tenantId: string): Promise<Subscription | null> {
    const row = this.liveByTenant.get(tenantId) as SubscriptionRow | undefined;
    return row ? toSubscription(row) : null;
  }

  async listByTenant(tenantId: string): Promise<Subscription[]> {
    return (this.byTenant.all(tenantId) as SubscriptionRow[]).map(toSubscription);
  }

  async hasLiveByPlan(planId: string): Promise<boolean> {
    return this.liveByPlan.get(planId) !== undefined;
  }

  async save(s: Subscription): Promise<void> {
    this.upsert.run({ ...s, addOnModules: JSON.stringify(s.addOnModules) });
  }
}

interface PlatformUserRow {
  id: string; email: string; password_hash: string; role: PlatformUser["role"];
  status: PlatformUser["status"]; created_at: string;
}

function toPlatformUser(r: PlatformUserRow): PlatformUser {
  return { id: r.id, email: r.email, passwordHash: r.password_hash, role: r.role, status: r.status, createdAt: r.created_at };
}

class SqlitePlatformUserStore implements PlatformUserRepository {
  private readonly upsert: Database.Statement;
  private readonly byId: Database.Statement;
  private readonly byEmail: Database.Statement;
  private readonly all: Database.Statement;

  constructor(sqlite: Database.Database) {
    this.upsert = sqlite.prepare(
      `INSERT INTO platform_user (id, email, password_hash, role, status, created_at)
       VALUES (@id, @email, @passwordHash, @role, @status, @createdAt)
       ON CONFLICT(id) DO UPDATE SET
         email = @email, password_hash = @passwordHash, role = @role, status = @status, created_at = @createdAt`,
    );
    this.byId = sqlite.prepare(`SELECT * FROM platform_user WHERE id = ?`);
    this.byEmail = sqlite.prepare(`SELECT * FROM platform_user WHERE email = ?`);
    this.all = sqlite.prepare(`SELECT * FROM platform_user ORDER BY created_at, id`);
  }

  async findById(id: string): Promise<PlatformUser | null> {
    const row = this.byId.get(id) as PlatformUserRow | undefined;
    return row ? toPlatformUser(row) : null;
  }

  async findByEmail(email: string): Promise<PlatformUser | null> {
    const row = this.byEmail.get(email) as PlatformUserRow | undefined;
    return row ? toPlatformUser(row) : null;
  }

  async list(): Promise<PlatformUser[]> {
    return (this.all.all() as PlatformUserRow[]).map(toPlatformUser);
  }

  async save(u: PlatformUser): Promise<void> {
    this.upsert.run({ ...u });
  }
}

export interface SqlitePlatformStoresHandle {
  readonly tenants: TenantRepository;
  readonly plans: PlanRepository;
  readonly subscriptions: SubscriptionRepository;
  readonly platformUsers: PlatformUserRepository;
  close(): void;
}

export function createSqlitePlatformStores(path: SqliteConnectionInput = ":memory:"): SqlitePlatformStoresHandle {
  const { sqlite, owned } = openSqliteConnection(path);
  sqlite.exec(CREATE_TABLES);
  return {
    tenants: new SqliteTenantStore(sqlite),
    plans: new SqlitePlanStore(sqlite),
    subscriptions: new SqliteSubscriptionStore(sqlite),
    platformUsers: new SqlitePlatformUserStore(sqlite),
    close: () => { if (owned) sqlite.close(); },
  };
}
```

Append to `packages/persistence/src/index.ts`:

```ts
export { createSqlitePlatformStores, type SqlitePlatformStoresHandle } from "./platform-store.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/persistence/src/platform-store.test.ts`
Expected: PASS, 4 tests. If the `/UNIQUE/` assertions fail because `save` resolves, the async wrapper is swallowing nothing; better-sqlite3 throws synchronously inside the async method, which rejects the promise, so check the index name in the `CREATE` block for typos.

- [ ] **Step 5: Commit**

```bash
git add packages/persistence/src/platform-store.ts packages/persistence/src/platform-store.test.ts packages/persistence/src/index.ts
git commit -m "feat(persistence): the platform database — tenants, plans, subscriptions, operators"
```

---

### Task 9: `createPlatform` factory and plan seed

**Files:**
- Create: `packages/backend/src/create-platform.ts`
- Create: `packages/backend/src/create-platform.test.ts`
- Modify: `packages/backend/src/index.ts` (append export)

- [ ] **Step 1: Write the failing test**

```ts
// packages/backend/src/create-platform.test.ts
import { describe, it, expect } from "vitest";
import { MODULE_CATALOG, Money } from "@mezan/domain";
import { createPlatform, PLATFORM_SEED_PLANS } from "./create-platform.js";

describe("createPlatform", () => {
  it("seeds core, business and enterprise once, in order, at zero price", async () => {
    const platform = await createPlatform({ dbPath: ":memory:" });
    const plans = await platform.stores.plans.list();
    expect(plans.map((p) => p.code)).toEqual(["core", "business", "enterprise"]);
    expect(plans.map((p) => p.seatsIncluded)).toEqual([3, 10, 25]);
    for (const p of plans) {
      expect(p.trialDays).toBe(14);
      expect(p.priceMonthly.equals(Money.zero())).toBe(true);
      expect(p.status).toBe("active");
      expect(p.isPublic).toBe(true);
    }
    const enterprise = plans[2]!;
    expect([...enterprise.modules].sort()).toEqual([...MODULE_CATALOG].sort());
    const business = plans[1]!;
    expect(business.modules).not.toContain("hr");
    expect(business.modules).toContain("crm");
    const core = plans[0]!;
    expect(core.modules).toEqual(PLATFORM_SEED_PLANS[0]!.modules);
    platform.close();
  });

  it("does not reseed when a plan already exists", async () => {
    const platform = await createPlatform({ dbPath: ":memory:" });
    const before = await platform.stores.plans.list();
    await platform.seedPlansIfEmpty();
    expect(await platform.stores.plans.list()).toEqual(before);
    platform.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- packages/backend/src/create-platform.test.ts`
Expected: FAIL, cannot resolve `./create-platform.js`.

- [ ] **Step 3: Write the factory**

```ts
// packages/backend/src/create-platform.ts
import { createPlan, MODULE_CATALOG, Money, type CreatePlanCommand } from "@mezan/domain";
import { createSqlitePlatformStores, type SqlitePlatformStoresHandle } from "@mezan/persistence";

export interface CreatePlatformOptions {
  readonly dbPath?: string;
  readonly now?: () => Date;
}

export interface PlatformHandle {
  readonly stores: SqlitePlatformStoresHandle;
  seedPlansIfEmpty(): Promise<void>;
  close(): void;
}

const CORE_MODULES = ["dashboard", "accounting", "sales", "purchases", "inventory", "treasury", "transactions", "workflow", "audit", "admin", "notifications"];
const BUSINESS_MODULES = [...CORE_MODULES, "crm", "installments", "financial_papers", "field", "assets", "projects"];

type SeedPlan = Omit<CreatePlanCommand, "now">;

/**
 * Prices are 0 until the owner sets them — see the open decision in
 * docs/superpowers/specs/2026-09-13-saas-tenant-models-design.md §7.
 */
export const PLATFORM_SEED_PLANS: readonly SeedPlan[] = [
  {
    id: "PLAN-CORE", code: "core", nameAr: "الأساسية", nameEn: "Core", modules: CORE_MODULES,
    seatsIncluded: 3, branchesIncluded: 1, warehousesIncluded: 1,
    priceMonthly: Money.zero(), priceYearly: Money.zero(), trialDays: 14, isPublic: true, sortOrder: 1,
  },
  {
    id: "PLAN-BUSINESS", code: "business", nameAr: "الأعمال", nameEn: "Business", modules: BUSINESS_MODULES,
    seatsIncluded: 10, branchesIncluded: 3, warehousesIncluded: 3,
    priceMonthly: Money.zero(), priceYearly: Money.zero(), trialDays: 14, isPublic: true, sortOrder: 2,
  },
  {
    id: "PLAN-ENTERPRISE", code: "enterprise", nameAr: "المؤسسات", nameEn: "Enterprise", modules: [...MODULE_CATALOG],
    seatsIncluded: 25, branchesIncluded: 10, warehousesIncluded: 10,
    priceMonthly: Money.zero(), priceYearly: Money.zero(), trialDays: 14, isPublic: true, sortOrder: 3,
  },
];

export async function createPlatform(options: CreatePlatformOptions = {}): Promise<PlatformHandle> {
  const stores = createSqlitePlatformStores(options.dbPath ?? ":memory:");
  const now = options.now ?? (() => new Date());
  const seedPlansIfEmpty = async () => {
    if ((await stores.plans.list()).length > 0) return;
    const stamp = now().toISOString();
    for (const plan of PLATFORM_SEED_PLANS) await createPlan({ ...plan, now: stamp }, stores.plans);
  };
  await seedPlansIfEmpty();
  return { stores, seedPlansIfEmpty, close: () => stores.close() };
}
```

Append to `packages/backend/src/index.ts`:

```ts
export { createPlatform, PLATFORM_SEED_PLANS, type CreatePlatformOptions, type PlatformHandle } from "./create-platform.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- packages/backend/src/create-platform.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/create-platform.ts packages/backend/src/create-platform.test.ts packages/backend/src/index.ts
git commit -m "feat(backend): createPlatform opens the platform database and seeds the three plans once"
```

---

### Task 10: Full gates

**Files:** none new.

- [ ] **Step 1: Run every gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: all three exit 0. The full vitest run is large; if only pre-existing tests fail, note which and confirm they fail identically on `git stash`-free `main` by checking `git log` for the same failure before touching them.

- [ ] **Step 2: Confirm nothing outside the plan changed**

Run: `git diff --stat main..HEAD -- . ':!docs/superpowers'`
Expected: only files named in this plan's File map, plus `packages/api/src/app.ts` and the three `index.ts` barrels.

- [ ] **Step 3: Record the slice in the roadmap**

Append under `docs/ROADMAP.md` §4.3 one line: "Cloud-1 #6–8 (models only) and Cloud-3 #13 landed 2026-09-13 as `packages/domain/src/platform`, `packages/persistence/src/platform-store.ts` and `createPlatform`; routing, onboarding, console and billing remain open — see `docs/superpowers/specs/2026-09-13-saas-tenant-models-design.md`."

- [ ] **Step 4: Commit**

```bash
git add docs/ROADMAP.md
git commit -m "docs(roadmap): the SaaS tenant models landed; routing and onboarding remain"
```
