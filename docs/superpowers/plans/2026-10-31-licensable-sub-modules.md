# Licensable Sub-modules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a plan/licence grant parts of a module (`hr.payroll`, `hr.time`, …) with the HR staff list (`hr.people`) free in every plan, so other modules can map people without the HR module.

**Architecture:** Sub-modules are dotted ids in the existing `activeModules` list. One domain resolver (`hasModule`) applies "parent implies part, free part always" and every gate — route-prefix, permission, shell request, nav — goes through it. Each `hr.*` permission is tagged with its sub-module.

**Tech Stack:** TypeScript, Hono (API), zod (contracts), React + TanStack Query (web), vitest, `scripts/scenarios` harness.

**Spec:** `docs/superpowers/specs/2026-10-31-licensable-sub-modules-design.md`

## Global Constraints

- No change to `entitlementsSchema` or `licensePayloadSchema` shape; `activeModules` stays `string[]`.
- A licence/plan listing `hr` keeps every HR part exactly as today.
- `hasModule(ent, "hr")` is true only when `hr` itself is listed — never because of a part or a free part.
- Sub-module ids: `hr.people` (free), `hr.contracts`, `hr.time`, `hr.payroll`, `hr.self`.
- Arabic names: الأفراد، العقود، الدوام والإجازات، الرواتب، الخدمة الذاتية. English: People, Contracts, Time and leave, Payroll, Self-service.
- Refusal copy: «جزء {nameAr} من الموارد البشرية غير مفعّل في باقتكم».
- Plan editor note on a free part: «مجاني في كل الباقات».
- Arabic-first UI; refusals surface in Arabic. No mocked data. No `Co-Authored-By` trailers.
- Each slice ships on `pnpm typecheck && pnpm lint` plus the tests named in its task; final proof adds `pnpm build`, `pnpm test`, `pnpm smoke`, `pnpm check:seed`, `pnpm scenarios`.

## Review Focus

1. **Downgrade overlap:** `activeModules: ["sales"]`, `readOnlyModules: ["hr"]` — `hr.people` writes must succeed (free beats read-only), `hr.payroll` writes refuse `MODULE_READ_ONLY`, payroll reads answer 200. Test in Task 1 and Task 3.
2. **Stale role grants:** a role holding `hr.payroll.view` on a people-only tenant gets 403 at request time, not 200. Test in Task 3.
3. **Mixed `employees/:id/*` paths:** `/hr/employees/:id/end-of-service` and `/salary-payment` refuse on a people-only plan even though `/hr/employees` is a `hr.people` prefix. Test in Task 3.
4. **Part without parent leaking the parent:** `["hr.time"]` must not make `hasModule(ent, "hr")` true (period close would think payroll is entitled). Test in Task 1 and Task 3.
5. **Sales invoice salesperson on a sales-only plan** stores the real employee id and resolves the name. Test in Task 3 (API) and Task 7 (scenario).

---

### Task 1: Sub-module registry and resolution

**Files:**
- Create: `packages/domain/src/entitlements/sub-modules.ts`
- Modify: `packages/domain/src/entitlements/entitlements.ts` (`hasModule`, `hasReadOnlyModule`, add `hasAnyPartOf`)
- Modify: `packages/domain/src/entitlements/index.ts` (exports)
- Modify: `packages/domain/src/platform/module-catalog.ts` (`isKnownModule` accepts sub-module ids; add `LicensableId`; `moduleName` covers sub-modules)
- Test: `packages/domain/src/entitlements/sub-modules.test.ts`, extend `packages/domain/src/entitlements/entitlements.test.ts`

**Interfaces:**
- Produces:
  - `enum HrSubModule { People = "hr.people", Contracts = "hr.contracts", Time = "hr.time", Payroll = "hr.payroll", Self = "hr.self" }`
  - `SUB_MODULES: Readonly<Record<string, readonly string[]>>` — `{ hr: [all five] }`
  - `FREE_SUB_MODULES: ReadonlySet<string>` — `{ "hr.people" }`
  - `SUB_MODULE_NAMES: Readonly<Record<string, { ar: string; en: string }>>`
  - `parentOf(id: string): string | null` — `"hr.time"` → `"hr"`, `"hr"` → `null`, unknown dotted id → `null`
  - `isSubModule(id: string): boolean`
  - `hasModule(ent, id): boolean` — sub-module: listed, parent listed, or free; parent: listed only
  - `hasReadOnlyModule(ent, id): boolean` — false when `hasModule` is true; else id or its parent in `readOnlyModules`
  - `hasAnyPartOf(ent, parent: string): boolean` — parent, any listed part, or any free part of it
  - `type LicensableId = ModuleId | HrSubModule`

- [ ] **Step 1: Write failing tests** in `sub-modules.test.ts`:

```ts
const ent = (activeModules: string[], readOnlyModules?: string[]) =>
  ({ plan: "P", activeModules, readOnlyModules, features: {}, seats: 1, expiresAt: null });

it("a parent implies every part", () => expect(hasModule(ent(["hr"]), "hr.payroll")).toBe(true));
it("a part alone does not imply the parent", () => expect(hasModule(ent(["hr.time"]), "hr")).toBe(false));
it("a part alone does not imply a sibling", () => expect(hasModule(ent(["hr.time"]), "hr.payroll")).toBe(false));
it("a free part is held by every plan", () => expect(hasModule(ent(["sales"]), "hr.people")).toBe(true));
it("a free part never implies the parent", () => expect(hasModule(ent([]), "hr")).toBe(false));
it("read-only parent covers a dropped part", () => expect(hasReadOnlyModule(ent(["sales"], ["hr"]), "hr.payroll")).toBe(true));
it("free beats read-only", () => expect(hasReadOnlyModule(ent(["sales"], ["hr"]), "hr.people")).toBe(false));
it("any part shows the parent group", () => {
  expect(hasAnyPartOf(ent(["sales"]), "hr")).toBe(true); // free hr.people
  expect(hasAnyPartOf(ent(["sales"]), "crm")).toBe(false);
});
it("isKnownModule accepts parts", () => {
  expect(isKnownModule("hr.payroll")).toBe(true);
  expect(isKnownModule("hr.nope")).toBe(false);
});
```

- [ ] **Step 2: Run** `pnpm vitest run packages/domain/src/entitlements` — expect FAIL (module not found).
- [ ] **Step 3: Implement** the registry and resolver changes listed under Interfaces. `createEntitlements().has()` delegates to the new `hasModule` unchanged. `isKnownModule` returns `KNOWN.has(id) || isSubModule(id)`; keep its type guard as `id is LicensableId`.
- [ ] **Step 4: Run** `pnpm vitest run packages/domain` — expect PASS, existing entitlement and module-trial tests included.
- [ ] **Step 5: Commit** `feat(domain): licensable sub-modules registry and resolver`

### Task 2: Permissions carry their sub-module

**Files:**
- Modify: `packages/domain/src/permissions/catalog.ts` (`PermissionDef.subModule: string | null`; fill in `expand`)
- Create: `packages/domain/src/permissions/hr-sub-modules.ts` (code → sub-module table)
- Modify: `packages/domain/src/permissions/module-licensing.ts` (`isPermissionLicensed(p, ent)`, `isPermissionReadOnly(p, ent)`; `licensedPermissions` uses `subModule ?? module`)
- Modify: `packages/domain/src/permissions/shell-requests.ts` (`ShellRequestModule.HrPeople = "hr.people"` for `Employees` and `JobTitles`; `planServesShellRequest` uses `hasModule` / `hasReadOnlyModule`; `mayAskScreenRequest` uses the permission's sub-module)
- Test: extend `module-licensing.test.ts`, `shell-requests.test.ts`; create `hr-sub-modules.test.ts`

**Interfaces:**
- Consumes: `hasModule`, `hasReadOnlyModule`, `isModuleLicensed`, `HrSubModule` from Task 1.
- Produces: `PermissionDef.subModule`; `licensingIdOf(p: PermissionDef): string` (= `p.subModule ?? entitlementModuleOf(p.module)`); `isPermissionLicensed(code: string, ent: Entitlements): boolean`; `isPermissionReadOnly(code: string, ent: Entitlements): boolean`.

Mapping (`HR_PERMISSION_SUB_MODULE`), spec §2.3:
- `hr.people`: `hr.employee.view/create/edit/terminate`, `hr.department.*`, `hr.job_title.*`
- `hr.contracts`: `hr.contract.*`
- `hr.time`: `hr.attendance.*`, `hr.leave.*`, `hr.leave_policy.*`, `hr.leave_accrual.run`
- `hr.payroll`: `hr.payroll.*`, `hr.advance.*`, `hr.provision.reverse`, `hr.employee.view_salary`
- `hr.self`: `hr.self.*`

- [ ] **Step 1: Write failing tests:**
  - `every hr permission maps to a sub-module` — `PERMISSIONS.filter(p => p.module === "hr").every(p => p.subModule !== null)`.
  - `non-hr permissions carry no sub-module` — e.g. `getPermission("sales.invoice.view")?.subModule === null`.
  - `licensedPermissions on ["sales"] includes hr.employee.view and excludes hr.payroll.view and hr.employee.view_salary`.
  - `licensedPermissions on ["hr"] includes all 41 hr codes`.
  - `planServesShellRequest({activeModules:["sales"]}, ShellRequest.Employees) === true`.
- [ ] **Step 2: Run** `pnpm vitest run packages/domain/src/permissions` — expect FAIL.
- [ ] **Step 3: Implement.** The `count: 41` check on the hr module row stays valid — the module of each code is still `hr`.
- [ ] **Step 4: Run** `pnpm vitest run packages/domain` — expect PASS.
- [ ] **Step 5: Commit** `feat(domain): hr permissions licensed by sub-module; staff list served on every plan`

### Task 3: API gates

**Files:**
- Modify: `packages/api/src/module-gate.ts` (HR prefix rows, longest first; remove bare `/hr`; sub-module refusal copy)
- Modify: `packages/api/src/permission-gate.ts` (`moduleRefusalFor` uses `isPermissionLicensed` / `licensingIdOf`)
- Modify: `packages/domain/src/entitlements/module-refusal.ts` (`moduleNotLicensedMessageAr` names a sub-module with the Global Constraints copy)
- Modify: `packages/api/src/hr-routes.ts` — `PUT /employees/:id/salary-payment` gate → `hr.payroll.create`
- Modify: `packages/api/src/hr-self-routes.ts` — clock-credential `GET` → `hr.attendance.view`, `reset` → `hr.attendance.edit`; self routes also require the data part (`self/leave-requests*`, `self/attendance`, `self/clock*` → `hr.time`; `self/payslips*`, `self/advances` → `hr.payroll`) via a `requireSubModule(id)` middleware placed after the permission gate
- Modify: `packages/api/src/hr-routes.ts` — `/leave-requests/me` additionally `requireSubModule("hr.time")`
- Modify: `packages/api/src/period-close-routes.ts` — `payrollEntitled` = `hasModule(ent, "hr.payroll")`
- Modify: `packages/backend/src/create-backend.ts:6181` — accrual job `allowed` = `hasModule(ent, "hr.time")`
- Modify: `apps/web/src` and `scripts` callers that send the old salary-payment / clock-credential permission in role fixtures (grep `hr.employee.edit` near `salary-payment`)
- Test: `packages/api/src/module-gate.test.ts`, `packages/api/src/permission-gate.test.ts`, new `packages/api/src/hr-sub-module-gating.test.ts`

**Interfaces:**
- Consumes: Task 1 resolver, Task 2 `isPermissionLicensed`, `licensingIdOf`.
- Produces: `requireSubModule(id: string): MiddlewareHandler` exported from `module-gate.ts` — 403 `MODULE_NOT_LICENSED` with `module: id`, or the read-only outcome for safe methods.

Prefix rows (insert before any shorter `/hr*` row; no bare `/hr`):
`/hr/payroll`, `/hr/advances` → `hr.payroll`; `/hr/attendance`, `/hr/holidays`, `/hr/leave-policies`, `/hr/leave-balances`, `/hr/leave-accrual-batches`, `/hr/leave-requests` → `hr.time`; `/hr/contracts` → `hr.contracts`; `/hr/self` → `hr.self`; `/hr/employees`, `/hr/departments`, `/hr/job-titles`, `/hr/dashboard` → `hr.people`.

`applyModuleGates` must match the longest prefix only — a request to `/hr/leave-requests/me` hits the `hr.time` row once, not a second, broader row.

- [ ] **Step 1: Write failing tests** in `hr-sub-module-gating.test.ts` using the backend test kit with injected entitlements:
  - plan `["sales"]`: `GET /hr/employees` 200; `POST /hr/employees` 201; `POST /sales-invoices` with an existing employee as `salespersonId` 201 and the stored row's `salespersonId` equals that employee's id; `GET /hr/payroll/runs` 403 `{ error: "MODULE_NOT_LICENSED", module: "hr.payroll" }` with the Arabic copy; `PUT /hr/employees/:id/salary-payment` 403; `GET /hr/employees/:id/end-of-service` 403; `GET /hr/contracts` 403.
  - plan `["hr.time"]`: `GET /hr/attendance` 200; `GET /hr/payroll/runs` 403; period-close scope `payrollEntitled === false`.
  - plan `["sales"]`, readOnly `["hr"]`: `POST /hr/employees` 201; `GET /hr/payroll/runs` 200; `POST /hr/payroll/runs` 403 `MODULE_READ_ONLY`.
  - plan `["hr"]`: every route above answers as on `main` (the salary-payment call uses a role holding `hr.payroll.create`).
  - role holding `hr.payroll.view` on plan `["sales"]`: `GET /hr/payroll/runs` 403.
- [ ] **Step 2: Run** `pnpm vitest run packages/api/src/hr-sub-module-gating.test.ts` — expect FAIL.
- [ ] **Step 3: Implement** the changes in the file list.
- [ ] **Step 4: Run** `pnpm vitest run packages/api packages/backend` — expect PASS. Fix any existing test that asserted the old `hr` refusal for `/hr/employees` by rewriting it to the new behaviour (skill rule 12), not deleting it.
- [ ] **Step 5: Commit** `feat(api): gate HR routes by sub-module; salary-payment and clock-credential move to their own parts`

### Task 4: Plans and licences accept sub-modules

**Files:**
- Modify: `packages/domain/src/platform/plan.ts` (`dedupeModules` → `normaliseModules`: dedupe, drop a part whose parent is listed, drop free parts)
- Modify: `packages/domain/src/platform/subscription.ts`, `module-trial.ts` — add-ons accept parts via `isKnownModule`; a trial request for a sub-module is refused with «التجربة متاحة للوحدة كاملة فقط»
- Modify: `scripts/licence-issue.mjs` — validate each `--modules` id against the registry and normalise the same way
- Test: extend `packages/domain/src/platform/plan.test.ts`, `module-trial.test.ts`

**Interfaces:**
- Consumes: Task 1 `parentOf`, `FREE_SUB_MODULES`, `isKnownModule`.
- Produces: `normaliseModules(modules: readonly string[]): string[]` (export from `@mezan/domain`).

- [ ] **Step 1: Failing tests:** `normaliseModules(["hr", "hr.time", "sales", "sales"])` → `["hr", "sales"]`; `normaliseModules(["hr.people", "hr.time"])` → `["hr.time"]`; `createPlan` with `["hr.nope"]` refused «وحدة غير معروفة "hr.nope"»; module trial for `hr.payroll` refused.
- [ ] **Step 2: Run** `pnpm vitest run packages/domain/src/platform` — FAIL.
- [ ] **Step 3: Implement.** Seeded plans in `packages/backend/src/create-platform.ts` stay unchanged.
- [ ] **Step 4: Run** `pnpm vitest run packages/domain packages/backend` and `node scripts/licence-issue.mjs --help` (no crash) — PASS.
- [ ] **Step 5: Commit** `feat(platform): plans and licences carry sub-modules`

### Task 5: Web — nav and HR screens follow sub-modules

**Files:**
- Modify: `apps/web/src/nav-config.tsx` — `NAV_ITEM_ACCESS` HR rows carry their sub-module (employees, departments, job-titles, hr-dashboard, report-headcount-movement → `hr.people`; contracts → `hr.contracts`; attendance, holidays, leave-*, leave-policies, report-attendance-summary, report-leave-liability → `hr.time`; payroll, advances, payroll-components, garnishments, payroll-statutory, report-payroll-register, report-social-insurance, report-salary-tax → `hr.payroll`; my-* → `hr.self`); `people` group is shown by `hasAnyPartOf(ent, "hr")`; `moduleForNavItem` prefers the item's sub-module over the group's module
- Modify: `apps/web/src/data/plan-modules.ts` — `PlanModule` gains the five HR parts; `planIncludesModule` uses `hasModule`
- Modify: `apps/web/src/screens/EmployeesScreen.tsx` (+ the employee detail component it renders) — hide contracts tab without `hr.contracts`; clock settings (`requireSelfieAtClockIn`, `requireBiometricAtClockIn`, `deviceBadgeId`), `overtimeEligibility`, `standardWorkHours` without `hr.time`; salary payment, bank account, `hasPensionEntitlement`, `taxDisabilityExemption` without `hr.payroll`
- Test: `apps/web/src/nav-config.test.tsx` (extend or create), `apps/web/src/screens/EmployeesScreen.test.tsx`

**Interfaces:**
- Consumes: `hasModule`, `hasAnyPartOf`, `HrSubModule`, `LicensableId`.
- Produces: `NAV_ITEM_ACCESS[key].module: LicensableId`.

- [ ] **Step 1: Failing tests:** on entitlements `["sales"]` the people group shows exactly `employees`, `departments`, `job-titles` (+ `hr-dashboard`, `report-headcount-movement` if in the group's items); on `["hr"]` every HR item shows as before; `EmployeesScreen` on `["sales"]` renders no bank-account field and no contracts tab; `moduleOutsideLicence("payroll", ["hr.time"])` → `"hr.payroll"`.
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/nav-config src/screens/EmployeesScreen` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same tests and `pnpm typecheck && pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(web): HR menu and employee form follow licensed sub-modules`

### Task 6: Web — plan editor and tenant view

**Files:**
- Modify: `apps/web/src/platform/PlanEditor.tsx` — modules field renders parents; a parent with `SUB_MODULES` entries renders its parts as nested checkboxes; ticking the parent stores `hr` and ticks all parts; unticking one part replaces `hr` with the remaining paid parts; free part shown ticked + disabled with «مجاني في كل الباقات»; "select all" stays `MODULE_CATALOG`; saved list goes through `normaliseModules`
- Modify: `apps/web/src/platform/TenantDetailPage.tsx` — `activeModules` rendered grouped: a part shows under its parent's name
- Modify: i18n files for the five names and the free note (ar + en)
- Test: `apps/web/src/platform/PlanEditor.test.tsx`, `TenantDetailPage.test.tsx`

- [ ] **Step 1: Failing tests:** tick HR → payload `modules` contains `hr` and no `hr.*`; tick HR then untick الرواتب → payload contains `hr.contracts`, `hr.time`, `hr.self` and not `hr`; الأفراد checkbox is disabled and checked; tenant with `["sales","hr.time"]` shows «الموارد البشرية — الدوام والإجازات».
- [ ] **Step 2: Run** `pnpm --filter web exec vitest run src/platform` — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** same + `pnpm lint` — PASS.
- [ ] **Step 5: Commit** `feat(platform-web): plan editor picks HR parts`

### Task 7: Scenarios, defect register, live proof

**Files:**
- Create: `scripts/scenarios/sub-modules.ts` (register in `scripts/run-scenarios.ts` the same way `hr.ts` is)
- Modify: `scripts/scenarios/cross-module.ts:1754`, `scripts/scenarios/trial-freemium.ts` — wherever they assert `/hr/employees` is refused without `hr`, assert it is served
- Modify: `.claude/skills/mezan-erp/references/defect-register.md` — add the "staff list locked behind HR" defect as FIXED with this branch, and the salary-payment / clock-credential permission mismatch as FIXED

- [ ] **Step 1:** Write the scenario covering Task 3's sales-only and `hr.time` cases on a seeded backend, plus the read-only overlap.
- [ ] **Step 2: Run** `pnpm scenarios` — new scenario PASS, no other scenario regresses.
- [ ] **Step 3: Full gate:** `pnpm typecheck && pnpm lint && pnpm build && pnpm test && pnpm smoke && pnpm check:seed`.
- [ ] **Step 4: Live:** seeded backend with a sales-only plan → open a sales invoice, pick a salesperson, save, reload, confirm the stored id in the database is the employee's id; HR menu shows only the staff items; switch the plan to `hr` and confirm every HR screen returns.
- [ ] **Step 5: Commit** `test(scenarios): sub-module licensing; register the staff-list defect as fixed`
