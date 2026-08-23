# Mezan — Task Checklist

> Grounded in `docs/backlog.md` (phase table, §3) and the actual state of the repo as of 2026-08-23 (see `docs/plan.md` §"Build status"). ✅ = implemented (domain + persistence + API + backend mount, and generally a real-data web screen); 🟡 = implemented but with known follow-up work; ⬜ = not started (deferred by product decision, per `docs/backlog.md` §1).

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
- 🟡 LAN multi-till host — implemented (`apps/desktop/src/main/lan-host.ts`, `apps/web/src/lan`), concurrency hardening under the `fix/sqlite-concurrency` branch

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
- ✅ Sales Hub
- ✅ Purchase Orders (create/edit, confirm/send)
- ✅ Goods Receipts (create-from-PO, confirm)
- ✅ Purchase Invoices (manual + from-receipt, lifecycle, effects explainer)
- ✅ Purchases Hub
- ✅ Procurement happy-path integration coverage

## Phase 4 — Inventory operations

- ✅ Stock Balance
- ✅ Stock Transfers (incl. van-warehouse endpoint)
- ✅ Stock Adjustments (8 reasons incl. `INITIAL_STOCK`)
- ✅ Physical Counts
- ✅ Inventory Valuation report + GL reconciliation card
- ✅ Inventory valuation drift detection/rebuild tool
- ✅ Aging-based inventory write-down batch
- ✅ Label Printing (3 sizes + barcode-fit validation)
- ✅ Product Templates (attribute CRUD + variant generator)
- ✅ Configurable Products (formulas, sandboxed expression evaluator, waste %)
- ✅ Inventory Hub + Warehouse detail hub

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
- ✅ Treasury Hub
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
- ✅ Accounting Hub
- ✅ ETA e-invoicing (readiness tracker, config, credentials, code mapping, submission queue)
- ✅ Opening balances for non-treasury GL accounts

## Phase 9 — Reports & printing

- ✅ `ReportDefinition` abstraction
- ✅ Report export pipeline (XLSX + CSV, on every report)
- ✅ GL-reconciliation banner component
- ✅ On-demand execution pattern (General Ledger, Account Ledger)
- ✅ Print rendering engine (A4/A5, React+CSS)
- ✅ Arabic amount-in-words engine
- ✅ Sales / Purchases / Inventory / Debt-aging / Installments report packs
- ✅ Trial Balance, Income Statement, Balance Sheet, Cash Flow (indirect), VAT Return
- ✅ General Ledger + Account Ledger report tabs
- ⬜ Sales-by-Salesperson, Van Sales, POS report packs — shell only; real data wiring depends on Phase 14 (POS, deferred)

## Phase 10 — Platform & config

- ✅ Workflow/Approvals chain builder UI + `/approvals` inbox
- ✅ Notification Rules builder + Arabic templating
- ✅ Numbering Sequences admin screen
- ✅ Print Templates 9-tab designer
- ✅ Barcode Codes config + live test panel
- ✅ Data Migration wizard (framework + entity-import steps)
- ✅ Audit log UI, linked into nav
- ✅ Roles & Permissions UI (role CRUD + matrix editor)
- ✅ Users screen (CRUD, role assignment, branch/warehouse scoping)
- ✅ Dashboard home (KPI tiles, trend chart, aging widget)
- ✅ Global UX: command palette, top-bar search, notifications panel
- ✅ Settings depth (credit-control, inventory-policy, purchase-control, treasury-policy tabs)
- ✅ WAC drift settings panel
- ✅ Profile screen
- ✅ Branch 360 detail view

## Phase 11 — Manufacturing

- ✅ BOMs (versioned, waste % gross-up)
- ✅ Work Orders (4-stage execution: بدء العمل → صرف المواد → استلام المنتج → إكمال)
- ✅ Work Order WIP cost accumulation + GL posting chain
- ✅ Config Instances (custom manufacturing orders)
- ✅ Production Dashboard
- 🟡 Recently mounted in the latest merge — stabilization/e2e pass still in progress

## Phase 12 — CRM + Projects + Fixed Assets + Field/Van Sales

- ✅ Leads (6-state lifecycle)
- ✅ Opportunities + Pipeline (kanban) + Pipeline Stages config
- ✅ CRM Activities / My Tasks
- ✅ CRM Hub
- ✅ Projects (CRUD + status machine + auto cost-center creation)
- ✅ Asset Register + Asset Categories
- ✅ Depreciation Runs (draft→posted, daily IFRS proration)
- ✅ Asset disposal flow
- ✅ Assets Hub
- ✅ Van Trip (open, stock load, in-field sales/collections, settlement)

## Phase 13 — HR & Payroll — ⬜ Deferred

Not started. All 13 screens deferred by product decision (`docs/backlog.md` §1): employees, departments, job titles, attendance, holidays, contracts, leave requests, leave policies, leave accrual batches, payroll runs, advances, my-leave, shift settings. Payroll calculation-engine internals flagged as the largest specification hole in the whole catalog — needs a dedicated design pass before scoping, whenever this phase is picked up.

## Phase 14 — POS — ⬜ Deferred

Not started. All 16 screens/engines deferred: terminals, payment-method catalog, sessions/shifts, POS sales/refunds ledgers, discount approvals, restaurant mode (tables, kitchen display, reservations, deliveries), loyalty, POS Hub, the **net-new POS selling screen** (no reference implementation exists anywhere — needs a dedicated design spike with a real cashier), barcode-embedded price/weight scan integration, ESC/POS thermal printing, offline sale queue.

## Phase 15 — Cloud/SaaS website edition — ⬜ Deferred

Not started. Postgres dialect + dual-engine conformance suite, cloud JWT + refresh-token auth, Postgres Row-Level Security, `apps/server` as a real hosted multi-tenant server, SSE + Redis realtime fan-out, S3 file storage, subscription→entitlements mapping, tenant onboarding, multi-tenant admin tier, API Keys/Webhooks/WhatsApp integration, email delivery + headless-Chromium PDF generation, cloud backup (PITR, cross-region, per-tenant export). The ports-first architecture is built specifically to make this additive later.

---

## Cross-cutting hardening (not phase-specific)

- 🟡 **Real-data sweep** — retire the last `*-sample-data.ts` files (`apps/web/src/sample-data.ts`, `accounts-sample-data.ts`, `items-sample-data.ts`, `accounting-treasury-sample-data.ts`, `settings/sample-data.ts`, `login/login-sample-data.ts`) and confirm every screen is real-data-driven per `docs/web-data-wiring.md`.
- 🟡 **SQLite write concurrency** — active fix branch (`fix/sqlite-concurrency`) hardening concurrent-writer correctness ahead of LAN multi-till going live.
- 🟡 **Bug-hunt sweep** — active pass looking for functional defects across the app, cross-checked against the known-defects list in `docs/backlog.md` §8 so they aren't silently reintroduced.
- 🟡 **E2E stabilization** — several `test/e2e-*` worktrees mid-flight; needs consolidation into one green, deterministic Playwright suite.
- ⬜ **Open product decisions** (`docs/backlog.md` §5, `docs/plan.md` §6.3) — licensing mechanism finalization, installment late-fee rule, FIFO-in-v1 scope, delivery notes, branch-scoped numbering, lead→opportunity conversion mechanism, projects progress billing (مستخلصات), third locale (German) — none block ongoing development, but each blocks calling its specific issue fully "done."
