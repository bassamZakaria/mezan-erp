# Mezan ERP — Coverage / Parity Audit vs. the Reference App (live pass)

**Date:** 2026-08-23 · **Base:** `main` @ `74a30f1` · **Author:** Bassam Zakaria
**Supersedes:** `coverage-audit-2026-08-23-static.md` (documentation-derived; already
stale on the inventory-ops and financial-statement screens).

**Method — live, both apps side by side in one Chrome tab group:**

- Reference (`staging.getzemam.com`), already-authenticated session. Every sidebar
  group was expanded and the full `<a href>` set read out of the rendered nav —
  **112 nav-addressable routes**. Strictly read-only: no form was submitted.
- Mezan (`127.0.0.1:5183` — `pnpm server` + Vite against a freshly seeded SQLite DB,
  admin محمد الشهابي / PIN 1234). Every one of its **69 nav buttons plus the 6
  settings entries** was clicked in turn; for each screen the rendered `<main>` was
  inspected for heading, every button label, "قريباً" stubs, error states, and
  whether the create flow exposes a commit/save action.
- The `docs/catalog/01..10` census (125 screens) was used only to name the
  reference's screens that are real but unlinked from its own sidebar.

---

## 0. Headline

> ## Screen parity: **58%** — 73 of 126 reference screens exist in Mezan

| Axis | Mezan | Reference | Gap |
|---|---|---|---|
| Sidebar-addressable screens | 75 | 112 | **39 missing** |
| Real-but-unlinked screens (8 hubs, profile, API keys, webhooks, WhatsApp, my-leave, POS sell) | 0 | 14 | **14 missing** |
| Reports in the nav | 18 | 25 | **7 missing** |
| Total known screens | 76 | 126 | **53 missing** |

**Verdict:** the accounting, costing and document engines are at or near parity, and
every built screen is reachable and renders without error — but **two whole domains
(POS, HR) and the entire platform-administration surface** (approvals inbox, workflow
config, notification rules, sequences, barcode, data migration, API keys, webhooks,
profile, status, support) do not exist, and **nine built screens still run on
in-browser demo data** rather than the API.

---

## 1. What the live pass proved works

- All 75 nav entries route; there is no dead "قريباً" nav placeholder left.
- No screen threw an error or hit an error boundary on an empty tenant.
- Every create/edit surface exposes a commit action — either a `<SidePanel>` footer
  button or a full-page `mode="create"` submit. **No modal, page or section is
  missing its save button** (39 side-panel screens + 8 full-page create screens
  checked). The one inconsistency is naming: the confirm button is variously
  "حفظ …", "إضافة …", "إنشاء …", "تسجيل …" or "بدء …" across screens.
- Login, PIN entry, seeded-admin auth, theme toggle, sidebar grouping, filter chips,
  KPI strips, pagination and the RTL logical-CSS rule all behave correctly.

## 2. Defects found live — fixed in this pass (commit `bf34587`)

| # | Defect | Evidence |
|---|---|---|
| 1 | **Page refresh silently logged the user out.** `mezan.session` was persisted and restored by `ApiProvider`, but `App`'s `mode` always initialised to `"login"`. | Reloaded `/` → login screen, with a valid `mezan.session` in localStorage |
| 2 | **All 6 dashboard quick actions were dead** (فاتورة جديدة, سند نقدي, استلام بضاعة, فاتورة مشتريات جديدة, أمر شراء جديد, عرض سعر) — rendered with no `onClick`. | `DashboardScreen.tsx:77`; clicking changed nothing |
| 3 | **All 4 command-palette entries were dead** — `commandItems` ended in `.map(item => ({ ...item, onSelect: () => {} }))`. | `sample-data.ts:176`; selecting "دليل الحسابات" just closed the palette |
| 4 | **No way to sign out.** The topbar user chip had no menu, and no logout existed anywhere in the app. | `Topbar.tsx:103` — a plain `<button>` with no handler |
| 5 | **Fake notification badge.** `notificationCount={3}` was hardcoded with nothing behind it, and the bell opened nothing. | `App.tsx:345`, `Topbar.tsx:93` |

Fixes: session restore now honours the persisted session; a small `NavigationContext`
wires the dashboard actions; the command palette is generated from the real nav tree
(84 entries, all navigating); the user chip opens a menu with تسجيل الخروج that
clears the session; the bell count derives from a real (currently empty)
`notifications` list and opens a panel with a truthful empty state.

## 3. Fake / placeholder surfaces still in the app

Everything below renders convincingly but is **not backed by the API**. Each must be
wired or removed before this is demonstrated as a working product.

| Surface | What is fake | Where |
|---|---|---|
| Branch chip "الفرع الرئيسي" | Static string — not a selector, scopes nothing | `App.tsx:344` |
| Warehouse selector | Absent entirely (the reference has one next to the branch selector) | — |
| Branches screen | Whole screen on `settings/sample-data.ts`; branch detail invents treasury balances (`CASH-002 … ٣٣٨٫٠٠`) | `settings/BranchesPage.tsx` |
| Warehouses screen | Whole screen on `sampleWarehouses` with an in-memory `nextId` | `settings/WarehousesPage.tsx` |
| General settings | Edits live in local state; "حفظ الإعدادات" validates but never PUTs | `settings/SettingsGeneral.tsx` |
| Trial Balance report | Runs over `sampleReportAccounts` / `sampleReportJournalEntries`, not the posted ledger | `screens/TrialBalanceReportScreen.tsx` |
| Financial Reports (7 tabs) | Runs over `financialStatementAccounts` / `financialStatementEntries` | `screens/FinancialReportsScreen.tsx` |
| Stock Balance / Transfers / Adjustments / Physical Counts | Real domain logic executed in-browser over `store/inventory-ops-store.ts`; nothing persists | 4 screens |
| Exchange Rates / FX Revaluation / Reconciliation / Cost-Center P&L / ETA | Same pattern via `store/accounting-depth-store.ts` | 5 screens |
| Users/roles branch + warehouse scope pickers | Fed by `demoBranches` / `demoWarehouses` / `demoEmployees` | `App.tsx:233` |
| Role-editor entitlements | `demoEntitlements` lists POS + HR as licensed modules that do not exist | `sample-data.ts:233` |
| Login screen module chips | Advertise نقاط البيع and الموارد البشرية as licensed | `login/LoginScreen.tsx` |
| First-run wizard "استيراد الآن" | Disabled button + "قريباً" pill | `login/FirstRunWizard.tsx:281` |
| Customer / Supplier detail tabs | الفواتير / كشف حساب / المرفقات are "قريباً" stubs | `CustomersScreen.tsx:38`, `SuppliersScreen.tsx:34` |
| Branch detail tabs | Inventory / Employees / Assets / Activity are "قريباً" stubs | `settings/BranchesPage.tsx:20` |
| Print Templates | A preview of one default template; no designer, no save | `settings/PrintTemplatesPage.tsx` |
| README's "i18n (ar/en)" claim | **There is no i18n layer at all** — `lang` is hardcoded to `ar` and every string is an inline Arabic literal | `main.tsx:11` |

## 4. Missing screens (53)

### 4.1 POS — 10 screens, zero layers built
`/pos/terminals`, `/pos/sessions`, `/pos/sales`, `/pos/refunds`, `/pos/kitchen`,
`/pos/tables`, `/pos/deliveries`, `/pos/discount-approvals`, `/pos/reservations`,
`/pos/hub`. (`/pos/sell` is not on web in the reference either.) No domain module,
routes, persistence or schema — `pos` exists only as a licence module id.

### 4.2 HR & Payroll — 14 screens, zero layers built
`/hr/dashboard`, `/hr/employees`, `/hr/departments`, `/hr/job-titles`,
`/hr/attendance`, `/hr/holidays`, `/hr/contracts`, `/hr/leave/requests`,
`/hr/payroll`, `/hr/advances`, `/hr/leave/batches`, `/settings/leave-policies`,
`/hr/my-leave`, plus the HR half of `/settings/shifts`. A full `hr.*` permission set
already exists and gates nothing.

### 4.3 Platform administration — 11 screens
`/approvals` (Inbox / My Requests / My Actions), `/settings/workflow`,
`/notifications/rules`, `/settings/sequences` (the reference lists 25 sequence
types), `/settings/barcode`, `/settings/data-migration`, `/settings/profile`,
`/settings/api-keys`, `/settings/webhooks`, `/settings/whatsapp`, `/settings/shifts`.
Approvals, numbering and audit engines exist in `packages/domain`; the
notification-rules engine does not.

### 4.4 Inventory — 3 screens
`/inventory/product-templates` (variant/SKU generator), `/inventory/labels` (label &
barcode printing), and **`/inventory/specifications`** — a reusable
specification/attribute registry (name, type, values, unit, "filterable in catalog")
that is **not documented anywhere in `docs/catalog/`**; found live in this pass.

### 4.5 Reports — 7 missing
Sales by salesperson · Van sales · Promotions report · Inventory expiring-soon (FEFO)
· Make-vs-buy · POS daily summary · POS shift reports.

### 4.6 Domain hubs — 8 screens
`/sales/hub`, `/purchases/hub`, `/inventory/hub`, `/accounting/hub`, `/treasury/hub`,
`/crm/hub`, `/assets/hub`, `/pos/hub`. Unlinked from the reference's own sidebar.

### 4.7 Shell surfaces the reference has and Mezan does not
- **Language switcher** — needs a full i18n layer first (§3).
- **System status page** (`/status`) — per-service health, incident timeline,
  "what's new" changelog.
- **Support tickets** — open a ticket, follow the thread, read replies.
- **Working branch and warehouse selectors** in the topbar.
- **Manufacturing production dashboard** (`/manufacturing/dashboard`) — the
  `GET /dashboard` route exists; there is no screen.
- **Audit-log viewer** — sink and domain exist; no read API, no screen.

## 5. Business-rule gaps behind the screens

Re-confirmed at code level:

- **Withholding tax** — no model anywhere.
- **Promotions & price lists** — the engines compute correctly but are never applied
  to or persisted on confirmed documents; `resolvePrice` is never called during line
  building.
- **Journal-entry `pending` approval** — the status is declared but no submit/approve
  transition or route exists; `workflow/gate.ts` is not applied to journals.
- **Per-supplier payable subledger / statement** — AP is tracked at GL-account level
  only.
- **Physical-count variance → auto-adjustment** — the reason code exists; the
  system-vs-counted variance engine does not.
- **Projects** — master data, budget and an auto `PRJ-` cost centre only; no cost or
  revenue rollup, no document linkage.
- **Notification rules** — only an event bus, no rules engine.

## 6. Build order to reach parity

1. **Truthfulness sweep** (days) — wire the 9 demo-store screens plus Settings,
   Branches and Warehouses to the API; run Trial Balance and the 7 financial
   statements over the live posted ledger; make the branch/warehouse chips real
   selectors or drop them; stop advertising POS and HR as licensed.
2. **Platform administration** (1–2 weeks) — approvals inbox, workflow config,
   numbering sequences, audit viewer, data-migration wizard, profile. Mostly UI over
   engines that already exist.
3. **Inventory completion** — product templates, specifications, label printing,
   physical-count variance engine.
4. **Reports** — the 5 non-POS missing reports (POS reports wait on POS).
5. **Rule gaps** — withholding tax, promotions/price-list application, JE approval,
   supplier statement.
6. **i18n layer + language switcher** — prerequisite for the EN edition; large,
   touches every screen.
7. **HR & Payroll** — greenfield domain.
8. **POS** — greenfield domain; the selling screen has no web reference to copy.
9. **Hubs, status page, support tickets** — lowest priority.
