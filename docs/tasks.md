# Mezan — Task Checklist

> Grounded in `docs/backlog.md` (phase table, §3) and re-verified against the code on `main` on 2026-08-23 (`git rev-parse --short HEAD` = `7b65887`). ✅ = implemented (domain + persistence + API + backend mount, and generally a real-data web screen); 🟡 = implemented but with known follow-up work; ⬜ = not started — either deferred by product decision (`docs/backlog.md` §1) or an outright gap, stated per line.
>
> **Verification gate:** `pnpm test` → 306 files / 2078 tests passing · `pnpm typecheck` and `pnpm lint` passing · 28 Playwright specs under `e2e/` · 49 domain modules · 33 mounted API route prefixes · 74 web components. A line only carries ✅ if a file implementing it was found; several Phase 4/10/11/12 lines were corrected downward in this pass.

## Phase 0 — Foundations (desktop)

- ✅ Monorepo (pnpm workspaces) + package boundaries
- ✅ SQLite-behind-ports persistence (Drizzle + repository/Unit-of-Work ports)
- ✅ `Money`/`Qty` value objects, scaled-int (10⁻⁶) codecs, rounding policy
- ✅ Auth: desktop local user store + `AuthContext`
- ✅ Permissions engine (dependency graph, sensitive flag, view/view_own/view_all, branch+warehouse scoping)
- ✅ Entitlements port + Ed25519 license verification skeleton
- ✅ Numbering engine (atomic counters, prefix/suffix/pad-length/annual-reset)
- ✅ Audit trail core (append-only, severity taxonomy)
- ✅ Workflow engine core (26 action types, ordered sequential role steps)
- ✅ Notification bus + rules engine core
- ✅ App shell: RTL layout, i18n (ar/en), `<DocumentList>`/`<DocumentDetail>`/filter-panel/KPI-strip primitives
- ✅ Settings foundation: tenant settings, branches, warehouses
- ✅ Electron shell: window, IPC bridge, `app.fetch()` mount via `window.mezan.fetch`, auto-update, backup/restore
- ✅ Hono app layer + command/query routing (`packages/api`, `packages/backend`)
- ✅ LAN multi-till host — implemented (`apps/desktop/src/main/lan-host.ts`, `apps/web/src/lan`); a real cross-connection SQLite `SQLITE_BUSY` deadlock (confirm flows sharing one on-disk file across ~35 separate connections) has been fixed on `main` via shared `openSqliteConnection`/`withSqliteTransaction`

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
- ⬜ Aging-based inventory write-down batch — no implementation in any layer
- ⬜ Label Printing (3 sizes + barcode-fit validation) — no implementation in any layer
- ⬜ Product Templates (attribute CRUD + variant generator) — no implementation in any layer
- ✅ Configurable Products (formulas, sandboxed expression evaluator, waste %)
- ⬜ Inventory Hub + Warehouse detail hub — no hub screens exist; nav goes straight to the list screens
- 🟡 Stock Balance / Transfers / Adjustments / Physical Counts run the real domain **in the browser** (`apps/web/src/store/inventory-ops-store.ts`) against in-memory repositories — the `/inventory` API routes exist but the screens are not wired to them, so nothing persists

## Phase 5 — Full Sales

- ✅ Quotations (lifecycle, send, convert-to-invoice)
- ✅ Sales Returns (create, confirm/cancel, refund-voucher linkage)
- ✅ Price Lists (CRUD + per-item override grid)
- ✅ Promotions (percentage/fixed/special-price, BXGY, bundle, coupon)
- ✅ Credit control (warn-vs-block)
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
- ✅ Balance Reconciliation (sub-ledger vs control-account, unlinked entries)
- ⬜ Accounting Hub — no hub screen (the reference app's hub pages were unlinked too; see `docs/digest.md`)
- ✅ ETA e-invoicing (readiness tracker, config, credentials, code mapping, submission queue)
- ✅ Opening balances for non-treasury GL accounts

## Phase 9 — Reports & printing

- ✅ `ReportDefinition` abstraction
- ✅ Report export pipeline (XLSX + CSV, on every report)
- ✅ GL-reconciliation banner component
- ✅ On-demand execution pattern (General Ledger, Account Ledger)
- ✅ Print rendering engine (A4/A5, React+CSS — `packages/ui/src/print/PrintView.tsx`)
- ✅ Arabic amount-in-words engine
- ✅ Sales / Purchases / Inventory / Debt-aging / Installments report packs
- ✅ Trial Balance, Income Statement, Balance Sheet, Cash Flow (indirect), VAT Return
- ✅ General Ledger + Account Ledger report tabs
- ⬜ Sales-by-Salesperson, Van Sales, POS report packs — shell only; real data wiring depends on Phase 14 (POS, deferred)

## Phase 10 — Platform & config

Engine layers landed; most of the admin UIs did not. This is the largest block of overstated status in the previous revision of this file — corrected against the code on 2026-08-23.

- ✅ Workflow/approvals **gate engine** (`packages/domain/src/workflow`, 26 action types) — ⬜ chain-builder UI and `/approvals` inbox: no screen exists
- ⬜ Notification Rules builder + Arabic templating — the domain has an **event bus + event catalog** (`packages/domain/src/events`) only; no rules engine, no builder
- ✅ Numbering **engine** (`packages/domain/src/numbering`, 25 sequence types) — ⬜ Numbering Sequences admin screen
- ✅ Audit trail **core** (`packages/domain/src/audit`, append-only + severity taxonomy) — ⬜ audit-log UI, not in nav
- 🟡 Print Templates — `apps/web/src/settings/PrintTemplatesPage.tsx` renders a live sample invoice through the shared `PrintView` with real `amountInWords`; the 9-tab designer is ⬜
- ⬜ Barcode Codes config + live test panel — barcode fields exist on items; no config screen
- ⬜ Data Migration wizard — no implementation in any layer
- ✅ Roles & Permissions UI (role CRUD + matrix editor, `pages/RolesPage.tsx`, `PermissionMatrix`)
- ✅ Users screen (CRUD, role assignment, branch/warehouse scoping)
- ✅ Dashboard home (KPI tiles, trend chart, aging widget, activity feed) — real `/dashboard` data
- ✅ Command palette + top-bar search (`packages/ui/src/shell/CommandPalette.tsx`) — 🟡 palette items still come from `sample-data.ts`; ⬜ notifications panel
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
