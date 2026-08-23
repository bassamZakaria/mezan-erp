# Mezan — Build Status (2026-08-23)

All work is LOCAL on branch `main` (nothing pushed to GitHub yet). ~2349 tests. v1 = Electron desktop, SQLite, real data (no mocks).

## Branch model (3 branches)
- `main` — 1:1 parity with the reference app (build target).
- `ui-enhancements` (off main) — UI/product-design enhancements only (UX spec + enhanced mockup).
- `feature-enhancements` (off ui-enhancements) — beyond-parity features/workflows: 28 stakeholder requirements, 17 workflows, 13-competitor market analysis, business/UX + tech stakeholder meeting panels.

## ✅ Built & merged to main
Foundations (monorepo/CI, Money/Qty scaled-int, numbering[25], audit, event bus, permissions[268], workflow gate[26], Ed25519 module licensing, LAN multi-till, Electron shell + backup/restore, RTL design system + primitives).
Master data: items, customers, suppliers, chart of accounts, users/roles, taxes, cost centers, treasury accounts, fiscal periods.
Engines: GL posting (double-entry, period gate), WAC costing + stock ledger, generic document framework, report engine, print pipeline (+ Arabic amount-in-words).
Documents: journal entries, sales invoices, purchase chain (PO/GRN/invoice), treasury vouchers (10 types + allocation), sales/purchase returns, landed costs, installments.
Inventory ops: stock adjustments/transfers/physical counts/balance, label printing, product templates, aging write-down.
Full sales: quotes, price lists, promotions/coupons, credit control.
Full purchases: RFQ, strictness gates, historical import (purchases + sales).
Treasury completion: cheque register (7-state), bank reconciliation.
Reports: financial statements (7, computed from REAL posted GL), operational reports.
Accounting depth: cost-center P&L, exchange rates + FX revaluation (auto-reverse), balance reconciliation, ETA e-invoicing queue.
Manufacturing: BOMs, work orders (4-stage), configurable products.
CRM + projects + fixed assets + field/van sales.
Notifications: rules engine + builder + top-bar panel.
Print-template 9-tab designer + 13-step data-migration wizard.
Workflow chain-builder + approvals inbox.
HR master-data: employees, departments, job titles, contracts, holidays, HR dashboard, my-leave.
Cross-cutting: real-data wiring complete (no sample-data screens), session persistence, slide-over a11y (inert), audit sink wired into GL/document flows at runtime, SQLite shared-connection fix (clean fresh-DB boot, no SQLITE_BUSY on confirm), hooks.ts workflow-DTO import fix.

## 🟡 Built, on branches, NOT merged (preserved, paused)
- `w8/settings-admin` (+1 commit): numbering-sequences admin, audit-log UI, embedded-barcode config + test panel, WAC-drift settings panel.
- `hr/time-leave` (+9 commits): attendance, leave requests, leave policies, leave accrual batches. (HR intentionally paused.)

## ⬜ Known gaps to handle next (from docs/tasks-audit.md)
- Domain hub screens (Sales/Purchases/Inventory/Treasury/Accounting/CRM/Assets) + warehouse detail hub.
- Profile screen; Branch-360 detail view.
- Item categories/brands/seasons domain module (currently hardcoded).
- Sales-invoice profit/margin computation.
- Customer/supplier account statements (currently stub tabs).
- Non-treasury GL opening balances (currently zero-stubbed).
- Asset disposal flow (enum only, no transition/API/UI).
- Report packs that depend on deferred POS (Sales-by-salesperson, Van, POS daily/shift).
- i18n / language switching — built on another session's branch (`bassamZakaria/fix-language-switcher`), pending merge; then wire `settings.language` → LocaleProvider `tenantDefault` in apps/web/src/data/AppProviders.tsx; remove the dead "اتجاه الواجهة" direction combobox.
- Merge decision pending for `w8/settings-admin` and `hr/time-leave`.

## ⬜ Deferred (planned in docs/deferred-plan.md)
HR payroll completion (Egyptian labour law); POS (incl. net-new offline selling screen); Cloud/SaaS website edition (add Postgres + dual-engine conformance, cloud JWT auth + RLS, Node server, SSE+Redis realtime, S3, subscription→entitlements).

## Open product decisions (need the owner)
Licensing commercial term (perpetual+maintenance vs annual); ETA offline posture (require periodic connectivity / cloud-only / acknowledged-offline queue); delivery notes (fill vs match); FIFO-in-v1; installment late-fee rule; branch-scoped numbering; third locale (German); projects progress-billing.

## Reference docs
docs/plan.md (build plan), docs/backlog.md (233-issue backlog), docs/tasks.md (checklist), docs/tasks-audit.md (✅-vs-code audit), docs/coverage-audit.md (parity audit), docs/deferred-plan.md, docs/execution-plan.md, docs/web-data-wiring.md, docs/enhancements/* (on feature-enhancements branch).
