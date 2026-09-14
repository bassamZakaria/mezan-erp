# Mezan — roadmap: what is built, what is next, and everything still on the list

**The single roadmap document.** It holds what used to sit in four files — the status
record, the work list, the defect register and the decision register — because they only
ever made sense read together: a task is open *because* a defect is open, or *because* a
decision has not been taken.

Companion: `TESTING.md` — the testing policy, the regression plan, and all 1,686 scenarios.
`archive/plan.md` is the durable reference underneath both: architecture (§1–§3), the market and
competitor study (§8), and the deferred HR/POS/Cloud build plans (§9).

**Updated 2026-09-14.** v1 = Electron desktop, SQLite, real data, Arabic-first.

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
| **Open now (§3)** | **Nothing.** Row menus answered (no), contracting complete, outbound notification delivery landed 2026-09-14 |
| **Deferred by decision (§4)** | POS, statutory payroll, HR depth, cloud — not scheduled, not defects |
| **Defects (§5)** | **0 open as defects** of the 80 filed (D66–D145): 75 fixed, 4 partial, 1 moved to a decision. Every remaining open half is a DECISION with its options stated, not code waiting to be written — D79 (a `taxRateId` on the invoice line), D90 → DEC-19 (in-transit transfers), D111 → DEC-20 (a branch dimension on the GL), D116 (the catalogue overstates a descoped POS), D138 (cross-branch staff reassignment) |
| **Compliance (§5.4)** | The B2C e-receipt, the e-seal seam and نموذج 41 landed 2026-09-07. Three named buyer segments could not legally transact before it |
| **Decisions (§6)** | Seven open (DEC-3 … DEC-7, DEC-19, DEC-20) |
| **Beyond parity (§7)** | 27 candidates across E1–E3, none started; `enhancements` branch only |
| **Shell follow-ups (§8)** | **7 of 8 done.** Only §8.3 (sidebar grouping) is left, and it is a judgement call with no defect behind it |

## 1.1 Signals

| Signal | Value | Measured |
|---|---|---|
| Nav destinations | **115** | 2026-08-29, from `nav-config.tsx` |
| Routable screens | **116** | 2026-08-29, from `App.tsx`'s `ROUTABLE_SCREENS` |
| Read surfaces answering `pnpm smoke` | **199** | 2026-08-29, run green |
| «قريباً» placeholders outside HR | **0** | 2026-08-27 |
| Reference screens still absent | ~14, all POS or POS-adjacent | 2026-08-26 audit |
| `pnpm scenarios` | **6,697 passing, 0 failing** | 2026-09-14 |
| `pnpm test` | **9,997 passing, 0 failing** over 856 files | 2026-09-14 |
| The four ledger invariants | all at exactly zero — trial balance, inventory vs GL 1200, AP vs GL 2100, AR vs GL 1105 | 2026-08-27 |
| Typecheck · lint · RTL · native controls · permission labels · theme colour-only | all passing | 2026-09-11 |
| `pnpm smoke` | 240 read surfaces, all responded | 2026-09-14 |
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

**A full run used to fail a different handful of screen tests every time while every
one of them passed in isolation.** Two clocks, neither of them the product:
testing-library's `waitFor` deadline is 1s, and vitest's per-test budget is 5s, so under
824 parallel files a screen that refetches ran out of one or the other. The deadline is
now 5s inside a 30s budget (`packages/ui/src/test/setup.ts`, `vitest.config.ts`). Worth
knowing, because a red run that goes green on a re-run trains people to re-run rather
than to read — and this repo's real defects hide in exactly that noise.

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
  and the ~286-permission matrix (20 modules), print templates, eight settings policy tabs whose toggles
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

**Re-verified 2026-09-07 against the tree; §3.2 added 2026-09-13.** The two items below are still open, and
§5 now carries the larger list. What landed on 2026-09-07 is in §5.4. §3.4 records what moved and why, so nothing is silently dropped.

## 3.1 Row menus on the remaining 17 list screens — R1.3, closed 2026-09-14

- [x] **Answered: no, and the item is closed.** The roadmap called this "a question, not a
      backlog item", and the question has an answer. All 17 are read-only report surfaces
      (audit log, stock balance, cost-centre P&L, reconciliation, FX revaluation, leave
      balances and accruals, attendance) or flat master data whose only per-row action is an
      inline edit (departments, job titles, holidays, asset categories, leave policies,
      payroll components, pipeline stages, item specifications, product templates). None
      carries a lifecycle, so a state-dependent menu on them would hold exactly one entry —
      a control that exists to tell the user it has nothing to offer. The inline edit these
      screens already have IS the row action.

## 3.2 المقاولات — the contracting module, by slice

The design is `artifacts/mezan-contracting-designs.html` (twelve decisions taken, six
build slices). Every slice below was built, seeded, driven on a seeded backend, and then
read by a six-reviewer panel (technical office, external auditor, internal auditor,
revenue-recognition specialist, subcontracts manager, everyday accountant) whose findings
were closed in the same pass — 2026-09-13/14.

- [x] **Slice 0 — the dimension.** `projectId` + `costCategory` on `journal_line`, on every
      GL posting port and on all ten posting paths plus their twins; a category without a
      project is refused; contracting-slot accounts refuse a line with no project; the
      nine `contracting.*` permissions plus three for guarantees; the `contracting`
      entitlement module; cost-centre P&L rollup; project P&L by the two dimensions;
      project pickers on nine forms.
- [x] **Slice 1 — contract & BOQ.** Contract on the `CTR-` sequence with every commercial
      term as a per-contract parameter (نسبة الممارسة, retention + cap, advance + recovery,
      التشوينات, social-insurance pair, WHT, VAT basis derived from the signing date under
      Law 157/2025, payment term, DLP, recognition policy, ETC with a reasoned revision log),
      BOQ with a stored unit enum and Excel import that reviews before it commits, variation
      orders whose approval date is bounded to [document date, today] and decides which
      certificates they reach. One live contract per project.
- [x] **Slice 2 — المستخلص.** Cumulative lines with the period as a subtraction, التشوينات
      (editable, incorporated as a negative), deductions computed on the cumulative and
      differenced, rounded to piastres, VAT added on the contract's basis, dates bounded
      periodTo ≤ measured ≤ certified ≤ approved ≤ today, three people enforced with a
      tenant `singleOperatorMode` switch, generated invoice crediting billings (cost-to-cost)
      or revenue (certified value), balanced deductions entry, advance guarantee reduced,
      AR sub-ledger == GL, void with mirror + invoice reversal, monotonic serial, cancel with
      reason, internal certificate, paginated landscape print (ما قبله / يُرحل).
- [x] **Slice 3 — the mirror.** Subcontracts back-to-back on the client BOQ, the ceiling
      against the client's certified line net of sibling subcontracts, sub certificates through
      the same arithmetic, deductions bounded, retention payable 2195 released through a real
      purchase invoice (AP == GL), WHT to 2210 and onto Form 41, social insurance withheld to a
      liability, transitional VAT into cost, tax-number + bank-account gate, labour-only flag.
- [x] **Slice 4 — cost & recognition.** Site stores with a custodian, two-step issue/receipt
      (different users, dates bounded, shortfall standing in transit), consumption as the only
      stock-to-cost conversion (Dr WIP), custody register, plant hours at the asset's own rate,
      the monthly EAS 48 run with an explicit contract-cost account set, WIP relieved by
      category to zero, contract asset/liability per contract, onerous provision independent
      of the policy switch, recomputed-vs-posted divergence shown.
- [x] **Slice 5 — controls & guarantees.** Guarantee register with memorandum accounts outside
      every statement, restricted cash margins, facility limits, own permissions and dated,
      attributed actions; seven exception reports (the design's six plus cost overrun vs
      estimate) each printing its rule; retention release as a due receivable dated from the
      release event, creator ≠ releaser, early releases needing a second approver; the
      retention calendar on both sides; dashboard tile.
- [x] **Ledger and platform.** `/audit?module=contracting` carries every transition with the
      real actor; `/reconciliation` proves ten control rows; memorandum lines balance within
      their own partition; posting dates must be `YYYY-MM-DD`; historic periods are closed by
      the seed; a closed-period refusal answers 409 and the server has a global error handler
      and an unhandled-rejection guard; sales invoices on a cost-to-cost project bill through
      2165; sales reports and their GL reference read one fact; contracting entries name
      their module; certificate invoices reach the ETA queue.

Verified 2026-09-14: `pnpm typecheck`, `lint`, `build`, 9,911 vitest tests, `pnpm smoke`
(240 surfaces), `pnpm check:seed`, `pnpm scenarios` green, and the module walked in Chrome
(certificate approval from the screen produced the invoice with remaining balance equal to
the net payable).

**Nothing open.** The four items this section listed are closed: BOQ unit codes render
through `lib/boq-unit-label.ts` (م٣ / مقطوعية) on both the grid and the print, percentages
go through `lib/percent.ts`, and `53b83b56` added the Law 182 «تأمين نهائي» posting for
public contracts plus an effective-dated internal plant rate. The two empty exception
reports (`boq-overrun`, `late-variation-approvals`) are allowed-empty BY DESIGN and say so
on screen — an empty report whose rule is printed is not a defect.

## 3.3 Outbound notification channels — closed 2026-09-14

- [x] `NotificationDispatcher` drains the queue, and the decision the roadmap asked for is
      the part that matters. **Being offline is not a delivery failure**: this product is
      offline by default, so an unreachable server leaves the message queued, unchanged,
      and the next drain retries it. Two things end an attempt — a server REJECTION (a bad
      address, a refused auth, neither fixable by retrying, and hammering a refused login
      gets the tenant's account locked), and going STALE: a «فاتورة جديدة» notice three
      weeks late is noise, and a month of backlog arriving the moment a shop reconnects is
      worse than sending nothing. Draining is an OPERATOR ACTION, never a timer — a
      background sender that fires while nobody is watching is how a shop discovers it has
      been emailing its customers for a week. The transport is the same SMTP session the
      settings test-send uses, so it inherits D133's refusal to put a password on a plain
      wire; a channel with no transport is skipped rather than failed, because push is a
      channel this build does not have and failing it would tell the tenant their message
      was rejected. `POST /notifications/drain`, gated on `admin.settings.edit`.

## 3.4 Recently settled — no longer open

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

Cloud-1 #6–8 (models only) and Cloud-3 #13 landed 2026-09-13 as `packages/domain/src/platform`,
`packages/persistence/src/platform-store.ts` and `createPlatform` in `packages/backend`: tenant,
plan and subscription records, one SQLite database per tenant, and the two derivations that
feed the existing entitlements and licence-state gates. Per-request tenant routing, onboarding,
the platform console and billing remain open — see
`superpowers/specs/2026-09-13-saas-tenant-models-design.md`. Seeded plan prices are zero until
the owner sets them.

---


---

# 5. Defects

## 5.0 Open

**Seventy-eight filed 2026-08-30 by the test-coverage pass** (D66–D143). D128 and D129 are holes in PR #54's own security fixes, found by writing the tests it did not have. D109 — an unauthenticated device on the shop wifi posting to the books — was the most serious, and PR #54 closed it (S8/S9): the desktop shell now builds `createBackend`, so the header resolver is gone from the edition that binds a LAN socket, and every `/lan/*` route needs a session. D99's gate is closed in this pass (the legacy poster now requires `accounting.journal.post`); what remains of D99 is that the route still skips the fiscal-period and account checks its `/gl` replacement performs, and should be deleted. They were found by
writing tests and manual scenarios against the real code, so each carries a file reference
rather than a feeling. The ones marked **guarded** already have a passing test that pins the
current behaviour and will go red the day it changes; the ones marked **reported** still
need a measured reading in the running app before anyone fixes them.

| # | Defect | Evidence | State |
|---|---|---|---|
| D66 | Every physical-count mutation invalidates `["inventory","physical-counts"]` while the screen reads `["physical-counts", filter]`, so الجرد الفعلي never refreshes: starting a count posts and the list bounces back empty, completing one leaves the row on قيد التنفيذ | `apps/web/src/data/inventory-ops-hooks.ts` vs `apps/web/src/data/hooks.ts` | fixed 2026-09-07 — the mutations and the screen now agree on the `["physical-counts", filter]` key, so starting a count no longer bounces back empty and completing one leaves the row on مسدد |
| D67 | `TextField`/`NumberField`/`TextAreaField` render a `<label>` with no `htmlFor` and no matching `id`, so no plain text field in the app is programmatically labelled — clicking the label does not focus, and a screen reader announces nothing | `apps/web/src/settings/form-controls.tsx` → `packages/ui/src/primitives/form.tsx` | fixed in this pass — `TextField`/`NumberField`/`TextAreaField` generate an id with `useId` and pass `htmlFor`/`id`, so `getByLabel` reaches every field built on the wrapper (guaranteed in `form-controls.test.tsx`, and live in `journals.spec.ts`) |
| D68 | The VAT return's «صافي الضريبة المستحقة الدفع» line never renders: the report screen prefers a report-declared `chart` over `renderSummary`, and the VAT return declares both | `apps/web/src/screens/reports/ReportScreen.tsx`, `packages/domain/src/reports/vat-return.ts` | fixed 2026-09-07 — `ReportScreen` renders a report-declared `chart` AND its `renderSummary`, so «صافي الضريبة المستحقة الدفع» is on screen |
| D69 | The tenant-admin bypass on `POST /workflow/requests` is dead — the route is ungated, so no gate stashes an AuthContext and `callerRoleCodes` returns `[]`; an admin's own submission is held بانتظار الموافقة | `packages/api/src/workflow-routes.ts` | fixed 2026-09-11 — the route reads the roles off the AuthContext it resolves itself, instead of the one a gate stashes. It is ungated by design, so `callerRoleCodes` answered `[]` for everyone and the tenant-admin bypass could never fire |
| D70 | Quotes, van trips and sales returns gate on the plain `.view` tier while `SALES_REP`/`VAN_SALES` hold only `.view_own`, so a rep gets 403 on their own work; sales invoices get this right with `gateAny` | `sales-quotes-routes.ts`, `field-sales-routes.ts`, `sales-returns-routes.ts` | fixed 2026-09-07 — quotes, van trips and field sales all take `gateAny(view, view_own)`. A quote records no author, so `view_own` is evaluated against the caller's branch scope and a `view_own` caller holding the all-branch sentinel is shown nothing rather than the tenant. The quote DETAIL route was unscoped entirely and now 404s outside scope |
| D71 | Customer routes carry no branch or rep scoping at all, and the catalog defines a single `sales.customer.view` tier — every rep sees the whole company's customer book | `packages/api/src/customers-routes.ts` | fixed 2026-09-11 — customers and suppliers carry a nullable `branchId`, stamped from the creating caller's own scope. The list, the chips and the detail route all narrow by it, and an id outside scope answers 404 rather than confirming the record exists. Null stays visible to everyone on purpose: every record written before the column existed has none, and hiding them would empty the screen for a branch-scoped user rather than protect anything |
| D72 | The three purchasing policy toggles in settings (`requirePoForGrn`, `requireGrnForInvoice`, `trackSoldPurchaseItems`) reach no route: the server always runs `DEFAULT_PURCHASE_POLICY` | `packages/backend/src/create-backend.ts` → `packages/api/src/purchases-routes.ts` | fixed — and it already WAS. `createApp` derives the policy from the live tenant settings whenever a settings store is mounted, and `createBackend` mounts one. Nothing measured it end to end, which is how this row sat open against working code; three tests now drive the toggles through the real API, including that flipping one takes effect with no restart |
| D73 | The "from order" goods-receipt screen has no editable quantity field, so every receipt taken through the browser is 100% of the outstanding quantity — a real partial delivery cannot be recorded, though the domain supports it | `apps/web/src/screens/GoodsReceiptsScreen.tsx` | fixed 2026-09-07 — the from-PO receipt takes a quantity per line, so a partial delivery can be recorded |
| D74 | Several domain refusals build English-only messages that reach the Arabic UI verbatim (`OverReceiptError`, `PurchaseOrderNotReceivableError`, the permission gate's `Missing permission '…'`, the fiscal-period errors) | `packages/domain/src/purchasing/errors.ts`, `packages/api/src/permission-gate.ts`, `packages/domain/src/fiscal-periods/errors.ts` | fixed 2026-09-11 — twenty-two refusals across purchasing, the fiscal periods and the permission gate are Arabic. `arabic-refusals.test.ts` walks the exported error classes rather than listing them, so one added in English fails on the day it is written — it caught one this pass the sweep had missed |
| D75 | Landed cost posts its payable to a generic clearing account with no supplier dimension, so the freight/customs liability exists in the GL and on no supplier's account | `packages/domain/src/landed-costs/` | fixed 2026-09-11 — and it was worse than filed. The accrual credited GL 2100, the AP CONTROL account, and the supplier sub-ledger ADDED every landed cost to its own figure to compensate — so the reconciliation tied only because both sides were wrong in the same direction, and nothing measured it. The accrual now posts to 2130 تكاليف إضافية مستحقة, the sub-ledger no longer inflates itself, and each cost item records the vendor it is owed to |
| D76 | A confirmed sales or purchase RETURN aggregates every line's tax into one untagged journal line, so the per-line `taxRatePercent` that D28 added does not extend to returns and the VAT return cannot split a mixed-rate return by rate | `packages/domain/src/sales-returns/`, `packages/domain/src/purchase-returns/` | fixed 2026-09-07 — the domain half landed earlier; the WIRING is now done too. Both `findConfirmedInvoice` adapters in `create-backend.ts` carry the invoice line's real tax amount and rate onto the return, so a return of a VAT-charged invoice credits VAT |
| D77 | Confirmed returns are never enqueued to ETA, though the domain models `credit_note` and `debit_note` | `packages/domain/src/eta/` | fixed 2026-09-11 — a confirmed SALES return is queued as an إشعار دائن referencing its source invoice. Purchase returns deliberately are NOT: that credit note is the supplier's to file, and filing it here would declare a document this company never raised |
| D78 | The ETA payload hardcodes `currencySold: "EGP"` on every line regardless of the document's currency | `packages/domain/src/eta/` | fixed 2026-09-11 — the payload carries the document's real currency. A foreign line states the sold amount, the rate it was booked at and the EGP equivalent; a foreign document with NO rate is refused rather than filed at par; an EGP line is unchanged and carries no rate, which is what the authority expects. Wired from `invoice.currency` / `invoice.fxRate` in `create-backend.ts` |
| D79 | The ETA sub-type resolver matches by tax-rate value alone, so exempt (V003) and zero-rated export (V001) items — both 0% — can be filed as each other | `packages/domain/src/eta/` | PARTLY fixed 2026-09-11 — `findLineTaxRate` returns null when the rate value maps to more than one classification, and the caller falls back to the neutral V004 rather than making a specific claim the books never made, so an exempt sale can no longer be filed as an export because the rates happened to be created in that order. STILL OPEN: the complete fix is a `taxRateId` ON THE INVOICE LINE so the identity is never re-derived from a number — the same shape of change D97 made for the cost centre |
| D80 | Cheque transitions record no actor: the seven-state lifecycle has no audit attribution, so nobody can be asked who deposited or bounced one | `packages/domain/src/cheques/cheque-service.ts` | fixed 2026-09-07 — every cheque transition carries its actor, so the seven-state lifecycle can be asked who deposited or bounced one |
| D81 | A voucher whose payment method is «شيك» never creates a cheque record, so the cheque register misses every cheque raised through the voucher screen | `packages/api/src/vouchers-routes.ts` | fixed 2026-09-07 — a «شيك» voucher raises a cheque record. Three fields the voucher wire contract does not carry (drawee bank, due date) are named in `vouchers-routes.ts` and still have to come from the form |
| D82 | Finalising a bank statement never checks for unmatched lines, so a reconciliation can be closed with differences still open | `packages/api/src/bank-reconciliation-routes.ts` | fixed in this pass — `finalize()` REFUSES (`STATEMENT_HAS_UNMATCHED_LINES`, 422) while any line is unmatched. An explicit `{ force: true, reason }` closes it anyway and the statement records `unmatchedAtFinalize`, `finalizeOverrideReason` and `finalizedBy`, so a reconciliation locked over open differences says so on its own row |
| D83 | When an approval gate holds a voucher, the create wizard never surfaces the `held` flag — the user sees a success and no explanation | `apps/web/src/screens/TreasuryVouchersScreen.tsx` | fixed 2026-09-07 — the create wizard surfaces the `held` flag instead of reporting a silent success |
| D84 | A landed cost naming a receipt whose layers are gone (fully consumed, or a mis-named `sourceDocId`) adds its value to the position but bumps no layer, so layer-level unit costs understate the basis with no signal | `packages/domain/src/inventory/wac.ts` | fixed 2026-09-07 — BOTH halves. The valuation half landed earlier; the GL half posts the unabsorbed share to COGS 5100 rather than debiting the whole landed cost to inventory, so GL 1200 equals the valuation report to the piastre. DECISION TAKEN: COGS over a dedicated variance leaf, because it needs no chart-of-accounts template change and no migration — recorded in §6.4 |
| D85 | `saveRole` exempts the `"*"` wildcard from the licence check and never consults `isPlatformAdminOnly`, so a tenant licensed for no modules can still mint a role holding full admin — and the use-case never sees who is asking, so "you may not grant more than you hold" is enforced nowhere | `packages/domain/src/roles/save-role.ts` | fixed 2026-09-07 — `saveRole` takes the actor: `"*"` is no longer exempt from the licence check, and a platform-admin-only code cannot be granted by a caller who does not hold it. The wildcard is measured against whether the tenant is licensed for ANY licensable module, not all of them — the catalogue always carries `pos`, which has no domain in this repo, so the all-modules reading would have made an admin role un-mintable on every install |
| D86 | `saveUser` accepts `isCompanyAdmin: true` without checking the caller's own privilege; the only gate is `admin.users.edit`, so anyone holding it can promote a user — including themselves, by editing their own record — to full company admin in one PUT. The domain function never sees the actor, so the ceiling can only live in the route, and no route enforces one | `packages/domain/src/users/save-user.ts`, `packages/api/src/users-routes.ts` | fixed 2026-09-07 — `saveUser` refuses `isCompanyAdmin: true` from a caller who is not one, and refuses any write against an account that already outranks the caller |
| D87 | The discount ceiling checks only `discountType: "percent"`, so an `amount`-type discount bypasses `sales.price.override` / `pos.discount.approve` entirely | sales invoice discount validation | fixed 2026-09-07 — the ceiling measures an `amount`-type discount against the line gross, so a 90%-of-line amount discount needs the same approval a percentage does |
| D88 | A purchase invoice takes `unitCost` verbatim from the request with no cross-check against the PO or the receipt it names | `packages/api/src/purchases-routes.ts` | fixed 2026-09-11 — an invoice that names a receipt and restates its cost needs `purchases.receipt.edit_cost`, the same grant that lets someone change the cost on the receipt itself. A gate rather than a refusal, because a real price difference is legitimate — that is what the price-variance account is for |
| D89 | A sales return's `customerId` is never validated against its source invoice's customer, so a confirmed return's refund can be directed at any customer id the requester names | `packages/api/src/sales-returns-routes.ts` | fixed 2026-09-11 — `POST /sales-returns` refuses a customer that is not the source invoice's own, and an item that is not on it. A confirmed return's credit could previously be aimed at any customer while the goods came back against somebody else's invoice — a credit note to a stranger, needing no permission beyond the one that raises an ordinary return |
| D90 | A stock transfer posts both legs in one step with no receiving-side confirmation, so goods can never be recorded as in transit or short on arrival | `packages/domain/src/inventory/stock-transfer-document.ts` | OPEN — moved to §6 as a DECISION (DEC-19), not a defect. In-transit transfers change a behaviour the reference app shares (the catalog documents one-way confirm: «لا يمكن إلغاء تحويل مؤكد … لعكس الحركة أنشئ تحويلاً جديداً بالاتجاه المعاكس»), and they give a deliberately valuation-neutral document a GL consequence, because a shortfall on arrival is a loss that has to post somewhere. That needs a product answer before any code |
| D91 | There is no exception reporting anywhere — no report lists backdated documents, deleted drafts, discounts above a threshold, adjustments by reason, or after-hours postings | `packages/api/src/reports-routes.ts` | fixed 2026-09-07 — RE-SCOPED ON MEASUREMENT: exception reporting was never missing, it was unreachable. `security-reports-routes.ts` has carried `/exceptions`, `/post-posting-changes`, `/after-hours` and `/new-accounts` all along, mounted at `app.ts:1290`, with columns, KPIs and Arabic copy — and zero references anywhere in `apps/web`. The four screens, their nav entries and their routes now exist. No server work was needed |
| D92 | The RFQ detail screen passes the document NUMBER where the quotes and comparison routes resolve only by database id, so the quotes list comes back empty and the comparison 404s | `apps/web/src/screens/RfqsScreen.tsx` | fixed 2026-09-07 — the screen resolves the URL segment (which may be the document NUMBER) to a database id before `useRfqQuotes`/`useRfqComparison` ever see it, so supplier price comparison is reachable from a number-shaped URL |
| D93 | «تحصيل دفعة» on a sales invoice starts with no treasury account selected and no default, so the collection is refused on submit with no cue beforehand — the refund flow on returns does default it | `apps/web/src/screens/SalesInvoicesScreen.tsx` | fixed 2026-09-07 — «تحصيل دفعة» seeds its treasury account from the tenant's own list once the query lands, the way the refund flow already did |
| D94 | Item cost price is served to any holder of the item-list permission regardless of `sales.invoice.view_cost` | `packages/api/src/items-routes.ts` | fixed 2026-09-07 — cost price is gated on `sales.invoice.view_cost` and OMITTED from the payload rather than nulled, since a null reads as "this item has no cost" |
| D95 | `projectSchema` requires `costCenterId`, and neither `createProjectSchema` nor `updateProjectSchema` carries the field — so a project's cost centre can never be set or corrected through the API; the key is stripped on both paths | `packages/contracts/src/project.ts` | fixed 2026-09-11 — `createProjectSchema` takes an optional `costCenterId` and an id that already exists is LINKED rather than recreated, so a project can be booked against a cost centre the books already use. Deliberately NOT on the update contract: re-booking a live project moves every cost already posted under the old centre, which is an accounting decision and not a patch field |
| D96 | `journalLineSchema` — the line shape `createJournalEntrySchema` uses, and the one `app.ts` posts manual entries through — carries only `accountId`, `debit` and `credit`. The cost centre, the currency and its rate, and the tax rate are all stripped, though `gl.ts`'s newer `glJournalLineSchema` carries every one of them. A manual journal entry therefore loses every dimension a later report needs | `packages/contracts/src/journal.ts` vs `packages/contracts/src/gl.ts` | fixed 2026-09-11 — by DELETION. `journalLineSchema` was the weaker duplicate of `glJournalLineSchema`, carried only for the legacy poster D99 removed, so it is gone rather than brought up to parity: two contracts for one posting is how they drift |
| D97 | `createSalesInvoiceLineSchema` has no `costCenterId`, so a revenue line cannot be attributed to a cost centre at creation and the Cost Centre P&L cannot see it | `packages/contracts/src/sales-invoice.ts` | fixed 2026-09-11 — `costCenterId` runs end to end on a sales-invoice line: contract, domain line, SQLite column and migration, route, and `buildSalesInvoiceGlPosting`, which groups the revenue credit by centre as well as account and rate so two centres on one invoice do not blend into whichever came first |
| D98 | Report date parameters are validated by SHAPE only, so `2026-13-45` — no thirteenth month, no forty-fifth day — is accepted by both the aging and the period reports and silently matches nothing, which reads on screen as "no sales in that range" rather than "that is not a date" | `packages/api/src/reports-routes.ts` | fixed 2026-09-11 — one `isoDateParamSchema` validates a real calendar day across all 20 report definitions and both routers, so `2026-13-45` and the 30th of February are refused with 400 instead of rendering as "no sales in that range". It checks the digits rather than going through `Date`, because `new Date("2026-02-30")` rolls forward to 2 March and would accept exactly the input this exists to refuse |
| D99 | **`POST /journal-entries` is a live, UNGATED posting route.** It is the spike's original poster, still mounted in the app the desktop shell serves, and it has no permission gate, no fiscal-period check, no account validation, no document numbering, no audit event and no GL event — and its line contract carries no cost centre, currency, rate or tax rate. Anyone who can reach the API can post a journal entry into any period, including one that was never opened. The correct route, `POST /gl/journal-entries`, sits beside it fully gated | `packages/api/src/app.ts:1449` and `:1492`, `packages/domain/src/post-journal-entry.ts` | fixed 2026-09-11 — the route is DELETED, not gated further. Its two callers (`dual-mount.test.ts`, `apps/desktop/src/headless-demo.ts`) post through `/gl`, and `legacy-journal-entries.abuse.test.ts` now proves it is unmounted rather than pinning its holes: "there is exactly ONE way into the books" is the property worth guarding, because a second poster added later would pass every other test in this repo |
| D100 | `useUpdateSequence` throws a fixed generic Arabic message and never reads the response body, so the server's actual refusal — a duplicate prefix, say — never reaches the user; sibling hooks parse `body.message` correctly | `apps/web/src/data/platform-hooks.ts` | fixed 2026-09-07 — the hook reads the server's own refusal off the response body instead of throwing a fixed generic message |
| D101 | An issue from a position that was never received costs **zero**: with `allowNegativeStock` on, `unitCostOf` returns zero for a zero quantity, so the first deficit movement is written at 0.00 and COGS is understated by the whole of it, silently. A position that HAS been received costs the deficit at its last average, which is defensible; this one is not | `packages/domain/src/inventory/stock-ledger-service.ts`, `packages/domain/src/inventory/wac.ts` | fixed 2026-09-07 — a deficit issue costs the last known unit price instead of zero, and the shortfall is reported rather than swallowed, so COGS is no longer understated by the whole of the deficit on any tenant running `allowNegativeStock` |
| D102 | `POST /sales-returns` lets the caller state `unitCost` directly, gated by the same permission as the `/from-invoice` path that derives it from the real invoice — so a return can be restocked at any cost the requester names, over-crediting inventory | `packages/api/src/sales-returns-routes.ts` | fixed 2026-09-11 — unit cost comes off the invoice wherever the invoice is resolvable, which is what `/from-invoice` always did, so the two routes can no longer disagree. Stating your own cost is stating your own margin. With no invoices module wired the caller's figures are still trusted: there is no invoice to check against, and refusing there would break that composition rather than protect it |
| D103 | **Warehouse scope is enforced on reads and on nothing else.** The list routes call `warehouseScopeOf`; `POST /draft` and `/confirm` for stock adjustments and transfers never do. A user scoped to one warehouse can post an adjustment into another, and can transfer goods out of a warehouse they may not even list — the goods move, and the screen they would check does not show it | `packages/api/src/stock-documents-routes.ts`, and the same asymmetry in `packages/api/src/inventory-routes.ts` — `POST /adjustments` and `POST /transfers` never call `warehouseScopeOf` while every list route in the same file does | fixed 2026-09-07 — `warehouseScopeOf` is applied on the write side too: stock-document draft/confirm and the adjustment and transfer routes all narrow to the actor's scope, so goods can no longer move out of a warehouse the actor cannot list |
| D104 | `assertVatPeriodOpen` in the tax module is dead code — nothing calls it — while the live control is a separate reimplementation, `assertVatNotFiled` in `gl/post.ts`. Two copies of a legally load-bearing rule, one of them unreachable | `packages/domain/src/tax/vat-filing.ts` vs `packages/domain/src/gl/post.ts` | fixed 2026-09-07 — the dead `assertVatPeriodOpen` is deleted and its tests point at the live `assertVatNotFiled`, so نموذج 41 could not clone the wrong copy |
| D105 | The quotes list never checks `query.isError`: a failed `GET /sales-quotes` renders the same «لا توجد عروض» empty state as a genuinely empty list, with no banner and no retry — every sibling list screen in the app distinguishes the two | `apps/web/src/screens/sales-quotes/index.tsx` | fixed in this pass — the quotes list now shows the Arabic error banner with a working retry, and suppresses the empty state while the load has failed |
| D106 | Row-action controls in the quotes list are not wrapped in a click-stopper, so clicking an inline action also fires the row's own handler and navigates away to the detail view mid-action | `apps/web/src/screens/sales-quotes/index.tsx` | fixed 2026-09-07 — row actions are wrapped in a click-stopper, so an inline action no longer navigates away mid-action |
| D107 | The convert-to-invoice warehouse is captured from `workingLocation` at first mount, before the branches and warehouses queries resolve, so it locks to the empty string permanently: every accepted quote blocks on «اختر المستودع.» even when a real default warehouse exists | `apps/web/src/screens/sales-quotes/QuoteDetailView.tsx` | fixed 2026-09-07 — the convert-to-invoice warehouse is seeded once when the branches and warehouses queries land, and never overwrites a warehouse the user picked |
| D108 | Converting a quote falls back to hardcoded GL account ids (1105 / 2200 / 4100 / 5100 / 1200) for any item with no account mapping of its own, never checked against the tenant's actual chart of accounts — on a tenant whose COA differs, the invoice posts to whatever those codes happen to be | `apps/web/src/screens/sales-quotes/quote-model.ts` | fixed 2026-09-11 — on the SERVER, so it holds wherever the ids came from: the invoice route validates every GL account it is handed against the tenant's own chart and refuses an unknown, inactive or HEADER account. The browser constants remain as a default for an unmapped item; they can no longer reach the ledger unchecked |
| D109 | **The desktop app is built with no session resolver at all.** `main/index.ts` calls `createApp(uow, { lan })` and never passes `resolveAuthContext`, so the default header resolver governs — the one `session-auth.ts` documents as the thing that must never front a socket bound for other machines. Combined with D99, an unauthenticated device on the shop wifi can POST a journal entry into the books across the LAN socket and read it back. Proven end to end over a real socket | `apps/desktop/src/main/index.ts`, `apps/api/src/app.ts:1449` | fixed by PR #54 (S8/S9); `lan-host.test.ts` still guards the socket |
| D110 | `finalize()` on a bank statement is tested as a happy path with three lines still unmatched, in both the domain and the route suite — the test documents D82 without naming it, which is how a real regression gets waved through | `packages/domain/src/bank-reconciliation/reconciliation-service.test.ts`, `packages/api/src/bank-reconciliation-routes.test.ts` | fixed in this pass |
| D111 | **No report is branch-scoped, and none can even be filtered by branch.** `branchScopeOf` is called in the CRM, cheque, cost-centre, fixed-asset, HR, purchase, quote, treasury, voucher, RFQ and warehouse routes — and in neither report router. No report definition carries a `branchId` parameter either. A branch-scoped user sees every branch's sales, purchases, aging and financial statements, and cannot narrow to their own | `packages/api/src/reports-routes.ts`, `packages/api/src/financial-reports-routes.ts` | PARTLY fixed — OPEN HALF IS A DECISION (DEC-20). `reports-routes.ts` takes a branch parameter and enforces the caller's scope. The seven financial statements cannot: a JOURNAL ENTRY CARRIES NO BRANCH AT ALL, so branch-scoping them means adding a branch dimension to the GL across every posting path. `reports/branch-filter.ts` says so in its own doc-comment and deliberately declares nothing for them rather than offering a filter that would silently do nothing |
| D112 | The aging reports declare no `reconciliation` block and no test ties their total to the AR or AP control account — the first report an accountant opens agrees only with itself. `inventory-valuation` is the same: `sales-by-item` and `purchases-by-item` DO declare one, and no test asserts it either, so the tie mechanism is dark on every report that has it | `packages/domain/src/reports/aging-customers.ts`, `aging-suppliers.ts`, `inventory-valuation.ts` | fixed 2026-09-07 — the reconciliation blocks landed earlier and the CONTEXTS are now fed in `reports-routes.ts`, so the sub-ledger-vs-control banner actually renders in the running app rather than being suppressed by an unwired reference |
| D113 | The topbar's bell, theme and user menus portal their dropdown to `document.body` with no focus management at all — no focus on open, none restored on close. `SidePanel` does both correctly, so the pattern exists and these three do not use it. A keyboard user who opens one cannot reliably Tab into it and is left stranded when it closes. Rendered on every screen | `packages/ui/src/shell/ChromeActions.tsx`, `NotificationsPanel.tsx`, `TopbarMenu.tsx` | fixed in this pass — `TopbarMenu` focuses the panel's first item on open and returns focus to its trigger on close (unless a pointer click elsewhere dismissed it); `NotificationsPanel` takes focus, traps Tab through `useFocusTrap`, and restores focus to whatever opened it. `ChromeActions` no longer has a dropdown at all — its portal/popup imports were dead and are now removed |
| D114 | `EntityPicker` filters with a plain lower-cased substring match instead of the app's own `normalizeForSearch`, so «الامل» finds nothing where «الأمل» is stored — while the customer LIST, which does normalise, finds it. The entity is reachable only by someone who reproduces the stored spelling character for character, across roughly 35 picker call sites | `packages/ui/src/primitives/EntityPicker.tsx` | fixed in this pass — the picker filters through `matchesSearch` from `packages/ui/src/lib/search.ts`, a verbatim copy of the domain normaliser (@mezan/ui carries no dependency on @mezan/domain), guarded by `search.test.ts` |
| D115 | **The Ed25519 licence model is not wired to the app that ships.** `resolveDesktopEntitlements` reads `MEZAN_ENTITLEMENTS_JSON` — an unsigned environment variable — straight into `createEntitlements`: no signature check, no expiry, no machine fingerprint, no grace period. `verifyLicense`, which does all four and is thoroughly tested, is called by nothing the desktop binary runs. Anyone with shell access grants themselves any plan | `apps/desktop/src/main/entitlements.ts` vs `packages/domain/src/licensing/**` | fixed. Desktop startup now reads `license.mezan` and drives `verifyLicense` (signature + monotonic-clock rollback guard + machine fingerprint + expiry/grace) via `main/license.ts` + `main/license-runtime.ts`; a packaged build with no authentic licence fails CLOSED to read-only, never open. Both entitlements AND write permission come from the verified licence: past grace it resolves to READ_ONLY, enforced server-side by a global write-gate (`packages/api/src/license-gate.ts`) that refuses every mutating method with 403 `LICENSE_READ_ONLY` while leaving reads/print/export and sign-in/activation open, so data is never withheld. A polled `GET /license/state` drives an Arabic-first banner (`apps/web/src/LicenseBanner.tsx`). Guarded: `license-gate.test.ts`, `license.test.ts` |
| D116 | Roughly a third of the permission catalogue gates nothing. The entire POS module (33 codes) has no route at all; eleven treasury codes, `sales.invoice.void`, `sales.customer.merge`, `crm.lead.assign`, `hr.payroll.run`, `installments.collect` and others gate nothing either. An admin can tick any of them in the role editor and the product does not change — and a confirmed sales invoice cannot be voided through any route, only a draft cancelled | `packages/domain/src/permissions/catalog.ts` vs `packages/api/src/*-routes.ts` | PARTLY fixed — OPEN HALF IS A DECISION, not routes to write. 83 of 286 codes gate nothing, and 37 of those are the whole POS module, which is descoped from v1 and has no domain, routes or persistence. `dashboard.*` and `transactions.*` name screens that do not exist either. These are the catalogue OVERSTATING the product, not surfaces left unguarded — the fix is DEC-14 (hide or delete the cut screens), and inventing 83 routes to match a catalogue would be the wrong way round. What WAS a real hole is closed: `sales.invoice.void` and `installments.collect` now gate real routes |
| D117 | Nothing stops the last company admin being deactivated or demoted. `saveUser` and `setUserStatus` have no last-admin check, so a departing employee holding `admin.users.deactivate` — or one fat-fingered click — can lock the shop out of its own books with no way back through the product | `packages/domain/src/users/save-user.ts` | fixed in this pass — `saveUser` and `setUserStatus` refuse when the target is the last ACTIVE company admin (`LAST_COMPANY_ADMIN`, 409); an inactive admin is not a way back in |
| D118 | `PUT /users/:id` lets a caller holding only `admin.users.edit` set their own `branchScope` and `warehouseScope` to `*`, defeating every read-narrowing the app applies. The same shape as D86, for scope rather than the admin flag | `packages/api/src/users-routes.ts` | fixed in this pass — `ungrantableScopes` refuses any grant of a branch/warehouse scope wider than the caller's own, on create and on edit |
| D119 | **An instalment can never be collected.** The catalogue defines `installments.collect` and `installments.collection.create`; the router mounts a route for neither, and nothing in the codebase ever writes `InstallmentLine.paidAmount` after the schedule is generated. The whole follow-up queue tracks money that the product has no way to receive | `packages/api/src/installments-routes.ts` | fixed 2026-09-07 — `collectInstallment()` settles a named instalment or runs a round sum down the schedule oldest-first; `POST /installments/plans/:id/collect` raises the real customer-collection voucher FIRST and rewrites the plan only after it returns, so a failed posting cannot leave a paid instalment behind money that never arrived. With no treasury port wired it answers 503 rather than moving `paidAmount` on its own — the two-stores-of-one-fact shape D1 already cost this codebase |
| D120 | Cancelling an instalment plan flips the document's status and never its lines — nothing anywhere produces the `cancelled` line status the enum declares — so `/plans/stats` keeps reporting a cancelled plan's full scheduled and remaining amounts as live money | `packages/api/src/installments-routes.ts` | fixed in this pass |
| D121 | The ETA payload that will actually be filed is built and stored on the submission, and no route ever returns it: `serializeSubmission` omits it and there is no `GET /submissions/:id`. Nobody — screen or auditor — can inspect what is about to go to the authority | `packages/api/src/eta-routes.ts` | fixed in this pass |
| D122 | D77's root cause, located: the enqueue bridge reacts only to a `DOCUMENT_CONFIRMED` event whose `docType` is `SALES_INVOICE`, so confirmed sales and purchase RETURNS never reach the queue at all — the queue itself handles credit and debit notes correctly when fed directly | `packages/backend/src/create-backend.ts` | fixed 2026-09-11 — `createReturnEtaEnqueueBridge` fans in alongside the invoice bridge, so a confirmed sales return reaches the queue on its own event instead of matching a `docType` it never had |
| D123 | On a failed list load, four list screens render the error banner AND the ordinary «لا توجد بيانات» empty state underneath it, because the list component sees `query.data` as undefined either way. A user cannot tell "the load failed" from "there is nothing here" — the same shape D105 has on quotes, now confirmed on items, price lists, promotions and the chart of accounts | `ItemsScreen.tsx`, `PriceListsScreen.tsx`, `PromotionsScreen.tsx`, `ChartOfAccountsScreen.tsx` | fixed in this pass — `DocumentList` and `AccountTree` take a `loadFailed` prop and suppress the empty state while it is set; items, price lists, promotions, suppliers, quotes and the chart of accounts all pass `query.isError` |
| D124 | `PriceListsScreen`'s submit awaits `create.mutateAsync` with no try/catch, unlike every sibling screen, so a failed create leaves an unhandled promise rejection in production. React-query still shows the server's message, so it is invisible until something else is listening for rejections | `apps/web/src/screens/PriceListsScreen.tsx` | fixed in this pass — `submit()` catches and returns, leaving the panel open on the draft with `create.isError` reporting the server's message; the test listens on `process.on("unhandledRejection")` and asserts none escapes |
| D125 | The branches screen cannot edit a branch, deactivate one, or set a sub-branch's parent: `useUpdateBranch` is not even imported, and every branch is created with `parentBranchId: null` regardless of the main-branch flag — while the screen displays a "parent" column that nothing can populate | `apps/web/src/settings/BranchesPage.tsx` | fixed in this pass |
| D126 | **Money crosses the wire as an unvalidated string.** Around seventy money fields in `@mezan/contracts` — including `journalLineSchema.debit` and `.credit`, every invoice and quote `unitPrice`, `discountAmount`, cheque and voucher `amount`, and every `openingBalance` — are declared as a bare `z.string()`. Zod passes `"1e3"`, `"NaN"`, `"١٢٣٤"`, `"1,50"` and `""` straight through to `Money.fromMajor`, which throws a `RangeError` no route catches: **`POST /journal-entries` answers 500 for all ten malformed literals tested**, so a bad request is indistinguishable from a broken server and writes a stack trace to the log on every attempt. Nothing is persisted, so the books are not corrupted. The two files that do define a `decimalString` guard (`data-migration.ts`, `field-sales.ts`) check the shape and not the range, so even they accept a seventh decimal place — silently more precision than the 1e-6 scale holds — and a figure of any magnitude at all. The fix is one shared decimal-string schema with a scale and a bound, applied to all of them | `packages/contracts/src/*.ts` (esp. `journal.ts`), `packages/contracts/src/field-sales.ts` | fixed 2026-09-11 — `packages/contracts/src/money-string.ts` states `Money.fromMajor`'s rules once (sign, six decimals, no exponent, no padding, an upper bound) and every money field uses it, including the twelve files that each carried a local `decimalString` checking shape but not range. `POST /gl/journal-entries` answers 400 and names the field. Nothing was ever persisted through the hole, which is why it survived: the books stayed right while the support queue filled with "it says server error" |
| D127 | **The S7 fix crashed every packaged build.** `resolveSeedAdminSecrets` drew the generated admin password with `randomInt(0, Number.MAX_SAFE_INTEGER)`, but Node's `crypto.randomInt` refuses a range wider than 2^48-1, so the call threw `ERR_OUT_OF_RANGE` — on the packaged branch, which is the only branch the whole S7 change exists for. Nothing caught it because the PR's own regression script runs in development, where `packaged` is false and the branch is never entered; a seeded packaged install would have failed at first run. Fixed here by drawing 128 bits with `randomBytes(16)` instead | `packages/backend/src/seed.ts` | fixed in this pass (`auth-security.test.ts`) |
| D128 | **The S11 navigation guard was bypassable in packaged builds, and only in packaged builds.** `isRendererOrigin` compared `url.origin`, but `app:` is not a scheme Node's `URL` recognises, so `new URL("app://mezan/index.html").origin` serialises to the *string* `"null"` — and so does every `file:`, `javascript:` and `data:` URL. They compared equal, `will-navigate` allowed them, and the preload bridge (`window.mezan.fetch`, i.e. the entire Hono app) was exposed to whatever document landed there. `app://<any host>` passed the same way. Development was unaffected because the Vite entry has a real origin, which is why a dev run could never see it. Now compares scheme and host explicitly and refuses any opaque origin | `apps/desktop/src/main/window.ts` | fixed in this pass (`window.test.ts`) |
| D129 | **The S10 SSRF guard missed the IPv4-mapped IPv6 form.** `assertDeliverableDestination` matched only the dotted spelling `::ffff:127.0.0.1`, but WHATWG `new URL()` rewrites that into hex — `::ffff:7f00:1` — so `http://[::ffff:127.0.0.1]/` and `http://[::ffff:192.168.1.1]/` resolved to loopback and to the router and were handed to `fetch`. The same address, a different spelling. Now decodes the hex form back to a dotted quad before deciding | `packages/backend/src/webhook-transport.ts` | fixed in this pass (`webhook-ssrf.test.ts`) |
| D130 | `GET /vouchers/:id` and `GET /vouchers/:id/allocations` ignore branch scope, while `GET /vouchers` narrows correctly. A clerk scoped to branch b1 gets `["v-b1"]` from the list and `[]` from `?branchId=b2`, but reads another branch's voucher in full — `branchId: "b2"`, `amount: "7500.000000"` — by naming its id directly | `packages/api/src/vouchers-routes.ts` | fixed in this pass — both detail handlers apply `branchScopeOf` and answer 404 |
| D131 | `GET /cost-centers/tree` and `GET /cost-centers/:id` are unscoped, while `GET /cost-centers` narrows by `branchScopeOf`. The tree is the shape the screen actually renders, so the narrowing on the list is cosmetic | `packages/api/src/cost-centers-routes.ts` | fixed in this pass — the tree narrows BEFORE it is built, so an in-scope child re-roots instead of vanishing with its parent; `/:id` answers 404 |
| D132 | `POST /notifications/:id/read` and `/read-all` never check `ctx.authenticated`; they use `ctx.userId` as the whole authorization, so an unidentified caller gets 200 as `"anonymous"` instead of the 401 every other gated route returns. No cross-user leak, but the client cannot tell an expired session from an empty inbox — the exact failure the 401/403 split exists to prevent | `packages/api/src/notifications-routes.ts` | fixed in this pass — `createAuthenticatedGate` now fronts all four notification routes |
| D133 | With `smtpSecurity: "NONE"` the SMTP password is sent base64-encoded over a plaintext connection: AUTH LOGIN is attempted whenever `smtpUsername` is set, regardless of transport, and the settings screen offers NONE with no warning. TLS does not silently downgrade and a refused STARTTLS aborts before AUTH, both verified | `packages/api/src/smtp-client.ts` | fixed 2026-09-11 — refused before the socket is opened, not downgraded. A loopback relay is carved out deliberately (a local postfix has no wire between the ends), and a passwordless plain relay still works; it just cannot be handed a password to leak |
| D134 | The notification-rules panel calls `resetForm()` only after a SUCCESSFUL create — not on «إلغاء», and not on the panel's own close control — so cancelling a new rule and reopening the panel puts the person back inside the draft they just abandoned, with «حفظ» live. Neither exit creates the rule, which is the half that matters, but the next thing saved is the one they meant to throw away | `apps/web/src/settings/NotificationRulesPage.tsx` | fixed in this pass — one `closePanel()` behind «إلغاء», the panel's close control and the scrim, and it discards the draft |
| D135 | **A landed cost booked after the stock is sold out is orphaned onto an empty position.** `replay` applies a `LANDED_COST` revaluation to the position regardless of whether any quantity remains, so a freight invoice that arrives after the goods have shipped — the normal case, not an edge one — adds its whole value to a position holding zero units. Measured: receive 100 @ 10.00, issue all 100, then book 250.00 of freight against the receipt; the position reports `onHand 0.000000` and `totalValue 250.000000`. The average reads `0.000000` because `unitCostOf(value, 0)` is zero, so the item card, the stock list and the costing screen all look normal and only the valuation total is wrong. It never washes out either: the next receipt of 10 @ 10.00 gives `totalValue 350.000000` and an average of `35.000000`, a 250% overstatement of cost of sales on goods that never bore the freight. It belongs in COGS or a purchase-price variance account once the stock is gone. Found by the WAC fuzz property, which shrank it to 7 micro-units | `packages/domain/src/inventory/wac.ts` | fixed in this pass |
| D136 | `trimMoneyString` returned `".00"` for an empty value instead of `"0.00"`: `"".split(".")` is `[""]`, not `[undefined]`, so the destructuring default for the integer part never fired. It is exported from the `@mezan/ui` index and `PhysicalCountsScreen` calls it on a variance figure, where an empty value is exactly what a count with no variance sends. Also pinned, and NOT fixed: the helper truncates rather than rounds, so a price of `10.995000` prints `10.99` on the shelf label while the till charges `11.00` — one piastre, argued from the label | `packages/ui/src/print/LabelSheetView.tsx` | fixed in this pass (`LabelSheetView.test.tsx`) |
| D137 | **`Select`'s type-ahead cannot reach the second of two options that share a first word**, which in an Arabic catalogue is the common case rather than a corner one. Two causes, both in `jumpByPrefix`: the search always starts at `active + 1` and wraps, so while the accumulated query still matches more than one option each further keystroke steps to the NEXT match instead of keeping the first — typing «بنك» walks back and forth between «بنك مصر» and «بنك القاهرة» rather than narrowing; and SPACE is handled by the listbox select branch before the type-ahead branch, so the space that would separate the words instead commits whatever is active. Between them, «الخزنة الرئيسية» and «بنك القاهرة» are unreachable from the keyboard in a list where a neighbour shares their first word. The control is on practically every screen | `packages/ui/src/primitives/Select.tsx` | fixed 2026-09-07 — a growing query searches from the active option INCLUSIVE, so it narrows instead of walking across the matches; only a repeated single character cycles. A space now extends a query still in flight rather than committing, so «بنك القاهرة» can be typed past its first word |
| D138 | **The escalation guard constrains what a caller may GRANT, but nothing constrains WHICH users a branch-scoped admin may edit at all.** A caller holding `admin.users.edit` confined to `BR-CAIRO` can `PUT` any user in the tenant — including one scoped to `BR-ALEX` — and narrow that user to `BR-CAIRO`, moving another branch's clerk under their own branch. `refuseIfTargetOutranks` compares permissions only; there is no equivalent for scope. Reproduce with a caller at `branchScope: ["BR-CAIRO"]`, a seeded user at `["BR-ALEX"]`, and a `PUT` setting `branchScope: ["BR-CAIRO"]` — it answers 200. Not fixed: whether a branch admin may reassign staff across branches is a product decision, not a bug | `packages/api/src/users-routes.ts` | PARTLY fixed 2026-09-07 — a caller can no longer edit a user who outranks them at all (`refuseIfTargetOutranks`). STILL OPEN, and a DECISION not a defect: whether a branch-scoped admin may reassign staff ACROSS branches |
| D139 | `trimRecents`'s sort comparator `(a, b) => a.openedAt < b.openedAt ? 1 : -1` never returns 0, so two records opened at the SAME instant violate antisymmetry and the dedupe can keep the stale record instead of the newest. Reachable, because `openedAt` is client-supplied: calling `recordRecentlyOpened` twice with an identical timestamp kept the first. Fixed by returning 0 on a tie so the stable sort preserves prepend order | `packages/domain/src/user-preferences/user-preferences.ts` | fixed in this pass (`user-preferences.test.ts`) |
| D140 | A stored user-preference row that is malformed, or missing a field added in a later release, threw out of `load()` instead of degrading — a 500 on the self-service screen for anyone whose row predates the current shape. Now sanitised: a missing or invalid section is backfilled to its default, and the store read is wrapped so a JSON-parse failure cannot take the screen down | `packages/backend/src/preferences-routes.ts`, `packages/domain/src/user-preferences/user-preferences.ts` | fixed in this pass (`preferences-routes.test.ts`) |
| D141 | D124's shape at three more sites: `NotificationRulesPage.submit` and both `EtaScreen.save` handlers awaited `mutateAsync` with no try/catch inside an async function nothing awaits, so a rejected save escaped as an unhandled promise rejection — and on EtaScreen `setSaved(true)` then ran on a save that never happened, so the screen claimed «حُفظت الإعدادات.» for a config the server had refused. Fixed; the tests assert BOTH halves (no rejection, and no false success) using a real `process.on("unhandledRejection")` listener rather than trusting the reporter | `apps/web/src/settings/NotificationRulesPage.tsx`, `apps/web/src/screens/EtaScreen.tsx` | fixed in this pass (`EtaScreen.test.tsx`) |
| D142 | **A customer's opening balance never reaches the AR control account.** `openingBalance` is stored on the customer record and added to that customer's outstanding figure, but nothing posts it to GL 1105. Measured in `scripts/scenarios/accounting.ts`: creating a customer with an opening balance of 4,250.00 left 1105 exactly where it was. Every migration begins by typing in the shop's existing debtors, so the AR sub-ledger exceeds its control account from day one by the sum of the opening balances, and nothing in the product ever closes the gap | `packages/api/src/customers-routes.ts`, `packages/domain/src/customers/customer.ts` | fixed 2026-09-07 — a customer's opening balance posts through the same path every other document uses: it debits AR control 1105 and credits the opening-balance equity account, so the sub-ledger and its control account agree from the first day of a migration |
| D143 | A refused BOM deactivation was completely silent: `deactivate()` caught the error and did nothing, behind a comment claiming the re-render would communicate it — it did not. The BOM stayed active and the person had no way to know the server had refused. Now renders a `role="alert"` banner carrying the server's own reason | `apps/web/src/screens/BomsScreen.tsx` | fixed in this pass (`BomsScreen.test.tsx`) |
| D144 | **The sales-returns create page spun the CPU forever on an invoice with nothing returnable.** The line-seeding effect ended in `setLines(firstLine ? [...] : [])`, and its own guard was `lines.length > 0` — a guard an empty array can never satisfy. A fresh `[]` is never `Object.is`-equal to the current state, so React re-rendered; `invoices` was rebuilt by `.filter()` on every render, so the effect's deps changed too and it re-ran, wrote `[]` again, and never settled. Choosing a service-only invoice in «فاتورة المصدر» — or arriving at `#/…/sales-returns/new/<id>` for one — froze the screen with no error. Found by a coverage test that hung a vitest worker at 100% CPU rather than failing (a 5s testTimeout cannot interrupt a synchronous render loop). Fixed by bailing out when there is no returnable line, and memoising `invoices` | `apps/web/src/screens/SalesReturnsScreen.tsx` | fixed in this pass (`SalesReturnsScreen.coverage.test.tsx`) |

D1–D65 are closed; the register is `archive/defect-register.md`.

D65 — 20 scenario assertions failing because `2c0e7fa` made a user's Arabic name mandatory
and no scenario that creates a user passed `nameAr` — was closed by `d3294fc`, which taught
the harness to sign in with the seed PIN and the current user contract. The fix was in the
harness, not the product: the product is right to demand the name. The one reading filed as
a possible second defect behind it — an HR leave balance of 21 against 11 — was the same
bug, and holds once the caller exists.

Measured on this tree, 2026-08-30 after the security sweep: `pnpm scenarios` **6289 passed,
0 failed**, across all fifteen suites. Every other gate green with it — typecheck, lint,
RTL logical-CSS, colour tokens, native controls, permission labels, theme colour-only, and
`pnpm smoke` over all 199 read surfaces. `pnpm audit` is down from 41 advisories (1
critical, 10 high) to 1, which has no published fix.

**Security sweep, 2026-08-30 — thirteen findings, all fixed (S1–S13 in
`archive/defect-register.md`).** Four were critical and every one of them ended at
tenant-admin (`"*"`): an anonymous `POST /bootstrap/admin` handed out a live admin session
on a fully provisioned tenant; `admin.users.create`, `admin.roles.manage` and
`admin.users.edit` each reached `"*"` from a delegated permission. All four were proved
against a running seeded backend before and after, not read off the source. The rest:
no login lockout on a six-digit PIN, one published admin PIN shipped in every install,
`/lan/*` answering the shop wifi with no credential, the desktop shell building its app
with `createApp` so it ran the header resolver on a LAN socket, webhook SSRF, no CSP or
navigation guard in the Electron shell, `dev.db` committed, and 41 dependency advisories.
`scripts/scenarios/security.ts` guards all of it.

---

Everything filed is closed — D1 through D65. The closed register — every defect with
the commit that fixed it, plus the readings that looked like defects and were not — is
`archive/defect-register.md`. It is kept, not deleted, because a fixed defect is how its
regression is recognised.

A closed register is not the same as a clean product: it means the ones found and written
down are closed. The next one gets found the way these were — by driving a seeded app and
comparing two numbers that must agree.

### Filed 2026-09-11 by the defect sweep

| # | Defect | Evidence | State |
|---|---|---|---|
| D145 | **«مرتجع من فاتورة» restocked every return at the SELLING price.** The `findConfirmedInvoice` adapter set the return line's `unitCost` to `unitCostOf(extendQtyByPrice(l.qty, l.unitPrice), l.baseQty)` — the same expression as the `unitPrice` line directly above it — and `/from-invoice`, the route the screen uses, reads cost from that port. So inventory rose by what the goods SOLD for on every return raised through the UI: on the covering test's figures 1050 where the goods cost 850, inventory overstated by the whole margin and the COGS reversal wrong by it, silently, on the most ordinary operation in the product. Found while closing D102, which is why it had never shown up: the `POST /` path took the caller's cost, so only the UI path was wrong | `packages/backend/src/create-backend.ts` `findConfirmedInvoice` | fixed 2026-09-11 — uses the line's captured moving-average cost, converted per base unit the same way the price is. Guarded by `create-backend.test.ts` «مرتجع من فاتورة» restocks at cost |

---

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

These stay listed so nobody re-files them as new findings. None is a defect with a
right answer; they are in §6's territory.

**Entries struck through are closed. They are not deleted** — same rule the defect register
runs on: a closed item is how you recognise its regression, and every one of the three closed
on 2026-08-30 left residual risk behind it that a consultant still has to be able to say out
loud. Read what a closed entry says it did **not** fix before promising a client anything.

- **~~The SQLite file and the backups it produces are not encrypted at rest.~~ CLOSED
  2026-08-30 — kept here because the residuals below are real and a consultant must know
  them.** `apps/desktop/src/main/encrypted-database.ts` opens `mezan.db` with
  `better-sqlite3-multiple-ciphers` under a 32-byte random key sealed to the OS user account
  by Electron's `safeStorage` (Keychain / DPAPI / libsecret-kwallet); every backup archive is
  encrypted with the same key; an existing plaintext install converts on first launch and
  takes a full verified backup before a byte of the plaintext file is touched; a machine with
  no keyring **refuses to start** rather than quietly running in plaintext, with
  `--allow-unencrypted-database` as the operator's explicit, logged override. What did NOT
  close:
  - **It is encryption at rest. It is not a sandbox, and it is not access control.** Four
    things it does nothing about, and every one of them is a likelier scenario in a small shop
    than a stolen disk:
    - **Anything while the app is running.** The key is in process memory and the database is
      open. Malware or a person at the running machine reads the books through the app.
    - **A compromised OS user account.** `safeStorage` unseals for that account by definition
      — that is the entire mechanism. Whoever is that user is the key.
    - **An already-unlocked machine the attacker is logged into.** The shop laptop left open
      at the counter is the threat model this does not cover.
    - **Anyone holding the key card.** It is a bearer secret in plain text.
  - **The key is machine- and account-bound, so the backups are too.** That is the property
    that makes a stolen disk useless, and it is the same property that loses the books if the
    machine dies and nobody wrote the key down. Restoring an encrypted archive on hardware
    that does not hold the key fails with `BackupKeyMismatchError` and is unrecoverable by
    anyone. The mitigation is a piece of paper: a `database-key.txt` key card written beside
    the database on first encryption, warned about on every launch while it is still there,
    which a consultant must move off the machine and delete (`INSTALL.md` §4.1).
    **If the owner never keeps that card, their backups are worthless on new hardware** —
    which is precisely the disaster the backup system exists for.
  - **The pre-conversion safety copy is unencrypted** and sits in the backups folder until a
    human deletes it. The startup log names its path; nothing removes it automatically,
    because deleting the only copy of a shop's books to tidy up is the worse failure.
  - No key rotation, and no second factor on the key card.
- **~~The LAN multi-till socket is plain HTTP.~~ CLOSED 2026-08-30 — kept here because what it
  does NOT protect is a live risk a consultant has to state out loud.** The socket now serves
  **HTTPS only**: `tls` is a required option on `startLanHost` and there is no plain-HTTP
  branch to fall back to — on any TLS failure the socket stays closed and logs that it did.
  The identity (`apps/desktop/src/main/lan-tls.ts`) is a self-signed certificate minted once
  and kept for the life of the install, so it can be pinned, and it deliberately refuses to
  re-mint over a damaged key pair because a new fingerprint is indistinguishable from an
  impostor to a till that pinned the old one. The connected-devices screen shows the `https://`
  URL and the SHA-256 fingerprint. Residual, and all of it still open:
  - **Pinning is trust-on-first-use.** An attacker already impersonating the host at the
    moment a till is paired gets pinned instead — silently, permanently, no later warning.
    The only defence is a human comparing the two fingerprint strings character by character
    while standing in the shop (`docs/INSTALL.md` §6.3). **A procedure, not a mechanism** —
    which means it is only as good as the consultant's discipline, and it is worth saying
    plainly rather than filing under "we have TLS now".
  - **Nothing authenticates the client.** TLS here is one-way; there are no client
    certificates. The subnet check and the path allow-list remain the only things narrowing
    who and what can reach the socket.
  - **A stolen session token is still the whole ERP.** Untouched: `session-auth.ts` binds a
    session to no device, no address and no seat, and it lives 12 hours. TLS stops the token
    being read off the air and does nothing about one taken off a till.
  - **The private key is protected by filesystem permissions only** (`lan-tls-key.pem`,
    `0600`, beside the database).
  - **No revocation and no rotation path.** If the key leaks, recovery is deleting both PEM
    files and re-pairing every till by hand.
- **~~Electron auto-updates are not code-signed or notarized.~~ CONFIGURED 2026-08-30, and
  still UNSIGNED IN FACT — the gap is now a purchase order, not a code change.** What landed:
  `apps/desktop/electron-builder.yml` carries a real macOS (Developer ID, hardened runtime with
  a minimal entitlements grant, notarization via the Apple API-key form) and Windows
  (Authenticode, SHA-256 only, RFC-3161 timestamp) configuration that activates entirely from
  environment variables and holds no credential of its own, with `forceCodeSigning: true` so a
  mac/win package that could not be signed **fails** rather than shipping;
  `.github/workflows/release.yml` refuses to start without the certificates and refuses to
  publish an artifact that `apps/desktop/scripts/check-signed.mjs` cannot get the OS to vouch
  for (`codesign` + a rejection of ad-hoc signatures + `spctl --assess` for the notarization
  ticket + `stapler validate`; `signtool verify /pa /tw` or `Get-AuthenticodeSignature`; and a
  refusal to ship an app still pointed at the placeholder feed); and
  `apps/desktop/src/main/updater.ts` refuses to run at all on a build whose own signature it
  cannot confirm. What remains **open, and cannot be closed here**:
  - **Nobody has bought the certificates.** An Apple Developer ID, an Apple notarization key
    and a Windows OV/EV certificate are business purchases with real lead times
    (`docs/INSTALL.md` §8.1). Until they exist **no signed installer has ever been produced**,
    every build is unsigned, and a consultant must not tell a client the installer is provably
    ours (`INSTALL.md` §7).
  - **The signing path has therefore never run end-to-end.** `check-signed.mjs` has been
    exercised against deliberately unsigned and ad-hoc-signed bundles and correctly refuses
    them — that is the half provable without a purchase. The half that needs a certificate is
    unproven by definition.
  - **Windows and Linux have no runtime signature check.** `updater.ts` answers `unknown` on
    both and refuses, which is the safe answer, not a complete one: Electron exposes no
    code-signature API, so macOS is answered by shelling out to `codesign` and the other two
    are honestly unanswered. A real Windows check is possible via PowerShell and is deferred
    until a signed Windows release exists to test it against.
  - **The distribution channel is still unchosen.** `MEZAN_UPDATE_FEED_URL` is a repository
    variable with no value; whether it points at GitHub release assets, S3 or a self-hosted
    directory is a business decision nobody has made.
- **The audit trail is append-only by a SQLite trigger (`BEFORE UPDATE/DELETE` on
  `audit_events`), not append-only against the person who holds the file.** That trigger
  stops the APPLICATION from ever issuing an `UPDATE`/`DELETE` against its own audit rows —
  which is what closed the admin-CRUD and workflow-CRUD audit gaps (S21, S25) — but anyone
  with filesystem access to `mezan.db` (the company admin, in practice, since it is one
  file with no OS-level access control of its own) can still open it directly and edit past
  the trigger, or restore an OLDER backup that never had a damaging entry in the first
  place. A sink the application itself cannot write to — signed export on a schedule,
  syslog to an external collector, a hash-chained rows-since-last-export digest — is still
  open; the trigger only ever promised to stop the app's own code from cutting a corner.
- **License verification is wired (was a stub — D115, now fixed).** Desktop startup now reads `license.mezan` and runs the
  Ed25519 verifier (`packages/domain/src/licensing/license.ts`) end to end — signature,
  clock-rollback guard, machine fingerprint, expiry and grace — through
  `main/license.ts` + `main/license-runtime.ts`. The verified licence is the single source
  of both entitlements and write permission; past grace the app is READ_ONLY, enforced by
  the server-side write-gate (`packages/api/src/license-gate.ts`), and a packaged build with
  no authentic licence fails closed to read-only. `MEZAN_ENTITLEMENTS_JSON` survives only as
  a documented DEV convenience (ignored by packaged builds). The vendor public key and
  fingerprint salt are baked by the release build; the full activation portal / air-gapped
  code UX remains Phase 8.
- **The auto-update channel is signed and user-consented (was CONFIG-ONLY).** The electron-updater flow (`main/updater.ts`) checks on
  launch only when the operator opts in (`MEZAN_AUTO_UPDATE=1`, and outside shop hours),
  never auto-downloads, and verifies a detached Ed25519 signature over the release's
  SHA-512 (`main/update-verify.ts`) against `MEZAN_UPDATE_PUBLIC_KEY` BEFORE downloading —
  refusing any release that does not verify. Progress and the refusal surface in an
  Arabic-first banner (`apps/web/src/UpdateBanner.tsx`). This is the offline-first trust
  layer and is independent of OS code-signing/notarization, which is still a vendor-cert
  release step (`electron-builder.yml`). Guarded: `update-verify.test.ts`.
- **A fresh, never-configured install can still be claimed by whoever reaches it first.**
  `POST /bootstrap/admin` has to be open before there is anyone to authenticate as; it now
  closes the moment the tenant has an account of its own (S1, hardened by S17 so that fact
  is recorded rather than inferred). On desktop the window is smaller than it was: an
  unlicensed install opens no LAN socket at all, and even a LICENSED one's socket does not
  forward `/bootstrap/*` — the path allow-list in `lan-host.ts` names exactly `/auth/login`,
  `/auth/logout`, `/tenant`, `/health` and `/lan/*`, so first-run claiming is reachable over
  the network only from the host's own IPC mount, never from the shop wifi. It is still
  reachable there on `apps/server`, which is a development mount with no allow-list.

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

## 5.4 Egyptian statutory compliance — landed 2026-09-07

None of this was a defect row: it was absent, and its absence is what decided whether
three of the five named buyer segments could legally transact at all.

### B2C e-receipt — الإيصال الإلكتروني

A separate ETA mandate from e-invoicing, in force since 15 September 2025, and this build
had nothing for it: retail, restaurants and pharmacies could not legally ring a consumer
sale. `EtaDocumentType` now carries `receipt`, the queue reports AFTER the sale inside the
**72-hour** window rather than clearing before it, the printed receipt carries a QR
(`packages/ui/src/print/qr.ts`, `QrCode.tsx`), and a reprint is **idempotent** — it
reproduces the same UUID and QR rather than minting a second submission.

The offline-first architecture is an advantage here rather than a liability, and it is
worth saying so in a demo: a shop with no internet keeps selling and the queue drains
later, which is exactly what the regime's post-clearance window is for.

### The e-seal — honest rather than wired

`signingMethod: "eseal"` used to park a submission on `pending_signature` and nothing ever
signed it. There is no HSM to call in this build, so the state is now VISIBLE — the
submission row, the ETA screen and the printed document all say «في انتظار الختم
الإلكتروني» — and the signing agent is an injectable port with a test double, so wiring a
real e-seal later is configuration rather than surgery. **A consultant must not tell a
client documents are sealed.** The second submit no longer transmits an unsigned document
either; the test that asserted it did was pinning the hole, not the behaviour.

### نموذج 41 — the quarterly withholding return

The mechanics were already right (GL 2210, the voucher's withholding fields, the
withholding report). What was missing was the filing object, and it now clones the shape
`tax/vat-filing.ts` already uses: a quarterly period, a filing record, the remitted
figure, the authority reference, and a refusal to backdate a voucher into a filed quarter.
Statutory, filed within one month of quarter end; anyone paying local B2B suppliers failed
an audit without it.

**Still open on the tax side:** D78 (the ETA payload hardcodes `currencySold: "EGP"` on
every line regardless of the document's currency) and D79 (the sub-type resolver matches
on the tax-rate VALUE alone, so exempt V003 and zero-rated export V001 — both 0% — can be
filed as each other). Both are `packages/domain/src/eta/payload.ts`.

---

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

#### DEC-19 — Should a stock transfer have an in-transit leg? (was D90)

A transfer posts both legs on one confirm, so goods can never be recorded as in
transit or short on arrival. Filed as a defect; it is not one, for two reasons.

The reference app behaves the same way and the catalog documents it as
deliberate — «لا يمكن إلغاء تحويل مؤكد … لعكس الحركة أنشئ تحويلاً جديداً
بالاتجاه المعاكس». And a receiving-side confirm introduces shortfalls, which
means a transfer can create a LOSS: today it is valuation-neutral by
construction (`StockLedgerService.postTransfer` receives at the source's own
moving average) and declares no `buildGlPosting` at all.

| Option | Effect |
|---|---|
| Leave it one-step | Matches the reference and the catalog. A van or a lorry in motion is invisible, and a short arrival is reconciled by a second adjustment that names no cause. **Smallest blast radius — it is today's behaviour.** |
| Add a transit location and a receiving confirm | Real goods-in-transit. Needs a transit warehouse per route, an `in_transit` document state, a per-line received quantity, and — the part that is not a UI change — an accounting answer for the shortfall: which account absorbs goods that left and never arrived, and who may approve it. |

**A shortfall is the whole decision.** Everything else is mechanism.

#### DEC-20 — Does the GL get a branch dimension? (the open half of D111)

`reports-routes.ts` now takes a branch parameter and enforces the caller's scope.
The seven financial statements cannot follow: **a journal entry carries no branch
anywhere in the model.** `reports/branch-filter.ts` says so in its own
doc-comment and deliberately declares no branch parameter for them, rather than
offering a filter that would silently do nothing.

| Option | Effect |
|---|---|
| Leave the statements tenant-wide | Honest today. A four-branch retailer cannot produce a per-branch income statement at all, which is the first thing such an owner asks for. |
| Add `branchId` to the journal line, beside `costCenterId` | The statements become branch-filterable. Touches every posting path — sales, purchases, treasury, inventory, payroll, manufacturing — and every document has to decide which branch its lines belong to. The dimension already exists on the line for cost centres (D97), so the shape is known. |
| Derive the branch from the source document | No schema change, but a manual journal entry has no source document, and every report would carry a join that silently drops those entries. |

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
| DEC-2 | **The workflow gate is fed the actor's real ROLE code**, not the resolved permission set. `sales-invoices-routes.ts` and `vouchers-routes.ts` now resolve the role through `uow.users` → `uow.roles` before calling the gate, the way the approvals endpoints always did. Chosen over letting the gate match either, which would have broadened the meaning of every existing gate configuration — this option keeps `GateStep.role` meaning what its type and its tests already say. | 2026-09-07 |
| — | **The unabsorbed share of a landed cost posts to COGS 5100**, not to a new landed-cost variance leaf. Debiting the whole amount to inventory 1200 left GL 1200 above the valuation report by exactly the unabsorbed figure whenever a landed cost arrived after the goods were sold. COGS needs no chart-of-accounts template change and no migration; a dedicated variance leaf would need both and does not exist in the seed template. Reversible if an accountant wants the variance broken out. | 2026-09-07 |
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


**Seven of the eight are done; one is a judgement call nobody has made.** Measured against
the code on 2026-09-14, not against this list — three entries below were already closed
when the list still called them open, which is why each one now names its evidence.

| § | Item | State |
|---|---|---|
| 8.1 | A better Arabic typeface | **Done.** The face is Zain (`packages/ui/src/tokens/fonts.css`), a real Arabic family across the weight range, not the old `font-ar` fallback |
| 8.2 | A real icon per sidebar item | **Done.** `nav-icons.tsx` maps 164 entries; the single-letter fallback is gone |
| 8.3 | Organising the sidebar | **Open — a judgement call, not code.** 115 entries in 17 groups. Worth revisiting now that icons have landed, but it needs someone to decide what belongs together; there is no defect to fix |
| 8.4 | Search in the sidebar | **Done 2026-09-14.** Answered as "no separate rail filter" — `⌘K` is the one search surface. What WAS broken is fixed: the bar matched nav labels with a raw `includes`, so «قائمة الدخل» (a tab inside «التقارير المالية», with no nav label of its own) returned nothing, and an unforgiving match missed on a hamza the user did not type. Commands carry keywords, and the filter runs through `matchesSearch` |
| 8.5 | A customisable main dashboard | **Done 2026-09-14.** The four lower panels are addressable widgets; the screen renders the user's stored layout |
| 8.6 | Somewhere to store per-user preferences | **Done.** `packages/domain/src/user-preferences` + `/preferences`, and it already modelled a dashboard layout before anything read it |
| 8.7 | Widget visibility follows permissions | **Done 2026-09-14.** Checked when the layout is RESOLVED, not when it was saved, so a layout stored before a permission was revoked degrades quietly rather than rendering a card the user may not read |
| 8.8 | Mirror the directional icons under RTL | **Done 2026-09-14.** A RULE in the nav registry's one render path, not a sweep, so a new screen cannot reintroduce an unmirrored arrow. The directional set is deliberately short and a test pins its size: an icon that carries an OBJECT — a clock, a coin, a building — must not flip, and mirroring those is the usual overcorrection |

