# Mezan — Task Checklist

> Grounded in `docs/backlog.md` (phase table, §3) and re-verified against the code on `main` on 2026-08-23 (`git rev-parse --short HEAD` = `7b65887`). ✅ = implemented (domain + persistence + API + backend mount, and generally a real-data web screen); 🟡 = implemented but with known follow-up work; ⬜ = not started — either deferred by product decision (`docs/backlog.md` §1) or an outright gap, stated per line.
>
> **Verification gate:** `pnpm test` → 316 files / 2150 tests passing (`inv/labels-templates-writedown`: +10 files / +72 tests for label printing, product templates, and the aging write-down batch) · `pnpm typecheck` and `pnpm lint` passing · 28 Playwright specs under `e2e/` · 49 domain modules · 33 mounted API route prefixes · 74 web components. A line only carries ✅ if a file implementing it was found; several Phase 4/10/11/12 lines were corrected downward in this pass.

## Phase 0 — Foundations (desktop)

- ✅ Monorepo (pnpm workspaces) + package boundaries
- ✅ SQLite-behind-ports persistence (Drizzle + repository/Unit-of-Work ports)
- ✅ `Money`/`Qty` value objects, scaled-int (10⁻⁶) codecs, rounding policy
- ✅ Auth: desktop local user store + `AuthContext`
- ✅ Permissions engine (dependency graph, sensitive flag, view/view_own/view_all, branch+warehouse scoping)
- 🟡 Entitlements port + Ed25519 license verification skeleton — `verifyLicense` has no runtime caller; the desktop resolver is an explicit stub reading `MEZAN_ENTITLEMENTS_JSON` (`apps/desktop/src/main/entitlements.ts:17-33`), and the web app gates modules off `demoEntitlements` in `sample-data.ts:233`
- ✅ Numbering engine (atomic counters, prefix/suffix/pad-length/annual-reset)
- 🟡 Audit trail core (append-only, severity taxonomy) — engine, `createSqliteAuditSink` and tests exist, but `createBackend` never passes `audit` to `createApp`, so **nothing is recorded at runtime** (`packages/api/src/gl-routes.ts:50`, `packages/backend/src/create-backend.ts:333`)
- ✅ Workflow engine core (26 action types, ordered sequential role steps)
- ✅ Notification bus + rules engine core
- 🟡 App shell: RTL layout + `<DocumentList>`/`<DocumentDetail>`/filter-panel/KPI-strip primitives ✅ — **i18n (ar/en) was never built**: `apps/web/src/main.tsx:10-11` hardcodes `dir="rtl" lang="ar"`, no i18n library or catalog exists, and ~3,700 Arabic string literals are inline across ~103 files. The Settings language selector writes to local state nothing reads. **In flight** on `bassamZakaria/manta`: i18next provider + `useLocale`/`useT` under `packages/ui/src/i18n`, a top-bar language switcher, `dir`/`lang` derived from the active locale, and ar/en catalogs for the shell, nav, command palette and Settings. Screen-level extraction (~3,000 literals) is outstanding, so English degrades to Arabic below the shell by design (`fallbackLng: "ar"`, missing-key handler returns the last key segment so raw keys never leak)
- 🟡 Settings foundation: branches + warehouses are API-backed; the tenant-settings screen is **local state only** (`apps/web/src/settings/SettingsGeneral.tsx:40` seeds from `sampleSettings` and never calls the mounted `/settings` route), so nothing it saves survives a reload. **In flight**: another session is wiring Settings/Branches/Warehouses to their mounted routes
- 🟡 Electron shell: window, IPC bridge and `app.fetch()` mount via `window.mezan.fetch` ✅; **auto-update is config-only** (`apps/desktop/src/main/updater.ts:5`, `autoDownload = false`, no check/apply UX) and **restore has no entry point** — backups are scheduled in main (`main/index.ts:54`) but the preload bridge exposes only the fetch and print channels
- ✅ Hono app layer + command/query routing (`packages/api`, `packages/backend`)
- 🟡 LAN multi-till host — `lan-host.ts` and `ConnectedDevicesPanel` exist with tests, but `/lan/*` mounts only when `options.lan` is supplied (`packages/api/src/app.ts:176`) and `createBackend` never supplies it (`/lan/status` 404 live); the panel is not imported by any screen; a real cross-connection SQLite `SQLITE_BUSY` deadlock (confirm flows sharing one on-disk file across ~35 separate connections) has been fixed on `main` via shared `openSqliteConnection`/`withSqliteTransaction`

## Phase 1 — Master data & key pages

- ✅ Items master (types, multi-barcode, image, GL mapping, costing policy, ETA fields)
- ✅ Item categories, brands, seasons
- ✅ Customers master + detail
- ✅ Suppliers master + detail
- ✅ Tax rates (+ ETA subtypes)
- ✅ Chart of Accounts (tree, hierarchy, natural balance)
- ✅ Cost centers (master)
- ✅ Treasury accounts (master)
- ✅ Fiscal periods (master)

## Phase 2 — Ledger & costing engine

- ✅ Double-entry posting engine (balance enforcement, append-only, period gate)
- ✅ Journal entries (list, create, detail, balance badge)
- ✅ WAC costing engine (cost-layer creation, weighted-average recompute)
- ✅ Cost-layer immutability + Cost tab
- ✅ Stock movement ledger
- ✅ Golden-ledger fixture test suite
- ✅ Multi-currency capture on documents

## Phase 3 — Core Sales & Purchases documents

- ✅ Sales Invoices (create/edit, lifecycle, stock deduction + AR posting, effects explainer, detail tabs)
- ⬜ Sales Hub — no hub screen (the reference app's hub pages were unlinked too; see `docs/digest.md`)
- ✅ Purchase Orders (create/edit, confirm/send)
- ✅ Goods Receipts (create-from-PO, confirm)
- ✅ Purchase Invoices (manual + from-receipt, lifecycle, effects explainer)
- ⬜ Purchases Hub — no hub screen (the reference app's hub pages were unlinked too; see `docs/digest.md`)
- ✅ Procurement happy-path integration coverage

## Phase 4 — Inventory operations

- ✅ Stock Balance
- ✅ Stock Transfers (incl. van-warehouse endpoint)
- ✅ Stock Adjustments (8 reasons incl. `INITIAL_STOCK`)
- ✅ Physical Counts
- ✅ Inventory Valuation report + GL reconciliation card
- ✅ Inventory valuation drift detection/rebuild tool
- ✅ Aging-based inventory write-down batch — manual, per-period-idempotent monthly job (`packages/domain/src/inventory/{aging,writedown-run,create-writedown-run,post-writedown-run}.ts`); posts Dr 5060 write-down expense / Cr 1190 contra-asset provision for slow-moving stock via the real GL posting engine, never touching recorded WAC/cost layers; `/inventory/writedown-runs` (`packages/api/src/inventory-writedown-routes.ts`), mounted in `create-backend.ts`; web screen `apps/web/src/screens/WritedownRunsScreen.tsx`
- ✅ Label Printing (3 sizes + barcode-fit validation) — `THERMAL_40x30`/`SHELF_50x25`/`PRODUCT_100x50` presets + `checkBarcodeFit`/`buildLabelBatch` (`packages/domain/src/inventory/{label-template,barcode-fit,label-batch}.ts`, exact message "الباركود لا يناسب هذا القالب"); stateless client-side builder (no persistence, matching the reference screen) — `apps/web/src/screens/LabelPrintingScreen.tsx` renders barcodes via bwip-js and prints through the existing `window.print()`/`@page` pipeline
- ✅ Product Templates (attribute CRUD + variant generator) — attribute add/delete + value add/delete guarded against in-use variants, Cartesian variant/SKU generator creating real `Item`s (`packages/domain/src/inventory/{product-template,create-product-template,template-attributes,generate-variants}.ts`); `/inventory/product-templates` (`packages/api/src/product-templates-routes.ts`); web screen `apps/web/src/screens/ProductTemplatesScreen.tsx`
- ✅ Configurable Products (formulas, sandboxed expression evaluator, waste %)
- ⬜ Inventory Hub + Warehouse detail hub — no hub screens exist; nav goes straight to the list screens
- 🟡 Stock Balance / Transfers / Adjustments / Physical Counts run the real domain **in the browser** (`apps/web/src/store/inventory-ops-store.ts`) against in-memory repositories, and there is no backend counterpart to wire them to: `packages/api/src/app.ts:779-795` mounts `/stock-adjustments`, `/stock-transfers` and `/physical-counts` only when `createBackend` supplies those deps, and it never does — all three return **404 on the running server** (only `/inventory/stock-balance` answers)

## Phase 5 — Full Sales

- ✅ Quotations (lifecycle, send, convert-to-invoice)
- ✅ Sales Returns (create, confirm/cancel, refund-voucher linkage)
- ✅ Price Lists (CRUD + per-item override grid)
- ✅ Promotions (percentage/fixed/special-price, BXGY, bundle, coupon)
- 🟡 Credit control (warn-vs-block) — `packages/api/src/sales-invoices-routes.ts:65` takes an optional `creditControl` dep that `createBackend` never supplies, so the check never fires in the running app
- ✅ Sales invoice profit/margin computation
- ⬜ Delivery notes — open product decision (`docs/backlog.md` §5.2); not scoped as an issue

## Phase 6 — Full Purchases

- ✅ RFQs (CRUD, workflow, supplier invitation/quote comparison) — 🟡 recently mounted, stabilization pass in progress
- ✅ RFQ→PO conversion
- ✅ Purchase Returns (create, confirm/cancel, refund linkage)
- ✅ Landed Costs (document CRUD, distribution by value/quantity, linked-invoices tab)
- ✅ Procurement gates (require-PO-for-GRN, require-GRN-for-invoice, sold-item cancellation guard)
- ✅ Historical purchase invoice/return Excel import — 🟡 recently mounted

## Phase 7 — Treasury completion + Installments

- ✅ Unified voucher (10 types: collection/payment, refunds, other income/expense, capital injection/withdrawal, tax payment, inter-treasury transfer)
- ✅ Invoice allocation / cash application
- ✅ Account statements
- ✅ Cheque Register (7-state lifecycle)
- ✅ Bank statement CSV import + column mapping
- ✅ Bank reconciliation (line matching)
- ✅ Cash-vs-bank negative-balance policy
- ⬜ Treasury Hub — no hub screen (the reference app's hub pages were unlinked too; see `docs/digest.md`)
- ✅ Installment Plans (4 frequencies, down payment, schedule preview) — 🟡 recently mounted
- ✅ Installment overdue batch + late penalties
- ✅ Collection Follow-ups

## Phase 8 — Accounting depth

- ✅ Cost-center full integration + Cost Center P&L
- ✅ Fiscal period close workflow (مفتوحة→مغلقة→مقفلة)
- ✅ Tax groups + Chart-of-Accounts account-linking
- ✅ Exchange rates (CRUD + approval/lock)
- ✅ FX Revaluation (period-end run, auto-reversing JE)
- 🟡 Balance Reconciliation (sub-ledger vs control-account, unlinked entries) — domain + route file exist, but `/reconciliation` is **not mounted** by `createBackend` (404 live); the screen runs in-browser
- ⬜ Accounting Hub — no hub screen (the reference app's hub pages were unlinked too; see `docs/digest.md`)
- ✅ ETA e-invoicing (readiness tracker, config, credentials, code mapping, submission queue)
- ✅ Opening balances for non-treasury GL accounts

## Phase 9 — Reports & printing

- ✅ `ReportDefinition` abstraction
- ✅ Report export pipeline (XLSX + CSV, on every report)
- ✅ GL-reconciliation banner component
- ✅ On-demand execution pattern (General Ledger, Account Ledger)
- ✅ Print rendering engine (A4/A5, React+CSS — `packages/ui/src/print/PrintView.tsx`)
- 🟡 Arabic amount-in-words engine — implemented and tested, but its only consumer is the print-template preview (`apps/web/src/settings/PrintTemplatesPage.tsx:23`); real document prints leave `totals.amountInWords` undefined
- ✅ Sales / Purchases / Inventory / Debt-aging / Installments report packs
- ✅ Trial Balance, Income Statement, Balance Sheet, Cash Flow (indirect), VAT Return
- ✅ General Ledger + Account Ledger report tabs
- ⬜ Sales-by-Salesperson, Van Sales, POS report packs — shell only; real data wiring depends on Phase 14 (POS, deferred)

## Phase 10 — Platform & config

Engine layers landed; most of the admin UIs did not. This is the largest block of overstated status in the previous revision of this file — corrected against the code on 2026-08-23.

- ✅ Workflow/approvals **gate engine** (`packages/domain/src/workflow`, 26 action types) — ⬜ chain-builder UI and `/approvals` inbox: no screen exists
- ✅ Notification Rules **engine + builder + Arabic templating** (`packages/domain/src/notifications`, `/notification-rules` + `/notifications` API, `apps/web/src/settings/NotificationRulesPage.tsx`) — subscribes to the real `EventBus` `createBackend` now instantiates; sales-invoice confirm/void and sales/purchase-return confirm/void publish onto it today, condition (field/operator/value), recipient by permission/role/user, priority, in-app (delivered)/email/push (queued) channels, Arabic title/body templates with `{{customerName}}`/`{{amount}}`/`{{documentNumber}}`
- ✅ Numbering **engine** (`packages/domain/src/numbering`, 25 sequence types) — ⬜ Numbering Sequences admin screen
- ✅ Audit trail **core** (`packages/domain/src/audit`, append-only + severity taxonomy) — ⬜ audit-log UI, not in nav
- 🟡 Print Templates — `apps/web/src/settings/PrintTemplatesPage.tsx` renders a live sample invoice through the shared `PrintView` with real `amountInWords`; the 9-tab designer is ⬜
- ⬜ Barcode Codes config + live test panel — barcode fields exist on items; no config screen
- ⬜ Data Migration wizard — no implementation in any layer
- ✅ Roles & Permissions UI (role CRUD + matrix editor, `pages/RolesPage.tsx`, `PermissionMatrix`)
- ✅ Users screen (CRUD, role assignment, branch/warehouse scoping)
- ✅ Dashboard home (KPI tiles, trend chart, aging widget, activity feed) — real `/dashboard` data
- ✅ Command palette + top-bar search (`packages/ui/src/shell/CommandPalette.tsx`) — 🟡 palette items still come from `sample-data.ts`; ✅ notifications panel (`packages/ui/src/shell/NotificationsPanel.tsx`, wired to real `/notifications` data)
- 🟡 Settings — 4 real tabs (عام / الشركة / الضرائب / السياسات) + Branches + Warehouses + Print preview; the per-domain policy depth (credit-control, inventory-policy, purchase-control, treasury-policy as their own screens) is folded into the one السياسات tab
- ⬜ WAC drift settings panel — the drift **report** exists (`reports/inventory-drift.ts`); the settings panel does not
- ⬜ Profile screen
- ⬜ Branch 360 detail view

## Phase 11 — Manufacturing

- ✅ BOMs (versioned, waste % gross-up)
- ✅ Work Orders (4-stage execution: بدء العمل → صرف المواد → استلام المنتج → إكمال)
- ✅ Work Order WIP cost accumulation + GL posting chain
- ✅ Config Instances (custom manufacturing orders)
- ⬜ Production Dashboard — no screen; work orders and BOMs have list screens only
- 🟡 Recently mounted in the latest merge — stabilization/e2e pass still in progress

## Phase 12 — CRM + Projects + Fixed Assets + Field/Van Sales

- ✅ Leads (6-state lifecycle)
- ✅ Opportunities + Pipeline (kanban) + Pipeline Stages config
- ✅ CRM Activities / My Tasks
- ⬜ CRM Hub — no hub screen
- ✅ Projects (CRUD + status machine + auto cost-center creation)
- ✅ Asset Register + Asset Categories
- ✅ Depreciation Runs (draft→posted, daily IFRS proration)
- ✅ Asset disposal flow
- ⬜ Assets Hub — no hub screen
- ✅ Van Trip (open, stock load, in-field sales/collections, settlement)

## Phase 13 — HR & Payroll — ⬜ Deferred

Not started. All 13 screens deferred by product decision (`docs/backlog.md` §1): employees, departments, job titles, attendance, holidays, contracts, leave requests, leave policies, leave accrual batches, payroll runs, advances, my-leave, shift settings. Payroll calculation-engine internals flagged as the largest specification hole in the whole catalog — needs a dedicated design pass before scoping, whenever this phase is picked up.

## Phase 14 — POS — ⬜ Deferred

Not started. All 16 screens/engines deferred: terminals, payment-method catalog, sessions/shifts, POS sales/refunds ledgers, discount approvals, restaurant mode (tables, kitchen display, reservations, deliveries), loyalty, POS Hub, the **net-new POS selling screen** (no reference implementation exists anywhere — needs a dedicated design spike with a real cashier), barcode-embedded price/weight scan integration, ESC/POS thermal printing, offline sale queue.

## Phase 15 — Cloud/SaaS website edition — ⬜ Deferred

Not started. Postgres dialect + dual-engine conformance suite, cloud JWT + refresh-token auth, Postgres Row-Level Security, `apps/server` as a real hosted multi-tenant server, SSE + Redis realtime fan-out, S3 file storage, subscription→entitlements mapping, tenant onboarding, multi-tenant admin tier, API Keys/Webhooks/WhatsApp integration, email delivery + headless-Chromium PDF generation, cloud backup (PITR, cross-region, per-tenant export). The ports-first architecture is built specifically to make this additive later.

---

## Cross-cutting hardening (not phase-specific)

- 🟡 **Real-data sweep** — 7 `*-sample-data.ts` files still exist (`sample-data.ts`, `accounts-sample-data.ts`, `items-sample-data.ts`, `accounting-treasury-sample-data.ts`, `inventory-ops-sample-data.ts`, `settings/sample-data.ts`, `login/login-sample-data.ts`) with ~20 importers. `sample-data.ts` also still owns the nav registry, command-palette items and demo entitlements, so it cannot simply be deleted — the nav needs its own home first.
- 🟡 **Declared-but-unsupplied API deps** — `packages/api/src/app.ts` declares ~52 optional deps and mounts several route groups conditionally on them; `packages/backend/src/create-backend.ts` is the only place that decides what exists at runtime, and it omits `audit`, `creditControl`, `stockAdjustments`, `stockTransfers`, `physicalCounts`, `reconciliation` and `lan`. Everything behind those is engine-complete, test-covered and unreachable from the running app. A CI assertion over the mounted route list would stop this class of drift recurring.
- 🟡 **Domain-in-browser screens** — 9 screens bypass the API and run `@mezan/domain` against in-memory repositories via `apps/web/src/store/*`: `StockBalance`, `StockTransfers`, `StockAdjustments`, `PhysicalCounts`, `ExchangeRates`, `FxRevaluation`, `CostCenterPnL`, `Reconciliation`, `Eta`. Business rules are real; persistence is not. The matching API routes are already mounted, so this is web wiring only.
- ✅ **SQLite write concurrency** — the cross-connection `SQLITE_BUSY` deadlock in confirm flows (stock issue + GL posting sharing one file across separate connections) is fixed on `main`; ⬜ follow-up: add a regression test exercising concurrent numbering-sequence allocation and LAN multi-till writers.
- 🟡 **Bug-hunt sweep** — active pass looking for functional defects across the app, cross-checked against the known-defects list in `docs/backlog.md` §8 so they aren't silently reintroduced.
- 🟡 **E2E stabilization** — several `test/e2e-*` worktrees mid-flight; needs consolidation into one green, deterministic Playwright suite.
- ⬜ **Open product decisions** (`docs/backlog.md` §5, `docs/plan.md` §6.3) — licensing mechanism finalization, installment late-fee rule, FIFO-in-v1 scope, delivery notes, branch-scoped numbering, lead→opportunity conversion mechanism, projects progress billing (مستخلصات), third locale (German) — none block ongoing development, but each blocks calling its specific issue fully "done."

---

## Live parity re-audit — 2026-08-23

A live side-by-side pass against the reference app (`staging.getzemam.com`) replaced
the earlier documentation-derived audit. Full findings: `docs/coverage-audit.md`.
Headline: **73 of 126 reference screens exist (58%)**; every built screen routes,
renders and has a working save action.

### Fixed in that pass (commit `bf34587`)

- ✅ Session now survives a page refresh (`App`'s `mode` ignored the restored session).
- ✅ The 6 dashboard quick actions navigate (were rendered with no `onClick`).
- ✅ The command palette is generated from the real nav — 84 entries, all navigating
  (was 4 items with `onSelect: () => {}`).
- ✅ A user menu with تسجيل الخروج exists (there was **no logout anywhere** in the app).
- ✅ The notification bell's hardcoded badge of 3 is gone; the count comes from a real
  (empty) list and the bell opens a panel with a truthful empty state.

### Fake surfaces still shipped — must be wired or removed

Branch chip · Branches screen · Warehouses screen · General settings (never PUTs) ·
Trial Balance · the 7 Financial Reports tabs · the 4 inventory-ops screens · the 5
accounting-depth screens · users/roles scope pickers · role-editor entitlements ·
login-screen module chips advertising POS and HR · first-run "استيراد الآن" ·
customer/supplier/branch "قريباً" detail tabs · Print Templates (preview only) ·
the README's "i18n (ar/en)" claim (**there is no i18n layer at all**).

### Newly identified gaps not previously tracked

- ⬜ `/inventory/specifications` — reusable specification/attribute registry
  (name, type, values, unit, filterable-in-catalog). **Not in `docs/catalog/` at all**;
  found live.
- ⬜ `/approvals` — approvals inbox (Inbox / My Requests / My Actions).
- ⬜ `/status` — system status page (per-service health, incident timeline, changelog).
- ⬜ Support tickets — open a ticket, follow the thread, read replies.
- ⬜ Language switcher — blocked on there being no i18n layer.
- ⬜ Working branch and warehouse selectors in the topbar.
- ⬜ `/manufacturing/dashboard` — the `GET /dashboard` route exists; no screen.
- ⬜ 7 missing reports: sales-by-salesperson, van sales, promotions report,
  expiring-soon (FEFO), make-vs-buy, POS daily, POS shifts.

## Open design decisions — not one-line fixes

Two defects found during the platform-admin build that need a decision before a
patch, because each changes a shared contract rather than one call site.

### 1. Workflow `minAmount` is configurable but never read

`/settings/workflow` stores and edits a minimum-amount threshold per gated
action, and the UI presents it as enforced. Nothing reads it at confirm time:
`DocumentWorkflowInput` (the shared type every gated document passes to
`workflow/gate.ts`) carries no amount field, so the gate cannot see the value it
is meant to compare against.

Fixing it means extending that port, which touches **every** gated document type
— sales invoices, sales/purchase returns, landed costs, vouchers. Options:

- **Add an optional `amount` to `DocumentWorkflowInput`.** Smallest change;
  every existing caller keeps compiling, and a document type that omits it simply
  can't be threshold-gated. Risk: silently unenforced for whichever types forget
  to pass it — the same failure we are fixing.
- **Make it required.** Forces every gated type to answer the question, so the
  gap cannot reappear. Costs a change at each call site.
- **Resolve the amount inside the gate** from the document id. Keeps callers
  untouched but gives the gate a repository dependency it does not currently
  have, weakening its purity.

Until this is decided, the threshold field should be labelled as not yet enforced
rather than presented as active.

### 2. The gate expects role codes; two routes pass permission codes

`GateStep.role` is a **role code** — `gate.ts`'s own doc comment, its tests, and
the reference product's role picker all agree. But `sales-invoices-routes.ts` and
`vouchers-routes.ts` pass `ctx.permissions` (the resolved *permission* set) as
`actorRoles`. A role code is never a permission code, so a role-gated step
configured through `/settings/workflow` can only be satisfied by the
company-admin `"*"` bypass through those two handlers.

The approvals endpoints resolve the real role code via `uow.users` → `uow.roles`
and behave correctly, so the two sides currently disagree. Options:

- **Fix the two routes** to resolve the actor's role before calling the gate.
  Keeps gate semantics as documented; the approvals endpoints already prove the
  lookup path.
- **Let the gate accept either**, matching a step against roles *or*
  permissions. More permissive and needs no route change, but it broadens the
  meaning of every existing gate configuration.

The first is the smaller blast radius and matches what the type already claims.

## Merge reconciliation with main — what was dropped (2026-08-23)

Two teams built overlapping features in parallel. Merging `main` into
`integrate/tang-into-main` produced 64 conflicts, five of which were the *same
feature built twice with incompatible shapes*. Main's implementation won each
time — 36 commits of other work already depend on it, and in-tree tests assert
its exact route names and identifiers. The following capabilities existed on the
branch and are **not** in the merged result. Each is a real regression against
what was verified working, and each should be re-applied on top of main's shape:

- ⬜ **Item specifications registry** (`/item-specifications`) — the reusable
  attribute registry (name, type, values/unit, filterable-in-catalog). This was
  found by live inspection of the reference app and is **documented nowhere in
  `docs/catalog/`**, so it is a genuine parity gap that is now re-opened. Main's
  item-catalog has no equivalent.
- ⬜ **Notification trigger catalog** (`/notifications/triggers`) — enumerated all
  39 catalogued events and flagged which 9 this build actually emits, so a tenant
  could not configure a rule that could never fire. Main's notifications module
  has no trigger discovery surface.
- ⬜ **Item unit conversion** — `factor` / `baseUnitCode` on units, so an
  alternate unit converts to its base. Main's unit shape is code + status only.
- ⬜ **Delete-in-use guards** on units and categories — ours refused to delete a
  row still referenced by an item (`409 ITEM_UNIT_IN_USE, "referenced by 4
  record(s)"`). Without them a referenced unit can be deleted out from under
  existing items.

Kept from the branch as pure additions (no collision): numbering sequences, the
audit query surface, API keys, webhooks, profile self-service, barcode config,
label layouts, the financial-statement report family, physical-count variance,
the test-only demo seeder, and `pnpm smoke`.

Also fixed during the merge: `DEFAULT_ACTIVE_MODULES` listed `"cheques"`, but
`module-licensing.ts` maps that catalog module onto the entitlement id
`financial_papers` — so every cheque permission was silently ungrantable. And
`"hr"` is retained, because main now genuinely ships an HR module; the earlier
reasoning for removing it no longer holds.
