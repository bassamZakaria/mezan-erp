# Licensable sub-modules — design

**Date** 2026-10-31 · **Status** approved approach (A), spec under review

Asked for: "control the sub-modules — e.g. the people part of HR is needed by most other modules,
because we map people everywhere, but those people won't use the system at all."

Decisions taken with the owner:

1. **Who controls sub-modules:** the vendor only, through the plan / licence. The tenant admin does
   not toggle them.
2. **The staff list is free in every plan.** Full HR features stay paid.
3. **Approach A:** sub-modules are dotted ids inside the existing `activeModules` list. No new
   licence field.
4. Start with HR. The mechanism is generic; other modules are split later, one at a time.

## 1. What exists today

- Entitlements carry `activeModules: string[]` (`packages/domain/src/entitlements/entitlements.ts`).
  The same shape comes from the signed desktop licence and from the cloud JWT.
- `hasModule(ent, id)` is a plain `includes`. HR is one id: `hr`.
- Two gates read it:
  - the **route-prefix gate** (`packages/api/src/module-gate.ts`) — `/hr` and `/hr/*` → `hr`;
  - the **permission gate** (`packages/api/src/permission-gate.ts` → `moduleRefusalFor`) — the
    permission's `module` (first dotted segment, `hr`) must be licensed.
- `licensedPermissions` (`packages/domain/src/permissions/module-licensing.ts`) hides unlicensed
  permissions from the role editor.
- The web shell hides requests and nav by module (`planServesShellRequest`,
  `apps/web/src/data/plan-modules.ts`).
- **The defect this fixes:** `/hr/employees` is consumed outside HR — sales invoices (salesperson,
  sales manager, promotion rep/manager via `resolveInvoiceReps`), work orders, van trips, branches,
  financial reports. A tenant without `hr` cannot pick a salesperson or assign a worker.
- Employees are already independent of users (`users.employeeId` is nullable). An employee costs
  no seat and needs no login. Nothing to change there.
- Salary is not on the employee record; it is on contracts and payroll. The employee row carries
  only `salaryPaymentMethod` / `bankAccount`, written by a separate route.

## 2. The model

### 2.1 Ids

A sub-module id is `<parent>.<part>`. A registry in the domain lists them:

```ts
// packages/domain/src/entitlements/sub-modules.ts
export const SUB_MODULES = {
  hr: ["hr.people", "hr.contracts", "hr.time", "hr.payroll", "hr.self"],
} as const;
export const FREE_SUB_MODULES: ReadonlySet<string> = new Set(["hr.people"]);
```

Each entry also carries `{ ar, en }` names for the plan editor and refusal messages.

### 2.2 Resolution rules (one function, every gate uses it)

`hasModule(ent, id)` becomes:

| Asked for | True when |
|---|---|
| a sub-module `hr.payroll` | `activeModules` has `hr.payroll` **or** its parent `hr`, **or** it is in `FREE_SUB_MODULES` |
| a parent `hr` | `activeModules` has `hr` (the whole module) |

Plus `hasAnyPartOf(ent, "hr")`: true when the parent or any sub-module is held, free ones included.
It is for "should the HR menu exist at all", never for a write gate.

`hasReadOnlyModule` follows the same parent fallback, so a tenant that dropped from `hr` to
`hr.time` keeps payroll **readable** (DEC-31 rule 5), as long as `hr` or `hr.payroll` is listed in
`readOnlyModules`. The same goes for `moduleTrials`: a trial on `hr` covers every part.
Trials on a single sub-module are out of scope.

**Backward compatibility:** every licence and plan already issued lists `hr` and therefore keeps
every HR part. No migration, no licence re-issue. An old app build that reads a new licence listing
only `hr.time` would see no HR at all — this fails closed, which is acceptable.

### 2.3 HR split

| Sub-module | Price | Routes (`/hr/…`) | Permission codes |
|---|---|---|---|
| `hr.people` الأفراد | **free** | `employees` (list, get, create, edit, transition, terminate, correct-termination-date, rehire), `departments`, `job-titles`, `dashboard` | `hr.employee.view/create/edit/terminate`, `hr.department.*`, `hr.job_title.*` |
| `hr.contracts` العقود | paid | `contracts*`, `employees/:id/contracts` | `hr.contract.*` |
| `hr.time` الدوام والإجازات | paid | `attendance*`, `holidays*`, `leave-*`, `employees/:id/clock-credential*` | `hr.attendance.*`, `hr.leave.*`, `hr.leave_policy.*`, `hr.leave_accrual.run` |
| `hr.payroll` الرواتب | paid | `payroll/*`, `advances*`, `employees/:id/end-of-service`, `employees/:id/salary-payment` | `hr.payroll.*`, `hr.advance.*`, `hr.provision.reverse`, `hr.employee.view_salary` |
| `hr.self` الخدمة الذاتية | paid | `self/*`, `leave-requests/me` | `hr.self.*` |

Two route gates in the table are wrong today and get fixed:
- `PUT /hr/employees/:id/salary-payment` is gated by `hr.employee.edit`. It moves to a payroll
  permission (`hr.payroll.create`), or a people-only tenant could write salary bank data.
- `GET /hr/employees/:id/clock-credential` is gated by `hr.employee.view`. It moves to
  `hr.attendance.view`.

`hr.self` needs the matching data sub-module to answer: self leave needs `hr.time`, self payslips
need `hr.payroll`. Each self route checks both.

## 3. Where the change lands

### 3.1 Domain (`packages/domain`)

- `entitlements/sub-modules.ts` — the registry, `parentOf(id)`, `isSubModule(id)`, names.
- `entitlements/entitlements.ts` — `hasModule`, `hasReadOnlyModule` and `hasAnyPartOf` gain the
  rules in §2.2.
- `permissions/catalog.ts` — `PermissionDef` gains `subModule: string | null`. It is filled from an
  explicit code→sub-module table for HR. Every `hr.*` code must map to a sub-module; a unit test
  fails on any unmapped code, so a new HR permission cannot slip through ungated.
- `permissions/module-licensing.ts` — `isModuleLicensed` / `licensedPermissions` check
  `subModule ?? module`. `hr.people` joins the always-licensed set through `FREE_SUB_MODULES`.
- `permissions/shell-requests.ts` — `ShellRequest.Employees` (and the departments / job-titles
  requests) move to `hr.people`, so every plan serves the staff list to other modules' pickers.
- `platform/module-catalog.ts` — `MODULE_CATALOG` stays parents only; sub-module ids are validated
  through the registry. `isKnownModule` accepts both.

### 3.2 API (`packages/api`)

- `module-gate.ts` — the route-prefix table gains HR rows ordered longest first:
  `/hr/payroll`, `/hr/advances` → `hr.payroll`; `/hr/attendance`, `/hr/holidays`, `/hr/leave-*`
  → `hr.time`; `/hr/contracts` → `hr.contracts`; `/hr/self` → `hr.self`; `/hr/employees`,
  `/hr/departments`, `/hr/job-titles`, `/hr/dashboard` → `hr.people`. The bare `/hr` row is removed.
  The permission gate stays the authority for the mixed `employees/:id/*` paths.
- Refusals name the sub-module in Arabic: «جزء الرواتب من الموارد البشرية غير مفعّل في باقتكم».
- `period-close-routes.ts` (`payrollEntitled`) and the leave-accrual job in `create-backend.ts`
  (`allowed`) check `hr.payroll` and `hr.time`, not `hr`. These are the two direct `hasModule(…,
  "hr")` calls today.

### 3.3 Licence and plans

- Licence payload and entitlement schemas: **no shape change.** `activeModules` already holds
  strings.
- Licence issuing (vendor tool / platform admin) validates each id against the registry and
  drops a sub-module whose parent is also listed (the parent already covers it). Free parts are
  never written into a licence.
- `PlanEditor.tsx`: each parent module with sub-modules shows its parts as nested checkboxes.
  Ticking the parent sends `hr`; ticking only some parts sends those ids. A free part is shown
  ticked and disabled, with «مجاني في كل الباقات».
- `TenantDetailPage.tsx` lists sub-modules under their parent.
- Seeded plans in `create-platform.ts` keep `hr` where they have it today.

### 3.4 Web

- The HR nav group shows when `hasAnyPartOf(ent, "hr")` — which is now every plan, because the
  staff list is free. Inside, each screen hides by its sub-module: employees, departments and job
  titles always; contracts, attendance, leave, payroll, advances and garnishments by their parts.
- `EmployeesScreen` and the employee detail page hide the parts that belong to other sub-modules:
  the contracts tab without `hr.contracts`, clock settings (selfie/biometric/badge, device id) and
  overtime without `hr.time`, and salary payment, bank account, pension and tax-disability without
  `hr.payroll`. The create form already requires only name, branch and hire date.
- `planIncludesModule` gains a sub-module variant; `PlanModule` lists the HR parts.

## 4. Errors and edge cases

- **Downgrade with data:** a tenant moves from `hr` to only `hr.people`. Payroll runs, contracts and
  leave already recorded stay readable if the platform puts the dropped parts in `readOnlyModules`
  (the same path a dropped whole module takes today). Writes refuse with `MODULE_READ_ONLY`.
- **Terminating an employee** stays in `hr.people`. End-of-service settlement is `hr.payroll`. A
  people-only tenant can mark someone terminated; no gratuity is computed or posted. Nothing moves
  in the GL, so no one-sided posting arises.
- **Role editor:** permissions of an unlicensed sub-module are hidden, the same as a whole module
  is hidden today. Existing roles that hold such codes keep them; the gate refuses at request time.
- **Old desktop build + new licence listing sub-modules only:** HR is fully locked (fail closed).
  The release that ships this is the minimum version for such licences.

## 5. Testing

- Domain unit: resolution table in §2.2 (parent implies part, free part always, parent not implied
  by a part, read-only and trial fallback); every `hr.*` permission is mapped.
- API: for a plan with `["sales"]` only — `GET /hr/employees` 200, `POST /hr/employees` 201,
  `POST /sales-invoices` with a `salespersonId` 201 with the real employee id stored,
  `GET /hr/payroll/runs` 403 `MODULE_NOT_LICENSED` naming `hr.payroll`,
  `PUT /hr/employees/:id/salary-payment` 403. For `["hr.time"]`: attendance 200, payroll 403.
  For `["hr"]`: everything as today.
- Scenarios: add a `sub-modules` scenario to `scripts/scenarios` covering the above on a seeded
  backend; update `trial-freemium.ts` and `cross-module.ts` where they assume `hr` gates
  `/hr/employees`.
- Live: on a seeded backend with a sales-only plan, pick a salesperson on a sales invoice, reload,
  and confirm the stored id; confirm the HR menu shows only employees, departments and job titles.

## 6. Out of scope

- Splitting modules other than HR (the registry makes each one a table entry plus a gate map).
- Customer-admin toggles for hiding licensed parts.
- Trials on a single sub-module.
- Pricing of the paid HR parts.
