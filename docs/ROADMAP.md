# Mezan — roadmap: what is built, what is next, and everything still on the list

**The single roadmap document.** It holds what used to sit in four files — the status
record, the work list, the defect register and the decision register — because they only
ever made sense read together: a task is open *because* a defect is open, or *because* a
decision has not been taken.

Companion: `TESTING.md` — the testing policy, the regression plan, and all 1,686 scenarios.
`archive/plan.md` is the durable reference underneath both: architecture (§1–§3), the market and
competitor study (§8), and the deferred HR/POS/Cloud build plans (§9).

**Updated 2026-08-29.** v1 = Electron desktop, SQLite, real data, Arabic-first.

## How to use this file

- **§2 is what exists.** It is measured against the running app, not against a checklist.
  If this file and the app disagree, the app wins and this file is corrected in the same pass.
- **An item is ticked only when it has been driven in the running app on seeded data, in
  both locales (ar/RTL and en/LTR) and both themes.** A green test is not a tick.
- **§5 is read before every test run** and updated in the same commit as any fix. A defect
  is never deleted; it moves to fixed, because that is how its regression is recognised.
- **§6 is what is waiting on a human.** A defect has a right answer; a decision has two or
  more defensible ones, and each changes a shared contract, so it is not a one-line patch.
  Taking one means recording the option chosen and why — not deleting the row.

## Contents

| § | Section |
|---|---|
| 1 | Where the work stands |
| 2 | Done — the product as it stands, and the parity list item by item |
| 3 | Open now |
| 4 | Deferred by decision |
| 5 | Defects |
| 6 | Decisions waiting on a human |
| 7 | Beyond parity — the enhancement backlog (E1–E3) |
| 8 | Shell follow-ups |

---

# 1. Where the work stands

| Track | State |
|---|---|
| **Parity (§2.2, P0–P6)** | Complete but for one cluster — row menus on 17 read-only surfaces, which is a question rather than a backlog item |
| **Open now (§3)** | Two items: those row menus, and outbound notification delivery |
| **Deferred by decision (§4)** | POS, statutory payroll, HR depth, cloud — not scheduled, not defects |
| **Defects (§5)** | None open. D65 closed by `d3294fc`; D1–D64 were already closed. `pnpm scenarios` measured 3876/0 on 2026-08-29 |
| **Decisions (§6)** | Six open (DEC-2 … DEC-7), each blocking its own issue rather than the build |
| **Beyond parity (§7)** | 27 candidates across E1–E3, none started; `enhancements` branch only |
| **Shell follow-ups (§8)** | 8 items, queued behind the i18n sweep |

## 1.1 Signals

| Signal | Value | Measured |
|---|---|---|
| Nav destinations | **115** | 2026-08-29, from `nav-config.tsx` |
| Routable screens | **116** | 2026-08-29, from `App.tsx`'s `ROUTABLE_SCREENS` |
| Read surfaces answering `pnpm smoke` | **199** | 2026-08-29, run green |
| «قريباً» placeholders outside HR | **0** | 2026-08-27 |
| Reference screens still absent | ~14, all POS or POS-adjacent | 2026-08-26 audit |
| `pnpm scenarios` | **3,856 passing, 20 failing** — the 20 are D65, and identical on `origin/main`, so nothing this pass caused them | 2026-08-29 |
| The four ledger invariants | all at exactly zero — trial balance, inventory vs GL 1200, AP vs GL 2100, AR vs GL 1105 | 2026-08-27 |
| Typecheck · lint · RTL · native controls · permission labels · theme colour-only | all passing | 2026-08-29 |
| `pnpm smoke` | 199 read surfaces, all responded | 2026-08-29 |
| Contrast sweep, 13 screens × 2 themes | 0 failures, 0 horizontal overflow | 2026-08-27 |
| Business-logic unit tests | disabled by decision — `TESTING.md` §1 | 2026-08-23 |

## 1.2 How anything is verified

Automated business-logic tests are off. Proof is:

1. **`pnpm smoke`** — boots the real backend, runs the demo seed, hits every read surface.
   Catches an unmounted route, which is the failure mode that has bitten this codebase
   repeatedly.
2. **`pnpm typecheck` and `pnpm lint`** — including the RTL logical-CSS rule, and a
   colour-token rule that fails when a Tailwind colour class names a token that does not
   exist. Such a class emits no CSS at all and the element silently inherits, so it passes
   every other gate; it once shipped an unreadable active tab at 1.52:1.
3. **`pnpm scenarios`** — boots a seeded backend in-process and drives the same HTTP routes
   the UI calls, bracketing every scenario with the books.
4. **Driving the real UI against a seeded backend.** A live click-through found five
   user-facing defects that 2,080 passing unit tests did not.

```bash
MEZAN_SEED_DEMO=1 MEZAN_DB=./dev.db PORT=3187 pnpm exec tsx apps/server/src/index.ts
cd apps/web && MEZAN_API_URL=http://127.0.0.1:3187 pnpm exec vite --port 5183
```

Sign in as `admin@cyag.example` / PIN `123456` — the login field is the **email and only the
email**. **Reload the page to confirm a save actually persisted**; that check alone has
caught several "works until you look again" bugs.

---

# 2. Done — the product as it stands

## 2.1 By domain

- **No mocked data anywhere in `apps/web`.** No `*-sample-data.ts`, no in-browser store.
  Every screen reads and writes the API. The demo tenant lives in
  `packages/backend/src/demo-seed.ts` and runs only on `MEZAN_SEED_DEMO=1`.
- **Sales** — customers, quotes, invoices, returns, price lists with volume tiers,
  promotions and coupons, credit control, the customer 360 with a dated statement.
- **Purchases** — suppliers, RFQs, orders, goods receipts, invoices, returns, landed costs
  with three allocation bases, the three procurement strictness gates, supplier 360.
- **Inventory** — items across six types, specifications, product templates, configurable
  products, stock balance, transfers (including Excel/CSV import), adjustments with a
  reason wizard, physical counts with cost snapshot and blind counting, label printing
  (Code 128 inline SVG, verified scannable), write-down runs, reserved stock derived from
  open documents.
- **Manufacturing** — BOMs, work orders with the full shop floor (issue, extra issue,
  return, scrap, cost), seven detail tabs, work stations and operators, production dashboard.
- **Accounting** — double-entry ledger, chart of accounts with account routing, cost centres
  and their P&L, journal entries, fiscal periods, tax rates and groups, exchange rates, FX
  revaluation, balance reconciliation, ETA e-invoicing, and the 7 financial statements over
  the live posted ledger. The inventory sub-ledger reconciles to its GL control account
  exactly.
- **Treasury** — 11 voucher types, the allocation queue split by intent, treasury accounts
  with live GL-derived balances, bank reconciliation, the 7-state cheque register.
- **Installments** — plans, schedules, overdue batches, collection follow-ups.
- **CRM, projects, assets, field sales** — leads and the opportunity pipeline board,
  projects, the asset register with depreciation runs, van trips bound to a vehicle registry.
- **HR** — employees, departments, job titles, contracts, holidays, attendance, leave
  requests/balances/accruals/policies, payroll runs, payslips and advances. Statutory payroll
  computation is deliberately absent — see §4.
- **Reports** — 23 operational reports plus the 8 financial statements, each with a
  server-computed KPI strip, charts drawn from the same rows the table shows, quick period
  chips, % contribution bars, GL-reconciliation tiles, drill-down panels and CSV/Excel export.
- **Platform administration** — approvals inbox and workflow config, notification rules,
  numbering sequences, audit viewer, data migration, barcode config, profile, users, roles
  and the ~268-permission matrix, print templates, eight settings policy tabs whose toggles
  actually change document behaviour.
- **Shell** — domain workspaces, production dashboard, command palette, notification centre,
  system-status pill, working branch/warehouse selectors that narrow scope without ever
  widening it beyond the session grant.
- **Desktop packaging** — the renderer is served from a real `app://` origin rather than
  `file://`, with the path resolution unit-tested as the security boundary it is.

## 2.2 Parity, item by item

The ordered work list. Every item traces to a requirement id in
`archive/reference-parity/REQUIREMENTS.md` (R…) or a gap id in
`archive/gap-inventory.md` (A…/H…), or to a defect in `archive/defect-register.md`.
Scenarios that verify them are in `TESTING.md` §15.

Tick an item only when it has been driven in the running app on seeded data, in
**both locales** (ar/RTL and en/LTR) and **both themes**.


---

### P0 — correctness (blocks everything else)

- [x] **D43** Remove the four "(المرحلة الثانية)" placeholders and wire the real data
  - [x] item detail → stock by warehouse (`GET /inventory/items/:id/stock`, warehouse-scoped)
  - [x] item detail → cost, from the WAC layers
  - [x] chart-of-accounts detail → account movements from the GL
  - [x] treasury account detail → movements from the voucher postings
  - [x] the stale comment claiming the movements table was a stub
- [x] **D44 / R6.7** Cost centres get their own columns + "create from departments"
      - [x] Own six columns — الكود · الاسم · النوع · مرتبط بـ · المركز الرئيسي · الحالة, rendered by the screen itself rather than by the chart-of-accounts tree, with type labels and names resolved per locale
      - [x] "Create from departments" — `GET /cost-centers/importable-departments` + `POST /cost-centers/from-departments`; each new centre is linked to its department, so a second import adds nothing
- [x] **D45** Seed configurable-products, custom-manufacturing, installment-follow-ups; add all three to `pnpm check:seed`
- [x] **R1.1** Add `…/counts` and `…/stats` endpoints to every list resource; move chip counts and KPI money off the loaded page and onto the server
      - [x] Sales invoices — `/sales-invoices/counts` + `/stats`, derived `open`/`overdue` chips resolved server-side, `branchId`/`warehouseId`/`search` added to the list query
      - [x] Purchase invoices — `/purchases/invoices/counts` + `/stats`, payment states (`overdue`/`due_soon`/`partially_paid`/`paid`) resolved server-side
      - [x] The float defect underneath it: 22 money sums across 14 screens moved to bigint (`apps/web/src/lib/money.ts`)
      - [x] The remaining 20 list resources — sales quotes, sales returns, purchase returns, purchase orders,
            goods receipts, RFQs, treasury vouchers (`/stats`), cheques, instalment plans, collection follow-ups,
            treasury accounts, items, stock adjustments, stock transfers, physical counts, journal entries,
            customers, suppliers, work orders and the asset register all carry `/counts` + `/stats` behind ONE
            filter chokepoint. `/counts` drops its own axis on every one of them; `/stats` honours it. Every
            surface is enumerated in `scripts/smoke.ts` (198 read surfaces) and asserted by scenario **x20**
            in `scripts/scenarios/cross-module.ts`: per resource, each chip count equals the rows that chip
            shows, the counts survive a chip being clicked, and the KPI strip follows the filter the rows follow
      - [x] `/customers/stats` and `/suppliers/stats` derive receivables and payables server-side in `Money`,
            from the same figures `/sales-invoices/stats` reports — wired at the composition root in
            `packages/api/src/app.ts` rather than left null
      - [x] All 20 screens pointed at them, so the strip follows the chip instead of reporting the whole book.
            Verified live on a seeded tenant in ar/RTL and en/LTR, light and dark: on quotes, clicking محول moved
            the rows to 1 AND the total from 33,219.60 to 9,849.60 while every other chip kept its own count; on
            cheques, محصل moved 5 rows / 13,050.00 to 2 rows / 7,300.00; on items, «out of stock» moved 19 to 9 in
            the rows AND in all four tiles; on purchase orders, «fully received» moved 72,730.00 to 23,300.00.
            The customers strip's «إجمالي المستحق» now ties to the cent to `/sales-invoices/stats` remaining
            (43,880.88), and `?q=مؤسسه` finds «مؤسسة النور» — the server search forgives ة/ه, the old browser
            `includes` did not (D32)
      - [x] The treasury-accounts money tiles: `/treasury-accounts/stats` gained a ledger source and now answers
            `liveTotal`/`liveCash`/`liveBank` ALONGSIDE the opening figures, summed in `Money` per account from the
            GL — a treasury balance IS its control account's balance. The live keys are ABSENT, never zero, when no
            ledger is wired, so "not measured" cannot be read as "the tills are empty". Verified on the seeded
            tenant: liveTotal 144,335.12 = 4,879.12 + 137,956.00 + 1,500.00, against an openingTotal of 0.000000 —
            which is exactly why publishing the opening figure under «إجمالي الأرصدة» would have reported a tenant
            holding 144k as having nothing. Guarded by scenario **x67**
- [x] **R2.2** Returns must start from a source document, and returnable quantity must be recomputed server-side

### P1 — shell and navigation

- [x] **A1** Third nav level: extend `NavGroup` in `packages/ui/src/shell/types.ts`, render sub-groups, regroup `nav-config.tsx`
  - [x] التقارير → المبيعات / المشتريات / المخزون / التصنيع / الأعمار / الأقساط
  - [x] المخزون → المنتجات / الحركات · التصنيع → الإنتاج / التعريفات
  - [x] الإعدادات → عام / المستخدمون / الفروع والمستودعات / سير العمل / الطباعة / التكاملات
  - [x] المحاسبة → التعريفات / الدورة / التقارير · الموارد البشرية → الموظفون / الحضور والإجازات / الرواتب
- [x] **R1.5** Ctrl+K command palette: quick actions + go-to — go-to entries generated from the nav specs, so the palette cannot drift out of step with the sidebar
- [x] **R1.6** Notification centre — a real feed off `/notifications`; the bell's "عرض جميع الإشعارات" now opens `#/notifications` (all/unread tabs, mark-all-read, verified it survives reload) instead of being a dead link. Demo seed enriched so the seeded tenant opens onto a genuine mixed read/unread inbox rather than an empty one
- [x] **R1.14** Branch and warehouse as a global header scope — six document lists now narrow by warehouse, and changing the scope refetches
- [x] **R1.9** Attention banners on lists (overdue, out of stock, drafts) that apply the filter when clicked
- [x] **R1.10 / R1.11 / R1.12 / R1.13** Empty states with a CTA, collapsible KPI strip, page-size selector, active-filter badge
  - [x] The shared primitives — `EmptyState` (with CTA), `DocumentList`'s `statsCollapsible`/`listKey` (collapse persists across reload) and `filterBarCollapsible`/`activeFilterCount` (a "تصفية النتائج N" badge) — built and driven live end-to-end on the new notifications screen, ar+en, both themes
  - [x] Rollout complete on every screen that renders `DocumentList`: all 65 now pass an `EmptyState` (with the
        list's own toolbar action as its CTA, or no action where nothing is created — an audit log, an approvals
        inbox, a derived report) and a page-size selector; every screen with a `filterBarExtra` also carries
        `filterBarCollapsible` + a real `activeFilterCount`. Screens with no filter bar deliberately do NOT
        collapse — passing `filterBarCollapsible` without a badge would hide filters and say nothing
- [x] **R1.7 / R1.8** System-status indicator and support entry point — a header pill off the real health check (never a fabricated "all systems operational"), and a headset menu (keyboard shortcuts, system status) — both live, real features, not invented contact info

### P2 — reports engine

- [x] **A2 / R21.2** `ReportDefinition` gains `kpis`; the server returns the aggregates; `ReportRunner` renders a collapsible KPI strip
  - [x] the mechanism, and a default that gives EVERY report a strip from its own total columns
  - [x] chart captions (R21.3), methodology footnote (R21.9) and the balance banner (R21.10) as runner capabilities
  - [x] charts — rendered from the SAME rows (or the same group subtotals) the table shows
  - [x] **R21.4** chart view toggles (bars / pie / table / hide) on the chart card
  - [x] per-report `kpis` on all 30 reports — figures the column totals could not say (share overdue, capital tied up, net income, cash variance), each computed server-side over the whole filtered set through the same `sumRows` the grand total uses
  - [x] the float defect underneath it: twelve headline reducers (both ledger reconciliations, net income, total assets, net cash change, VAT net payable, five contribution denominators) were adding piastre-exact money as doubles; VAT net payable reported −12,072.199999999999
- [x] **A3** Quick period chips (هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة) — on every report that has a date range
- [x] **A4** Replace the hardcoded `TODAY = "2026-08-22"` with the real current date — and fix the UTC day-shift in every `toISOString()` "today" across 21 screens
- [x] **A6 / R21.6** % contribution on by-item / by-customer / top-products / by-supplier / by-salesperson — rendered as an inline bar, not a bare number
- [x] **A7** GL-reconciliation tile on sales-by-item and purchases-by-item — both tie to the cent
- [x] **R21.1** Every report subtitle is the question that report answers, in both languages (29 rewritten)
- [x] **R21.10** The trial balance states that it balances, as a banner above the table
- [x] **R7.1–R7.6** ETA e-invoicing: readiness meter, general + credentials tabs, item and unit mapping, submissions queue — and the payload now carries the registered codes instead of a hardcoded VAT sub-type
- [x] **R23.1** Pipeline board: stage colour dots, board/list toggle, customer, value-range AND branch filters — an opportunity now carries a branch, the list route enforces branch SCOPE before the filter narrows within it, and converting a lead carries the branch through
- [x] **R9.1** Work-order shop-floor actions — extra issue, return, scrap, record a cost; all five routes existed with no hook and no UI
- [x] **R9.2** Work-order detail: materials with available/shortage, shop floor, costs, movements, receipts, journal entries and audit — all seven tabs
- [x] **R9.3** Production dashboard: the start-production bucket the board was missing
- [x] **A5** Drill-down side panel from entity cells — a customer/supplier/item/account cell opens a panel with that entity and the posted documents behind the figure (`GET /reports/drill-down/<kind>/<id>`, gated by the entity's own permission, capped server-side at 25 with the true total stated). Wired on the 16 columns whose rows carry a real entity id; a document with its own page links to it
- [x] Rolled across all 22 reports and the 8 financial statements (**R6.6** KPI totals + charts) — every report answers with a strip, and every chart carries a caption
- [x] Keep CSV/Excel export everywhere — the reference has none (**X7**); verified live on the balance sheet, both formats

### P3 — document surfaces

- [x] **R2.1** Creation-method step on sales and purchase invoices — the purchase invoice now asks how the document is being built (يدوي / من إيصال استلام) as a STEP, the same two-card shape the sales invoice uses, and collapses to a «تغيير طريقة الإنشاء» summary once answered
- [x] **R2.3** Live available-stock and out-of-stock badge per line — three states, measured against the line's BASE quantity
- [x] **R2.4** Per-line unit of measure with conversion — the line stores the entered unit, its factor and the base quantity; the stock ledger moves the base quantity
- [x] **R2.5** Per-line and per-document discount type (percentage / fixed) — fixed line discounts quantised at the discount boundary and capped at the line gross
- [x] **R2.7** Totals block: subtotal and tax lines added, return-adjusted net kept
- [x] **R2.8** Three-card "effects of this document" explainer including "no automatic collection" — on the create form and the invoice detail
- [x] **R1.4** Attachments across documents and entities — resource built (domain, SQLite store, `/attachments` routes gated by the host entity's own permissions, reusable `AttachmentsTab`) and now on every document and entity that should carry one: items, customers, suppliers, employees, sales invoices, sales quotes, sales returns, purchase invoices, purchase orders, goods receipts, stock adjustments, stock transfers, work orders and treasury vouchers. The six new entity types each map to their host entity's own view and write permissions, so an attachment still carries none of its own. Every type is seeded with a file, so an empty tab is a finding rather than the default. Verified live on all fourteen: upload, reload, still listed, downloadable
- [x] **R1.3** State-dependent row overflow menus — on 42 list screens, each derived from that row's own state helper rather than a second parallel notion of what is allowed. Every action needing input the row cannot supply opens the form that collects it; per-row pending state throughout, cleared in `finally`
  - [ ] The 17 remaining `DocumentList` screens are read-only report surfaces (audit log, stock balance, cost-centre P&L, reconciliation, FX revaluation, leave balances and accruals, attendance) or flat master data whose only per-row action is an inline edit (departments, job titles, holidays, asset categories, leave policies, payroll components, pipeline stages, item specifications, product templates). None carries a lifecycle, so a state-dependent menu there would hold a single entry. Settle against the running reference before adding one
- [x] **R2.11** Cross-document creation — invoice → return / plan / collection; customer → invoice / collection / quote; quote → its invoice (convert on an accepted quote, open the invoice on a converted one); plan → the invoice it schedules; supplier → purchase invoice / payment / purchase order
- [x] **R3.4** Sales-invoice detail: installments tab, the cross-document actions and the attachments tab
- [x] **R4.4** Purchase-invoice detail: landed-costs tab, consumed/received/still-in-stock per line (read from the cost layers the funding document created), an inline «تسجيل السداد» that posts a real سند صرف, and the attachments tab
- [x] **R2.6** Coupon codes — already complete and mis-recorded here. `requiresCoupon` on the promotion, `matchesCoupon` in the engine, the code stored on both the invoice and the quote, an input on the invoice form and a «بكوبون فقط» filter on the promotions list. Verified: a 20-unit cart returns `applicable: false` with no code and unlocks PROMO-DEMO-2 with `BULK15`
- [x] **R2.9** Quick-preview panel — a row opens the document's customer, date, status, lines and totals in a side panel without leaving the list, with a way through to the full document
- [x] **R2.10** Share document — print, and copy a plain-text summary to the clipboard. NOT a share link: the app runs offline on the shop's own machine, so there is no address anyone else could open; copying the figures is what actually gets sent to a customer. A refused clipboard says so rather than looking like it worked

### P4 — entity 360

- [x] **R3.6** Customer 360: overview, invoices, statement, installments, returns, attachments and audit — and customer create/update now emit the audit events the trail tab needs
- [x] **R4.5** Supplier 360: the dated supplier statement, reconciled against both the open-invoice sub-ledger and the aging report, and the action bar (فاتورة مشتريات جديدة · سداد للمورد · أمر شراء جديد)
- [x] **R5.5** Item detail: stock by warehouse (with reserved), cost layers, price lists, specifications, attachments, audit log; adjust-stock / transfer / purchase-request / movement-ledger actions
  - [x] stock by warehouse with available / reserved / total
  - [x] cost layers (remaining qty, unit cost, source, date)
  - [x] price lists (list, base price, custom price, delta)
  - [x] specifications (named from the catalogue, following the reading language), attachments, movement ledger and audit log tabs
  - [x] header actions: adjust stock and transfer, both routing with the item already answered
  - [x] "raise purchase request" — the purchase ORDER is the request document here (owner's call; no requisition type exists). The action opens a new order with the item already on the first line and the supplier left open, since on an item the buyer is exactly what has not been decided
- [x] **R5.6** Reserved stock per warehouse — derived from open documents, never stored
- [x] **R10.1** HR dashboard: department/branch/attendance-mix charts, headcount-movement trend, absence and late-arrival KPIs, leave entitlement columns
- [x] **R10.2** Employee 360 tabs, the attachments tab and the re-hire action (the audit tab still waits on an `entityId` on the audit event)
- [x] **R10.3 / R10.4** Branch and active-contract columns; server-derived contract expiry with a KPI tile, banner and filter chip
- [x] **R10.5** Leave-request create, including filing on behalf of another employee behind `hr.leave.approve`
- [x] **R10.6** Leave-policy presets, listed and applied in one action
- [x] **R10.7** Payroll earning and deduction components, bound to a component registry and routed to their own GL accounts
- [x] **R5.3 / R8.4** Inline opening-balance actions on zero-stock items and treasury accounts
  - [x] **R5.3** items list: row-menu action on zero-stock rows, routed to the adjustment form with the reason and item already answered
  - [x] **R8.4** the same on treasury accounts: a row-menu action on accounts whose balance is zero AND that are bound to a GL account, posting Dr the treasury account / Cr 3210 أرصدة افتتاحية
- [x] **R3.7** Loyalty points — **decided OUT for v1** (owner's call). Points earned are a real liability to the customer, so doing it honestly means a points sub-ledger, an expiry policy, a GL liability account and a redemption path that posts — a module, not a field. A counter on the customer record would be a promise no account backs and nothing could reconcile. No other parity item depends on it

### P5 — missing features

- [x] **R8.1** Voucher types 4 → 11, card grid with explanations, correct GL routing for partner capital, drawings and tax payments
- [x] **R8.2** Voucher list: type filter listing every type (used or not), branch filter, date range, chips for needs-allocation / pending / voided, row menu view / print / cancel
- [x] **R8.3** Needs-allocation queue as a server concern, split by intent (receipt vs payment), with server-side chip counts
- [x] **R6.1** Account-routing screen — a second tab on the chart of accounts mapping every posting to a GL account, wired to the ledger rather than decorative
- [x] **R6.3** Journal entries: date-range filter, source-module column (with the source document number), print
- [x] **R6.4** Tax groups alongside tax rates — compounding members, per-member breakdown
- [x] **R6.5** Exchange rates: search and date filter (the three statuses already existed)
- [x] **R5.1** Item types 2 → 6, with the behavioural rules per type — capability table in the domain; pickers and reports ask the capability, never `type === "stock"`
- [x] **R4.2** Purchase-invoice line types (stock / expense / freight) — three kinds, each routing its debit to its own account: 1200 / 5910 / 5200
- [x] **R5.9** Stock-adjustment reason wizard, per-reason GL accounts, reason on the list and the journal entry, reason filter
- [x] **R9.1 / R9.2** Work-order shop-floor actions and the seven detail tabs with shortage tracking
  - [x] محطة العمل + المشغّل on every issue, extra issue, return, scrap and product receipt — a `work_station` registry (`/manufacturing/work-stations`, managed from the production hub, seeded with three stations) and an employee id, BOTH resolved against their own register before anything is written
  - [x] shown per row on the movements and receipts tabs, joined on the movement's own reference — joining on the timestamp reported one station on every row whenever two actions landed in the same millisecond
- [x] **R7.1–R7.6** ETA: readiness meter, general settings, credentials with test-connection, item mapping, unit mapping with suggestions, submissions queue with exclude
- [x] **R11.1–R11.8** Split settings into the policy tabs and make each toggle actually change document behaviour:
  - [x] credit control mode (warn vs block) — `creditControlEnabled` / `creditControlMode`
  - [x] sell-from-another-warehouse, show other-warehouse stock, backorders, negative stock, aging write-down provision, auto batch numbers — `allowCrossWarehouseSales`, `showOtherWarehouseStock`, `allowBackorder`, `allowNegativeStock`, `agingWritedownEnabled` + months + rate, `autoGenerateBatchNumbers`
  - [x] require PO before GRN, require GRN before purchase invoice — `requirePoForGrn`, `requireGrnForInvoice`
  - [x] block negative cash balances (drawers only, not banks) — `preventNegativeCashBalance` + `allowNegativeTreasury`, both reaching `VoucherService.cashPolicy()` through the `vouchers:` options (D19)
  - [x] VAT enable / default rate / inclusive vs exclusive / depreciation in month of acquisition — `taxEnabled`, `defaultTaxRate`, `taxCalculation`, `depreciationProrate`
  - [x] email SMTP + test send + template — `smtpEnabled` and the rest, with a real `sendTestEmail` in `packages/api/src/smtp-client.ts`
  - [x] multi-currency enable, allowed currencies, missing-rate policy, numeral system, fiscal-year start — `multiCurrencyEnabled`, `secondaryCurrencies`, `fxRateMissingPolicy`, `dateNumerals`, `fiscalYearStartMonth`
  - Ticked 2026-08-27 after checking all three levels rather than the checkbox: each flag is read by the document logic (not merely stored), `pnpm scenarios` flips every one of them and asserts the document behaviour changes with it, and all eight policy tabs were driven live on the seeded tenant
- [x] **R12.1** Approvals: inbox / my requests / my actions, with the document-type filter (R14.1)
- [x] **R3.8** Customer form advanced options — the form splits into everyday fields and «خيارات متقدمة» (tax + commercial registration, tax-exempt, entity type, contact person, address, logo). The logo is chosen from the customer's own attachments, so the bytes live in the attachments resource and the record holds only the id. `priceListId` was a free TEXT field storing whatever was typed; it is now a picker over `/price-lists`, and the routes refuse an id that names no list
- [x] **R3.9** Sales return: a reason PER LINE, a derived awaiting-refund state, and «استرداد للعميل» that creates and confirms a real رد مبلغ لعميل voucher (Dr AR 1105 / Cr the till, one balanced entry). What may still be refunded is recomputed server-side from the posted return and the vouchers already posted against it; `awaitingRefund` is derived from those vouchers rather than stored, so reversing one restores the ledger AND the awaiting state in a single act. `POST /sales-returns/from-invoice` existed in the domain and was mounted nowhere — it is now the shape the screen sends
- [x] **R3.11 / R3.12** Price-list minimum-quantity tiers (an item quoted once per volume threshold, resolved server-side by `resolvePriceTier` and threaded into the sales-invoice pricing check as the line's base quantity); promotion minimum quantity and maximum discount cap, the cap re-allocated by largest remainder so the parts still sum exactly. Both screens now edit every field the reference has, including bundle components over the real item endpoint
- [x] **R3.13** المركبات — a van registry owning each vehicle's warehouse, till and branch. `POST /field/van-trips` takes `vanId` alone and derives the rest, refusing a body that names a van and a different warehouse or till; the crew binds to real employees. The three cascaded fields are read-only and stay empty until a van is chosen
- [x] **R4.6** GRN from PO only — the create form is a creation-method STEP whose «استلام مباشر» card is offered only when the tenant's «إلزام أمر الشراء قبل الاستلام» setting is off. The screen READS that setting; the server gate was already live and now refuses in Arabic
- [x] **R4.7** Landed-cost allocation basis and typed cost lines — a third basis (حسب الوزن) beside value and quantity, the shipped weight carried on the persisted line so a confirmed document still states its basis, and the entered cost broken down by نوع التكلفة on both the form and the document
- [x] **R5.4** Item form: image, description, default supplier, season, channels, per-price-list prices, specifications
  - [x] description, default supplier (bound to a real supplier), season, brand, specifications
  - [x] image — chosen from the item's own attachments, so the file lives in the attachments resource and the item holds only the id
  - [x] channels & visibility — **dropped for v1** (owner's call). The reference carries channels because it sells online; this is a desktop ERP for a shop, where the branch and the warehouse already carry that dimension and are already scoped
  - [x] editing a per-price-list price from the item form — one row per volume TIER, each editable in place, saving the list's whole lines array so no other line is dropped
- [x] **R5.8** Transfer import — paste a range straight from Excel (the clipboard gives TSV), or choose a CSV or a real `.xlsx`. The delimiter is detected per file, quoted fields and Arabic-Indic numerals are handled, and every row is resolved against the REAL item catalogue by code or barcode; a row that matches nothing, or names a service item, is rejected WITH its reason rather than carried through as a plausible id. `.xlsx` is read with no dependency — it is a ZIP of XML and the browser already provides DEFLATE
- [x] **R5.10** Brands, seasons and specification facets — brands and seasons are entities, items carry registry-checked specification values, and the list filters by all three
- [x] **R10.5** Leave-request create action, including filing on behalf of another employee behind `hr.leave.approve`
- [x] **R1.15 / R1.16** 11 document currencies; per-currency AR/AP balances
      - [x] The eleven-currency registry (`packages/domain/src/currency/`), the demo tenant's allowed list, the exchange-rate and revaluation screens
      - [x] A foreign SALES invoice converts at the approved rate of its own date, tags its receivable line, stamps the rate, and stores the BASE total in the sub-ledger (D24's remaining half)
      - [x] `GET /gl/balances-by-currency` — per-currency, per-party AR/AP in both the transaction and the base currency, shown on the revaluation screen
      - [x] Both document forms now offer every currency the TENANT allows, read from `/settings/currencies` rather than hardcoded, and the purchase-invoice form has a currency field at all for the first time. Amounts print in the document's own currency (D52 fixed), and the purchase-invoice form has no currency field at all — its route accepts one, no screen sends one

### P6 — list-surface parity

One task per row of the per-screen tables in `archive/gap-inventory.md` §B–D2. Start with
the money-bearing ones: purchase-invoice payment dimension (**R4.1**), items stock
sales-returns filter bar,
journal date filter and source-module column (**R6.3**), tax groups (**R6.4**),
exchange-rate filters (**R6.5**), branch price-list column, CRM KPIs and board view,
HR dashboard charts (**R10.1**), asset status chips.

---


---

# 3. Open now


> **Two review artifacts sit alongside this section and are not folded into it.**
> `artifacts/simplification-review.html` — 134 findings from 32 reviewers over the code and
> the docs, each with file evidence and a status re-read against the tree; filter it to
> *open* to see what is left. `artifacts/best-erp-in-egypt.html` — every module Mezan ships
> judged against the best product in the world at that job, plus the fourteen Egyptian
> statutory obligations that decide whether any of it is sellable: **five modules ahead of
> the field, nine at par, seven behind, two absent.** Both are point-in-time and were
> compiled on branches other than `main`; their open items are candidates for this section,
> not entries in it, until each is re-checked against the running app.
>
> **The two that cost the most in a deal, from the module audit:** Egypt's B2C e-receipt
> regime (الإيصال الإلكتروني) is a separate mandate from e-invoicing, already in force, and
> this build has nothing for it — with POS descoped, retail, restaurants and pharmacies
> cannot legally transact. And there is no report centre and no drill-down across the
> reports, which the audit names as the accountant's stated breaking point.

**Re-verified 2026-08-27.** Two items are genuinely open. Seven that used to sit here were
finished work whose boxes were never ticked, and are now in §2; one described a field that
no longer exists. §3.3 records what moved and why, so nothing is silently dropped.

## 3.1 Row menus on the remaining 17 list screens — R1.3

- [ ] The 17 remaining `DocumentList` screens are read-only report surfaces (audit log, stock
      balance, cost-centre P&L, reconciliation, FX revaluation, leave balances and accruals,
      attendance) or flat master data whose only per-row action is an inline edit (departments,
      job titles, holidays, asset categories, leave policies, payroll components, pipeline
      stages, item specifications, product templates). None carries a lifecycle, so a
      state-dependent menu there would hold a single entry. **Settle against the running
      reference before adding one** — this is a question, not a backlog item.

## 3.2 Outbound notification channels

- [ ] `packages/domain/src/notifications/engine.ts` delivers **in-app only**: every other
      channel is stamped `"queued"` and nothing drains the queue. The channel type is
      `"in_app" | "email" | "push"` — there is no WhatsApp channel, modelled or otherwise, so
      earlier notes claiming one are wrong. An SMTP transport now exists
      (`packages/api/src/smtp-client.ts`, used by the settings test-send), so wiring email is
      no longer a missing-transport problem — it is a delivery/retry decision: what happens to
      a queued mail when the shop is offline, which is the normal case for this product.

## 3.3 Recently settled — no longer open

### Desktop packaging — closed 2026-08-27

The renderer used to load over `file://` (`loadFile`). Chromium gives every
`file://` document an opaque origin, so a `<script type="module">` was refused
as cross-origin, `import()` of a route chunk was refused with it, and Vite's
absolute `/assets/*` paths resolved against the filesystem root. Three
different symptoms, one cause; none had ever been hit because packaging is
deferred and nobody had run the packaged build.

Closed by serving the renderer from a real origin: `main/renderer-protocol.ts`
registers `app://` as a standard, secure scheme before `whenReady` and streams
the bundle out of `resources/web`. `main/renderer-paths.ts` holds the path
resolution — kept free of any Electron import so it is unit-testable headlessly,
which matters because it is the security boundary: it runs with the user's full
filesystem rights and must refuse anything that escapes the renderer root.
Eight cases cover it (`renderer-paths.test.ts`), including the percent-encoded
traversal and the sibling directory that shares the root's prefix.

The hash stays for now, but `app://` supports `history.pushState`, so dropping
it is a decision rather than a constraint from here.

### Settled since this list was written

| Was listed open | Actually |
|---|---|
| R11.1–R11.8, the seven settings-policy toggles | Done and verified at three levels — see §2.2 P5 |
| workflow `minAmount` configurable but never enforced (DEC-1) | The field does not exist anywhere in the repo. The decision is moot; DEC-1 is closed in §6 |
| WhatsApp channel modelled but unimplemented | Never modelled. Only the email/push halves of §3.2 are real |


---

# 4. Deferred by decision


## 4.1 Out of scope for v1

POS (9 screens + 2 reports), `/settings/shifts`, a standalone label-templates
screen, statutory payroll computation. Payroll must stay visibly flagged rather
than silently computing a wrong net.

## 4.2 Do not copy

X1–X8 in `archive/reference-parity/REQUIREMENTS.md` and C1–C13 in
`archive/gap-inventory.md`. In particular: keep report export, keep the hubs
linked, keep the daily attendance list, do not reproduce the 0.00 treasury balance bug,
and label a purchase return correctly.

## 4.3 The deferred build plan

The build plan for the deferred areas — HR/Payroll (27 tasks), POS (26 tasks) and the
Cloud/SaaS edition (20 tasks) — is `archive/plan.md` §9. It is not repeated here.

---


---

# 5. Defects

## 5.0 Open

**Fifty-seven filed 2026-08-30 by the test-coverage pass** (D66–D122). D109 is the most serious: an unauthenticated device on the shop wifi can post to the books. D99 is the most serious: a live, ungated journal-posting route. They were found by
writing tests and manual scenarios against the real code, so each carries a file reference
rather than a feeling. The ones marked **guarded** already have a passing test that pins the
current behaviour and will go red the day it changes; the ones marked **reported** still
need a measured reading in the running app before anyone fixes them.

| # | Defect | Evidence | State |
|---|---|---|---|
| D66 | Every physical-count mutation invalidates `["inventory","physical-counts"]` while the screen reads `["physical-counts", filter]`, so الجرد الفعلي never refreshes: starting a count posts and the list bounces back empty, completing one leaves the row on قيد التنفيذ | `apps/web/src/data/inventory-ops-hooks.ts` vs `apps/web/src/data/hooks.ts` | guarded |
| D67 | `TextField`/`NumberField`/`TextAreaField` render a `<label>` with no `htmlFor` and no matching `id`, so no plain text field in the app is programmatically labelled — clicking the label does not focus, and a screen reader announces nothing | `apps/web/src/settings/form-controls.tsx` → `packages/ui/src/primitives/form.tsx` | guarded |
| D68 | The VAT return's «صافي الضريبة المستحقة الدفع» line never renders: the report screen prefers a report-declared `chart` over `renderSummary`, and the VAT return declares both | `apps/web/src/screens/reports/ReportScreen.tsx`, `packages/domain/src/reports/vat-return.ts` | reported |
| D69 | The tenant-admin bypass on `POST /workflow/requests` is dead — the route is ungated, so no gate stashes an AuthContext and `callerRoleCodes` returns `[]`; an admin's own submission is held بانتظار الموافقة | `packages/api/src/workflow-routes.ts` | guarded (`it.fails`) |
| D70 | Quotes, van trips and sales returns gate on the plain `.view` tier while `SALES_REP`/`VAN_SALES` hold only `.view_own`, so a rep gets 403 on their own work; sales invoices get this right with `gateAny` | `sales-quotes-routes.ts`, `field-sales-routes.ts`, `sales-returns-routes.ts` | reported |
| D71 | Customer routes carry no branch or rep scoping at all, and the catalog defines a single `sales.customer.view` tier — every rep sees the whole company's customer book | `packages/api/src/customers-routes.ts` | reported |
| D72 | The three purchasing policy toggles in settings (`requirePoForGrn`, `requireGrnForInvoice`, `trackSoldPurchaseItems`) reach no route: the server always runs `DEFAULT_PURCHASE_POLICY` | `packages/backend/src/create-backend.ts` → `packages/api/src/purchases-routes.ts` | reported |
| D73 | The "from order" goods-receipt screen has no editable quantity field, so every receipt taken through the browser is 100% of the outstanding quantity — a real partial delivery cannot be recorded, though the domain supports it | `apps/web/src/screens/GoodsReceiptsScreen.tsx` | reported |
| D74 | Several domain refusals build English-only messages that reach the Arabic UI verbatim (`OverReceiptError`, `PurchaseOrderNotReceivableError`, the permission gate's `Missing permission '…'`, the fiscal-period errors) | `packages/domain/src/purchasing/errors.ts`, `packages/api/src/permission-gate.ts`, `packages/domain/src/fiscal-periods/errors.ts` | reported |
| D75 | Landed cost posts its payable to a generic clearing account with no supplier dimension, so the freight/customs liability exists in the GL and on no supplier's account | `packages/domain/src/landed-costs/` | reported |
| D76 | A confirmed sales or purchase RETURN aggregates every line's tax into one untagged journal line, so the per-line `taxRatePercent` that D28 added does not extend to returns and the VAT return cannot split a mixed-rate return by rate | `packages/domain/src/sales-returns/`, `packages/domain/src/purchase-returns/` | reported |
| D77 | Confirmed returns are never enqueued to ETA, though the domain models `credit_note` and `debit_note` | `packages/domain/src/eta/` | reported |
| D78 | The ETA payload hardcodes `currencySold: "EGP"` on every line regardless of the document's currency | `packages/domain/src/eta/` | reported |
| D79 | The ETA sub-type resolver matches by tax-rate value alone, so exempt (V003) and zero-rated export (V001) items — both 0% — can be filed as each other | `packages/domain/src/eta/` | reported |
| D80 | Cheque transitions record no actor: the seven-state lifecycle has no audit attribution, so nobody can be asked who deposited or bounced one | `packages/domain/src/cheques/cheque-service.ts` | reported |
| D81 | A voucher whose payment method is «شيك» never creates a cheque record, so the cheque register misses every cheque raised through the voucher screen | `packages/api/src/vouchers-routes.ts` | reported |
| D82 | Finalising a bank statement never checks for unmatched lines, so a reconciliation can be closed with differences still open | `packages/api/src/bank-reconciliation-routes.ts` | reported |
| D83 | When an approval gate holds a voucher, the create wizard never surfaces the `held` flag — the user sees a success and no explanation | `apps/web/src/screens/TreasuryVouchersScreen.tsx` | reported |
| D84 | A landed cost naming a receipt whose layers are gone (fully consumed, or a mis-named `sourceDocId`) adds its value to the position but bumps no layer, so layer-level unit costs understate the basis with no signal | `packages/domain/src/inventory/wac.ts` | reported |
| D85 | `saveRole` exempts the `"*"` wildcard from the licence check and never consults `isPlatformAdminOnly`, so a tenant licensed for no modules can still mint a role holding full admin — and the use-case never sees who is asking, so "you may not grant more than you hold" is enforced nowhere | `packages/domain/src/roles/save-role.ts` | guarded (`save-role.abuse.test.ts`) |
| D86 | `saveUser` accepts `isCompanyAdmin: true` without checking the caller's own privilege; the only gate is `admin.users.edit`, so anyone holding it can promote a user — including themselves, by editing their own record — to full company admin in one PUT. The domain function never sees the actor, so the ceiling can only live in the route, and no route enforces one | `packages/domain/src/users/save-user.ts`, `packages/api/src/users-routes.ts` | guarded (`users-routes.test.ts`) |
| D87 | The discount ceiling checks only `discountType: "percent"`, so an `amount`-type discount bypasses `sales.price.override` / `pos.discount.approve` entirely | sales invoice discount validation | reported |
| D88 | A purchase invoice takes `unitCost` verbatim from the request with no cross-check against the PO or the receipt it names | `packages/api/src/purchases-routes.ts` | reported |
| D89 | A sales return's `customerId` is never validated against its source invoice's customer, so a confirmed return's refund can be directed at any customer id the requester names | `packages/api/src/sales-returns-routes.ts` | reported |
| D90 | A stock transfer posts both legs in one step with no receiving-side confirmation, so goods can never be recorded as in transit or short on arrival | `packages/domain/src/inventory/stock-transfer-document.ts` | reported |
| D91 | There is no exception reporting anywhere — no report lists backdated documents, deleted drafts, discounts above a threshold, adjustments by reason, or after-hours postings | `packages/api/src/reports-routes.ts` | reported |
| D92 | The RFQ detail screen passes the document NUMBER where the quotes and comparison routes resolve only by database id, so the quotes list comes back empty and the comparison 404s | `apps/web/src/screens/RfqsScreen.tsx` | reported |
| D93 | «تحصيل دفعة» on a sales invoice starts with no treasury account selected and no default, so the collection is refused on submit with no cue beforehand — the refund flow on returns does default it | `apps/web/src/screens/SalesInvoicesScreen.tsx` | reported |
| D94 | Item cost price is served to any holder of the item-list permission regardless of `sales.invoice.view_cost` | `packages/api/src/items-routes.ts` | reported |
| D95 | `projectSchema` requires `costCenterId`, and neither `createProjectSchema` nor `updateProjectSchema` carries the field — so a project's cost centre can never be set or corrected through the API; the key is stripped on both paths | `packages/contracts/src/project.ts` | guarded (`project.test.ts`) |
| D96 | `journalLineSchema` — the line shape `createJournalEntrySchema` uses, and the one `app.ts` posts manual entries through — carries only `accountId`, `debit` and `credit`. The cost centre, the currency and its rate, and the tax rate are all stripped, though `gl.ts`'s newer `glJournalLineSchema` carries every one of them. A manual journal entry therefore loses every dimension a later report needs | `packages/contracts/src/journal.ts` vs `packages/contracts/src/gl.ts` | guarded (`journal.test.ts`) |
| D97 | `createSalesInvoiceLineSchema` has no `costCenterId`, so a revenue line cannot be attributed to a cost centre at creation and the Cost Centre P&L cannot see it | `packages/contracts/src/sales-invoice.ts` | guarded (`sales-invoice.test.ts`) |
| D98 | Report date parameters are validated by SHAPE only, so `2026-13-45` — no thirteenth month, no forty-fifth day — is accepted by both the aging and the period reports and silently matches nothing, which reads on screen as "no sales in that range" rather than "that is not a date" | `packages/api/src/reports-routes.ts` | guarded (`reports-routes.test.ts`) |
| D99 | **`POST /journal-entries` is a live, UNGATED posting route.** It is the spike's original poster, still mounted in the app the desktop shell serves, and it has no permission gate, no fiscal-period check, no account validation, no document numbering, no audit event and no GL event — and its line contract carries no cost centre, currency, rate or tax rate. Anyone who can reach the API can post a journal entry into any period, including one that was never opened. The correct route, `POST /gl/journal-entries`, sits beside it fully gated | `packages/api/src/app.ts:1449` and `:1492`, `packages/domain/src/post-journal-entry.ts` | guarded (`legacy-journal-entries.abuse.test.ts`) |
| D100 | `useUpdateSequence` throws a fixed generic Arabic message and never reads the response body, so the server's actual refusal — a duplicate prefix, say — never reaches the user; sibling hooks parse `body.message` correctly | `apps/web/src/data/platform-hooks.ts` | guarded (`SequencesPage.test.tsx`) |
| D101 | An issue from a position that was never received costs **zero**: with `allowNegativeStock` on, `unitCostOf` returns zero for a zero quantity, so the first deficit movement is written at 0.00 and COGS is understated by the whole of it, silently. A position that HAS been received costs the deficit at its last average, which is defensible; this one is not | `packages/domain/src/inventory/stock-ledger-service.ts`, `packages/domain/src/inventory/wac.ts` | guarded (`stock-ledger-service.test.ts`) |
| D102 | `POST /sales-returns` lets the caller state `unitCost` directly, gated by the same permission as the `/from-invoice` path that derives it from the real invoice — so a return can be restocked at any cost the requester names, over-crediting inventory | `packages/api/src/sales-returns-routes.ts` | reported |
| D103 | **Warehouse scope is enforced on reads and on nothing else.** The list routes call `warehouseScopeOf`; `POST /draft` and `/confirm` for stock adjustments and transfers never do. A user scoped to one warehouse can post an adjustment into another, and can transfer goods out of a warehouse they may not even list — the goods move, and the screen they would check does not show it | `packages/api/src/stock-documents-routes.ts`, and the same asymmetry in `packages/api/src/inventory-routes.ts` — `POST /adjustments` and `POST /transfers` never call `warehouseScopeOf` while every list route in the same file does | guarded (`stock-documents-routes.test.ts`, `inventory-routes.test.ts`) |
| D104 | `assertVatPeriodOpen` in the tax module is dead code — nothing calls it — while the live control is a separate reimplementation, `assertVatNotFiled` in `gl/post.ts`. Two copies of a legally load-bearing rule, one of them unreachable | `packages/domain/src/tax/vat-filing.ts` vs `packages/domain/src/gl/post.ts` | reported |
| D105 | The quotes list never checks `query.isError`: a failed `GET /sales-quotes` renders the same «لا توجد عروض» empty state as a genuinely empty list, with no banner and no retry — every sibling list screen in the app distinguishes the two | `apps/web/src/screens/sales-quotes/index.tsx` | guarded |
| D106 | Row-action controls in the quotes list are not wrapped in a click-stopper, so clicking an inline action also fires the row's own handler and navigates away to the detail view mid-action | `apps/web/src/screens/sales-quotes/index.tsx` | guarded |
| D107 | The convert-to-invoice warehouse is captured from `workingLocation` at first mount, before the branches and warehouses queries resolve, so it locks to the empty string permanently: every accepted quote blocks on «اختر المستودع.» even when a real default warehouse exists | `apps/web/src/screens/sales-quotes/QuoteDetailView.tsx` | guarded |
| D108 | Converting a quote falls back to hardcoded GL account ids (1105 / 2200 / 4100 / 5100 / 1200) for any item with no account mapping of its own, never checked against the tenant's actual chart of accounts — on a tenant whose COA differs, the invoice posts to whatever those codes happen to be | `apps/web/src/screens/sales-quotes/quote-model.ts` | guarded |
| D109 | **The desktop app is built with no session resolver at all.** `main/index.ts` calls `createApp(uow, { lan })` and never passes `resolveAuthContext`, so the default header resolver governs — the one `session-auth.ts` documents as the thing that must never front a socket bound for other machines. Combined with D99, an unauthenticated device on the shop wifi can POST a journal entry into the books across the LAN socket and read it back. Proven end to end over a real socket | `apps/desktop/src/main/index.ts`, `apps/api/src/app.ts:1449` | guarded (`lan-host.test.ts`) |
| D110 | `finalize()` on a bank statement is tested as a happy path with three lines still unmatched, in both the domain and the route suite — the test documents D82 without naming it, which is how a real regression gets waved through | `packages/domain/src/bank-reconciliation/reconciliation-service.test.ts`, `packages/api/src/bank-reconciliation-routes.test.ts` | fixed in this pass |
| D111 | **No report is branch-scoped, and none can even be filtered by branch.** `branchScopeOf` is called in the CRM, cheque, cost-centre, fixed-asset, HR, purchase, quote, treasury, voucher, RFQ and warehouse routes — and in neither report router. No report definition carries a `branchId` parameter either. A branch-scoped user sees every branch's sales, purchases, aging and financial statements, and cannot narrow to their own | `packages/api/src/reports-routes.ts`, `packages/api/src/financial-reports-routes.ts` | reported |
| D112 | The aging reports declare no `reconciliation` block and no test ties their total to the AR or AP control account — the first report an accountant opens agrees only with itself. `inventory-valuation` is the same: `sales-by-item` and `purchases-by-item` DO declare one, and no test asserts it either, so the tie mechanism is dark on every report that has it | `packages/domain/src/reports/aging-customers.ts`, `aging-suppliers.ts`, `inventory-valuation.ts` | reported |
| D113 | The topbar's bell, theme and user menus portal their dropdown to `document.body` with no focus management at all — no focus on open, none restored on close. `SidePanel` does both correctly, so the pattern exists and these three do not use it. A keyboard user who opens one cannot reliably Tab into it and is left stranded when it closes. Rendered on every screen | `packages/ui/src/shell/ChromeActions.tsx`, `NotificationsPanel.tsx`, `TopbarMenu.tsx` | reported |
| D114 | `EntityPicker` filters with a plain lower-cased substring match instead of the app's own `normalizeForSearch`, so «الامل» finds nothing where «الأمل» is stored — while the customer LIST, which does normalise, finds it. The entity is reachable only by someone who reproduces the stored spelling character for character, across roughly 35 picker call sites | `packages/ui/src/primitives/EntityPicker.tsx` | guarded (`EntityPicker.test.tsx`) |
| D115 | **The Ed25519 licence model is not wired to the app that ships.** `resolveDesktopEntitlements` reads `MEZAN_ENTITLEMENTS_JSON` — an unsigned environment variable — straight into `createEntitlements`: no signature check, no expiry, no machine fingerprint, no grace period. `verifyLicense`, which does all four and is thoroughly tested, is called by nothing the desktop binary runs. Anyone with shell access grants themselves any plan | `apps/desktop/src/main/entitlements.ts` vs `packages/domain/src/licensing/**` | reported |
| D116 | Roughly a third of the permission catalogue gates nothing. The entire POS module (33 codes) has no route at all; eleven treasury codes, `sales.invoice.void`, `sales.customer.merge`, `crm.lead.assign`, `hr.payroll.run`, `installments.collect` and others gate nothing either. An admin can tick any of them in the role editor and the product does not change — and a confirmed sales invoice cannot be voided through any route, only a draft cancelled | `packages/domain/src/permissions/catalog.ts` vs `packages/api/src/*-routes.ts` | guarded (`permission-catalog-coverage.test.ts`) |
| D117 | Nothing stops the last company admin being deactivated or demoted. `saveUser` and `setUserStatus` have no last-admin check, so a departing employee holding `admin.users.deactivate` — or one fat-fingered click — can lock the shop out of its own books with no way back through the product | `packages/domain/src/users/save-user.ts` | reported |
| D118 | `PUT /users/:id` lets a caller holding only `admin.users.edit` set their own `branchScope` and `warehouseScope` to `*`, defeating every read-narrowing the app applies. The same shape as D86, for scope rather than the admin flag | `packages/api/src/users-routes.ts` | reported |
| D119 | **An instalment can never be collected.** The catalogue defines `installments.collect` and `installments.collection.create`; the router mounts a route for neither, and nothing in the codebase ever writes `InstallmentLine.paidAmount` after the schedule is generated. The whole follow-up queue tracks money that the product has no way to receive | `packages/api/src/installments-routes.ts` | guarded (`installments-routes.test.ts`) |
| D120 | Cancelling an instalment plan flips the document's status and never its lines — nothing anywhere produces the `cancelled` line status the enum declares — so `/plans/stats` keeps reporting a cancelled plan's full scheduled and remaining amounts as live money | `packages/api/src/installments-routes.ts` | guarded |
| D121 | The ETA payload that will actually be filed is built and stored on the submission, and no route ever returns it: `serializeSubmission` omits it and there is no `GET /submissions/:id`. Nobody — screen or auditor — can inspect what is about to go to the authority | `packages/api/src/eta-routes.ts` | guarded |
| D122 | D77's root cause, located: the enqueue bridge reacts only to a `DOCUMENT_CONFIRMED` event whose `docType` is `SALES_INVOICE`, so confirmed sales and purchase RETURNS never reach the queue at all — the queue itself handles credit and debit notes correctly when fed directly | `packages/backend/src/create-backend.ts` | guarded at the boundary |

D1–D65 are closed; the register is `archive/defect-register.md`.

D65 — 20 scenario assertions failing because `2c0e7fa` made a user's Arabic name mandatory
and no scenario that creates a user passed `nameAr` — was closed by `d3294fc`, which taught
the harness to sign in with the seed PIN and the current user contract. The fix was in the
harness, not the product: the product is right to demand the name. The one reading filed as
a possible second defect behind it — an HR leave balance of 21 against 11 — was the same
bug, and holds once the caller exists.

Measured on this tree, 2026-08-29: `pnpm scenarios` **3876 passed, 0 failed**, across all
thirteen suites. Every other gate green with it — typecheck, lint, RTL logical-CSS, colour
tokens, native controls, permission labels, theme colour-only, and `pnpm smoke` over all
199 read surfaces.

---

Everything filed is closed — D1 through D65. The closed register — every defect with
the commit that fixed it, plus the readings that looked like defects and were not — is
`archive/defect-register.md`. It is kept, not deleted, because a fixed defect is how its
regression is recognised.

A closed register is not the same as a clean product: it means the ones found and written
down are closed. The next one gets found the way these were — by driving a seeded app and
comparing two numbers that must agree.

## 5.1 Filing a new one

- **Found something new** → add a row here, with the **measured** evidence, not a
  description. "Off by exactly 122.00" is a defect report; "reconciliation looks wrong" is a
  feeling.
- **Fixed something** → move it to `archive/defect-register.md` with the commit that fixed
  it. Do not delete it.
- **Proved it a false alarm** → move it to that file's *not a defect* table with what
  actually caused the reading. Silently dropping it means the next person rediscovers and
  re-reports it.

A stale register is worse than none: it is how a real regression gets waved through as "oh,
that's the known one".

## 5.2 Open by decision, not by patch

These two stay listed so nobody re-files them as new findings. Neither is a defect with a
right answer; both are in §6's territory.

- **Outbound notification channels do not deliver.** `packages/domain/src/notifications/engine.ts`
  delivers **in-app only**: every other channel is stamped `"queued"` and nothing drains the
  queue. The channel type is `"in_app" | "email" | "push"` — there is **no WhatsApp channel**,
  modelled or otherwise, so earlier notes claiming one were wrong. An SMTP transport exists
  (`packages/api/src/smtp-client.ts`, used by the settings test-send), so email is no longer
  a missing-transport problem — it is a delivery/retry decision for a product that is
  normally offline.
- **The API-key and webhook backend has no consumer.** `packages/domain/src/api-keys`,
  `packages/domain/src/webhooks`, their contracts and their routes. The two screens that
  drove them were deleted (F129) because a desktop, offline-first v1 has nothing to call
  them, and API keys are not used for request auth either. Removing the rest reaches into
  the webhook dispatcher that document events run through — a wider change than deleting a
  screen, so it is filed rather than done.

## 5.3 Two seeded paths that prove nothing

The demo seed deliberately steers around both, to keep the books exact: **its physical
counts net to zero**, and **no work order is completed**. So the demo data is not evidence
that either path is sound. Exercise them by hand.

---

# 6. Decisions waiting on a human

A defect has a right answer and belongs in §5; a decision here has two or more defensible
answers, and each changes a shared contract, so it is not a one-line patch.

**Taking a decision** → record the option chosen and why, move the row to *decided*, and
link the commit that implemented it. Do not delete it — the next person needs to know the
alternative was considered and rejected. **A decision that turns out to have a right answer**
was a defect; move it to §5 with measured evidence. Each entry below states the options, not
a recommendation dressed as a fact; where one option has the smaller blast radius, that is
said explicitly.

## 6.1 Open

#### DEC-2 — The gate expects role codes; two routes pass permission codes

`GateStep.role` is a **role code** — `gate.ts`'s own doc comment, its tests, and
the reference product's role picker all agree. But `sales-invoices-routes.ts`
and `vouchers-routes.ts` pass `ctx.permissions` (the resolved *permission* set)
as `actorRoles`. A role code is never a permission code, so a role-gated step
configured through `/settings/workflow` can only be satisfied by the
company-admin `"*"` bypass through those two handlers.

The approvals endpoints resolve the real role code via `uow.users` → `uow.roles`
and behave correctly, so the two sides currently disagree.

| Option | Effect |
|---|---|
| Fix the two routes to resolve the actor's role before calling the gate | Keeps gate semantics as documented; the approvals endpoints already prove the lookup path. **Smaller blast radius, and matches what the type already claims.** |
| Let the gate accept either, matching a step against roles *or* permissions | No route change needed, but broadens the meaning of every existing gate configuration |

#### DEC-3 — `recordPayment` and the allocation sub-ledger are two stores of the same fact

Tracked as **D1** in `archive/defect-register.md`, with a reproduction. The UI prefers
allocations and the aging reports take the larger of the two, but the backend
can still record one collection twice. Converging `recordPayment` onto
allocations removes the fallback entirely — the decision is whether to do that
migration now or keep the two-store read-preference until the collections screen
is rebuilt.

#### DEC-4 — The promotion discount reduces the revenue credit

Surfaced when promotions were persisted onto documents, and deliberately not
taken then: the discount currently reduces the revenue credit rather than
posting to a contra-revenue "discounts granted" account. That is a
chart-of-accounts call, not an application-code call — it changes what the
income statement shows for gross revenue.

#### DEC-5 — The purchase chain emits no events

This build emits **5 of the 39 catalogued events**. The number is derived live
from the bridge mappings in `create-backend.ts`, and
`/notification-rules/triggers` and `/webhooks/events` agree with it exactly. The
purchase order/receipt/invoice chain publishes nothing because it is not a
`DocumentService` and so has no `DocumentEventPublisher`.

The decision: route the purchase chain through `DocumentService`, give it a
publisher of its own, or accept that purchase events cannot be subscribed to.
Inventing bridges for it without deciding was declined.

#### DEC-6 — Leave-policy presets carry inferred statutory numbers

Annual 21 and sick 180 are solid; **casual 7 and paternity 1 under Law 14/2025
are the least certain** and want a legal review before release. Each line cites
its article. Not an engineering decision — it needs someone who can read the
law.

#### DEC-7 — Sales-by-salesperson needs a schema change, not report code

The report needs a rep field on sales invoices. Adding it is a schema migration
plus a field on every invoice-creating surface; the alternative is deriving the
rep from the document's `createdBy`, which is the person who typed it, not
necessarily the person who sold it.

---

## 6.2 Proposed, not yet opened

Eleven decisions are proposed in `artifacts/best-erp-in-egypt.html` §14, each with its
options stated. They are recorded here by reference rather than transcribed, because none
has been put to anyone yet:

- **DEC-8** which QuickBooks is the baseline — and Intuit is retiring non-Enterprise
  Desktop, which erodes the evidence base under one of the options over time
- **DEC-9** does the e-receipt build assume POS
- **DEC-10** ship without a wired e-seal
- **DEC-11** is contracting in scope — the research behind it is `archive/contracting/`
- **DEC-12** does HR come back, and against what
- **DEC-13** do we claim Law 6/2025 support, and when
- **DEC-14** hide or delete the cut screens
- **DEC-15** is the desktop bet a moat or a shrinking segment
- **DEC-16** does POS come back into v1
- **DEC-17** finish or delete the API and webhook back end — it cannot stay as it is, built
  and consumed by nothing (§5.2 lists it as open by decision for exactly this reason)
- **DEC-18** how many dimension axes beyond the single cost centre

Taking any of them means moving it into §6.1 or §6.4 with the option chosen and why.

**DEC-15 and DEC-16 are the two that decide what product this is**, and **DEC-13 is the one
with a clock on it** — no competitor models the Law 6/2025 turnover regime today, and any of
them could build it in a sprint.

## 6.3 Longer-standing product decisions

These predate the build and are carried in `archive/plan.md` §6.3 (`backlog.md`, which also held them, was merged into `archive/plan.md` on 2026-08-27);
none of them blocks ongoing development, but each blocks calling its specific
issue done: licensing mechanism finalization, the installment late-fee rule,
FIFO-in-v1 scope, delivery notes, branch-scoped numbering, lead → opportunity
conversion mechanism, projects progress billing (مستخلصات), and a third locale.

---

## 6.4 Decided

| # | Decision | Taken |
|---|---|---|
| — | **Purchase receipt/invoice cancel routes 404** — turned out to be a defect, not a decision: `create-backend` now passes `purchases.layers`, which mounts both. Cancelling a confirmed invoice marks the original entry `reversed` and posts a linked mirror entry, and an invoice whose goods were already sold is refused with `PURCHASE_ITEMS_ALREADY_CONSUMED`. | 2026-08-25 |
| — | **Promotions persisted onto documents** as a value snapshot, not a foreign key, so a campaign edited later cannot retroactively change what a historical invoice says it granted. Evaluated server-side at confirm against the invoice's real lines. | 2026-08-25 |
| — | **`AuditEvent` carries `branchId`**, recorded from the scope the shell already sends and filterable in the viewer. Historical rows stay null: the table is append-only by trigger, so a back-fill is impossible by design and a default would fabricate evidence. | 2026-08-25 |
| — | **Automated business-logic test execution is disabled** in favour of live verification against a seeded backend. Reversible; the reasoning and the replacement are in `TESTING.md` §1. | 2026-08-23 |

#### DEC-1 — Workflow `minAmount` — CLOSED 2026-08-27, moot

Resolved by removal rather than by decision. `minAmount` no longer exists anywhere in the
repo — not in `/settings/workflow`, not in the workflow config, not in
`DocumentWorkflowInput`. The threshold the UI once presented as enforced is gone, so there
is no longer a gap between what the screen promises and what the gate reads, and none of
the three options below were taken.

Kept as a record because the failure shape recurs: a configurable field that no code path
reads looks identical, on screen, to one that is enforced.

---

# 7. Beyond parity — the enhancement backlog


> **These are ENHANCEMENTS beyond 1:1 parity with the reference app.** **None is started, and none is on `main`** — `main` remains parity-only. Work on any of them belongs on its own branch tracking `main`.
>
> This is a **phased backlog of candidate issues**, ready to turn into tracker tickets later. Each candidate cites its requirement (`ENH-###`, `archive/enhancements/requirements.md`) and enabling workflow (`WF-##`, `archive/enhancements/workflows.md`). Sizes: S ≤1wk · M 1–3wk · L 3–6wk · XL >6wk. Estimates are relative to an already-built parity module and are planning inputs, not commitments.

---

## Sequencing principles

1. **Parity first.** Every candidate depends on its parity module existing on `main`; nothing starts before its dependency lands.
2. **Value-dense before broad.** Phase E1 is the six items every persona notices immediately.
3. **Shared substrate early.** The **Audit Ledger** (ENH-050) and the **event/notification taxonomy** underpin many later items — build them early.
4. **Vertical unlocks together.** Expiry/FEFO + van + reorder ship as the "distribution & pharma" cluster.

---

## Phase E1 — Foundation & daily-driver value (Must)

> Goal: the enhancements an owner, accountant, and auditor feel on day one, plus the shared substrate later phases build on.

| Issue | Title | Req | WF | Size | Depends on (parity) |
|---|---|---|---|---|---|
| ENH-E1-01 | Live Owner Cockpit dashboard | ENH-001 | WF-01 | L | Dashboard, Sales, Treasury, Inventory, Reports |
| ENH-E1-02 | Cash-runway & liquidity forecast | ENH-002 | WF-01 | M | Treasury, cheque register, AR, AP |
| ENH-E1-03 | Smart bank reconciliation | ENH-011 | WF-03 | L | Treasury, Accounting, import |
| ENH-E1-04 | Guided month-end close workspace | ENH-010 | WF-02 | L | Accounting periods, sub-ledgers, Multi-currency |
| ENH-E1-05 | Immutable searchable audit ledger (substrate) | ENH-050 | WF-13, WF-14 | L | Platform audit log, all module events |
| ENH-E1-06 | Verified backup & restore drills | ENH-060 | WF-15 | M | Desktop backup, Licensing |

**Exit criteria:** owner opens the cockpit daily; a period can be closed through the guided workspace; every sensitive change is in the audit ledger; a restore drill passes.

---

## Phase E2 — Per-persona wins (Should)

> Goal: concrete wins for accountant, warehouse, cashier, sales, and compliance built on the E1 substrate.

| Issue | Title | Req | WF | Size | Depends on |
|---|---|---|---|---|---|
| ENH-E2-01 | ETA e-invoice pre-validation & bulk resubmit | ENH-011b | WF-04 | L | Sales, ETA integration |
| ENH-E2-02 | Recurring & template journal automation | ENH-012 | WF-02 | M | Accounting, Fixed Assets, scheduler |
| ENH-E2-03 | Scanner-driven physical stock count | ENH-020 | WF-05 | L | Inventory, barcodes, companion device |
| ENH-E2-04 | Expiry tracking & FEFO engine | ENH-021 | WF-06 | L | Inventory costing/warehouses, dispatch |
| ENH-E2-05 | Keyboard/scanner-first POS fast lane | ENH-030 | WF-09 | M | POS selling screen |
| ENH-E2-06 | In-till discount approval | ENH-031 | WF-09 | M | POS, realtime, Audit ledger (E1-05) |
| ENH-E2-07 | Crash-safe / resumable cart | ENH-032 | WF-09 | S | POS |
| ENH-E2-08 | Price-floor & margin guardrails | ENH-041 | WF-11 | M | Sales pricing, Inventory cost, Workflow |
| ENH-E2-09 | Automated AR dunning / collections | ENH-043 | WF-12 | M | Sales AR, Notifications, CRM |
| ENH-E2-10 | Segregation-of-duties conflict detection | ENH-051 | WF-13 | M | Roles/permissions, Workflow, Audit ledger (E1-05) |
| ENH-E2-11 | Bulk user/role provisioning & onboarding | ENH-061 | WF-16 | S | Users/Roles, Licensing |

**Exit criteria:** ETA rejection rate drops; stock counts run on a device; POS is keyboard-first with approvals and crash recovery; below-floor sales are blocked; maker-checker SoD is enforced.

---

## Phase E3 — Depth, reach & extensibility (Could)

> Goal: broaden reach (mobile, CRM depth, van/distribution), close the audit loop, and open the platform.

| Issue | Title | Req | WF | Size | Depends on |
|---|---|---|---|---|---|
| ENH-E3-01 | Read-only remote/mobile glance | ENH-003 | WF-01 | L | Cockpit (E1-01), sync transport |
| ENH-E3-02 | Owner daily digest & anomaly alerts | ENH-004 | WF-01 | M | Notifications, Reports |
| ENH-E3-03 | Reorder-point & replenishment suggestions | ENH-022 | WF-07 | M | Inventory, Purchases, velocity reports |
| ENH-E3-04 | Van/mobile-warehouse reconciliation | ENH-023 | WF-08 | M | Inventory transfers, Sales rep, Treasury |
| ENH-E3-05 | Digital shift & cash-drawer reconciliation | ENH-033 | WF-10 | M | POS, Treasury, Accounting |
| ENH-E3-06 | CRM opportunity pipeline | ENH-040 | WF-11 | L | CRM, Sales quotes |
| ENH-E3-07 | Quote→order→invoice funnel & rep leaderboard | ENH-042 | WF-11 | M | Sales docs, CRM, Reports |
| ENH-E3-08 | Auditor read-only evidence pack | ENH-052 | WF-14 | M | Reports, Accounting, Audit ledger (E1-05), Roles |
| ENH-E3-09 | Integration API, webhooks & connectors | ENH-062 | WF-17 | L | Hono API, event taxonomy, Auth |
| ENH-E3-10 | System-health & multi-till console | ENH-063 | WF-16 | M | LAN multi-till, Licensing, Backup |

**Exit criteria:** owner has a mobile glance; distribution cluster (reorder+van) live; CRM is a pipeline; evidence pack exports in one click; external systems integrate via API.

---

## Horizon (Won't-yet — parked)

Deliberately deferred; not scheduled. Revisit after E3.

| Idea | Note |
|---|---|
| AI-assisted natural-language reporting | "Ask a question about my data" over the report engine; needs BI substrate (E1) first. |
| WhatsApp order intake / catalog | High local demand; large integration + compliance surface. |
| Loyalty & promotions deepening | Beyond the parity loyalty add-on; retail vertical polish. |
| BOQ / progress-certificate / retention billing | Contracting vertical (named catalog gap); scope its own epic. |
| Multi-currency as a licensable module + IAS-21 FX depth | Packaging + accounting-depth decision, per `archive/plan.md` §8. |
| Cheque endorsement/replacement states | Extends the 7-state lifecycle; niche but real. |

---

## Roll-up

| Phase | Candidates | Sizes |
|---|---|---|
| E1 (Must) | 6 | 4×L, 2×M |
| E2 (Should) | 11 | 3×L, 6×M, 2×S |
| E3 (Could) | 10 | 3×L, 7×M |
| Horizon | 6 | unsized |
| **Total scheduled** | **27 candidates** (28 requirements; ENH-042 & ENH-040 share WF-11, all mapped) | — |

All candidates trace to a requirement in `archive/enhancements/requirements.md` and a workflow in `archive/enhancements/workflows.md`. Beyond-parity; not on `main`; each belongs on its own branch tracking `main`.

---


---

# 8. Shell follow-ups


Queued behind the i18n sweep, in the order requested.

## 8.1 A better Arabic typeface

The Arabic face is currently whatever `font-ar` resolves to in
`packages/ui/src/tokens.css`. Pick a face that carries the design's weight range
and reads well at 12–13px, the size most of the app's body copy runs at, and
check it against the Latin face already in use so mixed runs (an Arabic label
next to `INV-000001`) sit on the same baseline.

## 8.2 A real icon per sidebar item

Every nav row currently renders a single letter in place of an icon — "S" for
Sales invoices, "P" for Price lists, and so on. Two rows starting with the same
letter are indistinguishable at a glance, which is the whole job an icon does.
115 nav entries need icons, or a rule that produces one per entry.

## 8.3 Organising the sidebar

115 entries in 17 groups. Worth revisiting grouping and order once icons land,
since the two decisions interact.

## 8.4 Search in the sidebar

The topbar command bar (`⌘K`) already searches nav entries, so this is about
whether the rail ALSO needs a filter. Note the command bar currently matches nav
items only — searching it for a report title ("قائمة الدخل") returns nothing,
which is worth fixing whichever way this goes.

## 8.5 A customisable main dashboard

`apps/web/src/dashboard/DashboardScreen.tsx` renders a fixed layout: the
balance-beam hero, the KPI strip, the attention queue, then four panels in a
hard-coded order (aging matrix, expense donut, top items, recent activity),
plus four fixed quick actions and a month/year/all range selector. Every
figure is real, but every user sees the same arrangement. A warehouse keeper
and an accountant want different things at the top of the screen.

The task is to let a user choose which panels appear, in what order, and keep
that choice. Concretely:

- Turn each panel into an addressable widget with a stable id, so a stored
  layout can name it. `Panel` is already a local component; the widget
  registry is the new part.
- A layout editor — show/hide per widget, reorder, and a reset-to-default. Two
  or three column-span sizes are probably enough; a free-form drag grid is more
  than this screen needs.
- Let the quick-action row be chosen too. It currently hard-codes four screens
  in `quickActions`; the set that matters differs per role.

Open questions worth settling before building: whether the layout is per user
or per role (per user is the usual answer, per role is what makes it useful on
day one of a rollout without every clerk configuring their own), and whether an
admin can push a default layout to everyone.

## 8.6 Somewhere to store per-user preferences

There is no per-user preference store anywhere in the repo — confirmed by
search across `packages/domain/src`, `packages/persistence/src` and
`packages/contracts/src`. Task 5 needs one, and it is not the only thing that
will: saved list filters, default branch, and the range the dashboard opens on
all want the same shelf.

Build it once as a small keyed store scoped to `(userId, key)` holding a JSON
value, behind the existing repository-port pattern so the Postgres dialect
comes free later. Do this before task 5, not inside it.

## 8.7 Widget visibility follows permissions

Whatever a user can put on their dashboard has to respect the permission
matrix — a user without `reports.aging.read` must not be able to add the aging
matrix, and a layout stored before a permission was revoked must degrade
quietly rather than render an error card. Worth building into the widget
registry from the start; retrofitting a permission check onto a stored layout
is where this kind of feature usually leaks data.

## 8.8 Mirror the directional icons under RTL

The app is Arabic-first and runs RTL, but almost nothing in the icon set is
mirrored. `packages/ui/src/primitives/beams.tsx` is the only place that does it
(`rtl:-scale-x-100`, and its comment explains why: a rise must lift towards the
reading direction). Everything else — the lucide set imported in
`apps/web/src/nav-icons.tsx` and the inline icons across the screens — renders
LTR-handed in an RTL layout.

Icons that carry a direction have to flip; icons that carry an object must not.
`Send` pointing away from the reader, `Undo2` and `RotateCcw` curving back,
`ArrowLeftRight` / `ArrowRightLeft` on the transfer screens, `TrendingDown`,
and the list/indent family (`ListOrdered`, `ListChecks`, `ListTree`,
`ClipboardList`) all read backwards in Arabic. A clock, a coin, a building or a
magnifier does not — mirroring those is the usual overcorrection, and
`PackageSearch` is the borderline case worth deciding once.

Do it as a rule, not per call site: mark the directional subset in one place
(the icon registry is already centralised in `nav-icons.tsx`) and have the
wrapper apply `rtl:-scale-x-100`, so a new screen cannot reintroduce an
unmirrored arrow. Then sweep the inline SVGs and glyph arrows outside that
registry — the chevron in `Select.tsx` rotates on the vertical axis and is
correct as-is, but the sweep is what proves there are no others.

Verify in the running app in both directions, not by reading the diff: this is
exactly the class of defect that passes typecheck and every test.

---

