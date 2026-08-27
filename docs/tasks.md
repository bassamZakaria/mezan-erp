# Mezan — the work list

**The single task document.** Merged 2026-08-27 from the four task lists that preceded it —
the parity task list, the phase backlog, the enhancement backlog and the shell follow-ups —
all of which are now gone. The plan they serve is `plan.md`; what is broken is `defects.md`; what is
waiting on a human is `decisions.md`.

`[ ]` open · `[~]` in progress · `[x]` done and verified live

Tick an item only when it has been driven in the running app on seeded data, in **both
locales** (ar/RTL and en/LTR) and **both themes**. A green test is not a tick.

## Where the work stands, 2026-08-27

| Track | State |
|---|---|
| **§1 Parity (P0–P6)** | Effectively complete. Two clusters remain open — settings policy toggles, and row menus on 17 read-only surfaces |
| **§2 Open now** | The only work with nothing in front of it |
| **§3 Deferred by decision** | POS, statutory payroll, HR, cloud — not scheduled, not defects |
| **§4 Beyond parity (E1–E3)** | 27 candidates, none started; `enhancements` branch only |
| **§5 Shell follow-ups** | 8 items, queued behind the i18n sweep |
| **§6 Phase backlog (0–15)** | The original catalog-derived phasing, kept as the traceability record |

Verification at the time of merge: `pnpm scenarios` — 3740 assertions, 0 failed, all four
invariants at exactly zero (trial balance, inventory vs GL 1200, AP vs GL 2100, AR vs GL 1105).
`defects.md` carries no open defect; D1–D58 are all in its Fixed table.

---

# 1. Parity work — P0 to P6

The ordered work list. Every item traces to a requirement id in
`audit/REQUIREMENTS.md` (R…) or a gap id in `gap-inventory.md` (A…/H…), or to a
defect in `docs/defects.md`. Scenarios that verify them are in
`docs/scenarios/10-reference-parity.md`.

Tick an item only when it has been driven in the running app on seeded data, in
**both locales** (ar/RTL and en/LTR) and **both themes**.


---

## P0 — correctness (blocks everything else)

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

## P1 — shell and navigation

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

## P2 — reports engine

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

## P3 — document surfaces

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

## P4 — entity 360

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

## P5 — missing features

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

## P6 — list-surface parity

One task per row of the per-screen tables in `gap-inventory.md` §B–D2. Start with
the money-bearing ones: purchase-invoice payment dimension (**R4.1**), items stock
sales-returns filter bar,
journal date filter and source-module column (**R6.3**), tax groups (**R6.4**),
exchange-rate filters (**R6.5**), branch price-list column, CRM KPIs and board view,
HR dashboard charts (**R10.1**), asset status chips.

---

# 2. Open now

**Re-verified 2026-08-27.** This section previously listed nine open items. Seven of them
were finished work whose boxes were never ticked, one described a field that no longer
exists, and one was half wrong. What is genuinely open is below.

## 2.1 Row menus on the remaining 17 list screens — R1.3

- [ ] The 17 remaining `DocumentList` screens are read-only report surfaces (audit log, stock
      balance, cost-centre P&L, reconciliation, FX revaluation, leave balances and accruals,
      attendance) or flat master data whose only per-row action is an inline edit (departments,
      job titles, holidays, asset categories, leave policies, payroll components, pipeline
      stages, item specifications, product templates). None carries a lifecycle, so a
      state-dependent menu there would hold a single entry. **Settle against the running
      reference before adding one** — this is a question, not a backlog item.

## 2.2 Outbound notification channels

- [ ] `packages/domain/src/notifications/engine.ts` delivers **in-app only**: every other
      channel is stamped `"queued"` and nothing drains the queue. The channel type is
      `"in_app" | "email" | "push"` — there is no WhatsApp channel, modelled or otherwise, so
      earlier notes claiming one are wrong. An SMTP transport now exists
      (`packages/api/src/smtp-client.ts`, used by the settings test-send), so wiring email is
      no longer a missing-transport problem — it is a delivery/retry decision: what happens to
      a queued mail when the shop is offline, which is the normal case for this product.

## 2.3 Settled since this list was written

| Was listed open | Actually |
|---|---|
| R11.1–R11.8, the seven settings-policy toggles | Done and verified at three levels — see §1 P5 |
| workflow `minAmount` configurable but never enforced (DEC-1) | The field does not exist anywhere in the repo. The decision is moot; DEC-1 is closed in `decisions.md` |
| WhatsApp channel modelled but unimplemented | Never modelled. Only the email/push halves of §2.2 are real |

# 3. Deferred by decision

## 3.1 Out of scope for v1

POS (9 screens + 2 reports), `/settings/shifts`, a standalone label-templates
screen, statutory payroll computation. Payroll must stay visibly flagged rather
than silently computing a wrong net.

## 3.2 Do not copy

X1–X8 in `reference-parity/audit/REQUIREMENTS.md` and C1–C13 in
`reference-parity/gap-inventory.md`. In particular: keep report export, keep the hubs
linked, keep the daily attendance list, do not reproduce the 0.00 treasury balance bug,
and label a purchase return correctly.

## 3.3 The deferred build plan

The build plan for the deferred areas — HR/Payroll (27 tasks), POS (26 tasks) and the
Cloud/SaaS edition (20 tasks) — is `plan.md` §9. It is not repeated here.

---

# 4. Beyond parity — enhancement backlog

> **These are ENHANCEMENTS beyond 1:1 parity with the reference app.** They live **only on the `enhancements` branch**, which **tracks `main`** (parity). Nothing here is merged into `main` — `main` remains parity-only.
>
> This is a **phased backlog of candidate issues**, ready to turn into tracker tickets later. Each candidate cites its requirement (`ENH-###`, `requirements.md`) and enabling workflow (`WF-##`, `workflows.md`). Sizes: S ≤1wk · M 1–3wk · L 3–6wk · XL >6wk. Estimates are relative to an already-built parity module and are planning inputs, not commitments.

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
| Multi-currency as a licensable module + IAS-21 FX depth | Packaging + accounting-depth decision, per `plan.md`. |
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

All candidates trace to a requirement in `requirements.md` and a workflow in `workflows.md`. Beyond-parity; `enhancements` branch only; tracks `main`.

---

# 5. Shell follow-ups

Queued behind the i18n sweep, in the order requested.

## 1. A better Arabic typeface

The Arabic face is currently whatever `font-ar` resolves to in
`packages/ui/src/tokens.css`. Pick a face that carries the design's weight range
and reads well at 12–13px, the size most of the app's body copy runs at, and
check it against the Latin face already in use so mixed runs (an Arabic label
next to `INV-000001`) sit on the same baseline.

## 2. A real icon per sidebar item

Every nav row currently renders a single letter in place of an icon — "S" for
Sales invoices, "P" for Price lists, and so on. Two rows starting with the same
letter are indistinguishable at a glance, which is the whole job an icon does.
115 nav entries need icons, or a rule that produces one per entry.

## 3. Organising the sidebar

115 entries in 17 groups. Worth revisiting grouping and order once icons land,
since the two decisions interact.

## 4. Search in the sidebar

The topbar command bar (`⌘K`) already searches nav entries, so this is about
whether the rail ALSO needs a filter. Note the command bar currently matches nav
items only — searching it for a report title ("قائمة الدخل") returns nothing,
which is worth fixing whichever way this goes.

## 5. A customisable main dashboard

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

## 6. Somewhere to store per-user preferences

There is no per-user preference store anywhere in the repo — confirmed by
search across `packages/domain/src`, `packages/persistence/src` and
`packages/contracts/src`. Task 5 needs one, and it is not the only thing that
will: saved list filters, default branch, and the range the dashboard opens on
all want the same shelf.

Build it once as a small keyed store scoped to `(userId, key)` holding a JSON
value, behind the existing repository-port pattern so the Postgres dialect
comes free later. Do this before task 5, not inside it.

## 7. Widget visibility follows permissions

Whatever a user can put on their dashboard has to respect the permission
matrix — a user without `reports.aging.read` must not be able to add the aging
matrix, and a layout stored before a permission was revoked must degrade
quietly rather than render an error card. Worth building into the widget
registry from the start; retrofitting a permission check onto a stored layout
is where this kind of feature usually leaks data.

## 8. Mirror the directional icons under RTL

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

# 6. Phase backlog — the catalog-derived phasing

Kept as the traceability record: every catalog domain maps to a phase here, and the parity
work in §1 supersedes it wherever the two disagree about the scope of a screen.

> Source of truth: `docs/catalog/01-*.md` through `10-verification.md` (125 real screens, cross-checked complete by the verification pass) and `docs/plan.md` (architecture, Phases 0–3 draft). This document extends that plan to cover **every** catalog feature, phases it, and turns it into candidate GitHub issues. Nothing here is committed or created on GitHub yet — review first.

> **Build-status note (2026-08-23, `main` @ `7b65887`):** this document is the *plan*, not a status
> record — it is kept as-written so the original phasing stays auditable. For what actually exists,
> read `docs/STATUS.md` (current state) and `docs/plan.md` §"Build status". Two deltas worth flagging
> against the sequencing below: **Phase 10 (Platform & config) was moved up in priority here but is
> the least-built phase in reality** — the engines (workflow gate, numbering, audit) exist, none of
> the admin UIs do, and there is no notification *rules* engine at all, only an event bus. And the
> **8 domain hub pages** named in the pattern note below were never built.

---

## 1. Scope model

**v1 ships as a single-tenant Electron desktop app on SQLite.** Architecture "Path A": persistence sits behind Drizzle + repository ports, and a Hono app layer sits behind the domain core, so a Postgres dialect and an HTTP server are **additive, not a rewrite**, when the cloud edition is built later. No feature described below is invented — everything traces to a catalog file; deferred items are deferred by product decision (§scope rules), not because they're unspecified.

**Deferred to later phases, not cut:**
- **HR & Payroll** (Phase 13) — full Egyptian-labour-law compliance is a project of its own; nothing in the core ERP loop depends on it existing first (Employee Advances/Leave Accrual post journal entries but that's additive once GL exists).
- **POS** (Phase 14) — the highest-design-risk module (net-new selling screen, no reference UI at all) and the one most naturally deferred behind a working back-office ERP.
- **Cloud/SaaS website edition** (Phase 15) — multi-tenant Postgres, cloud auth, realtime fan-out, S3, billing. The desktop architecture is built to make this additive.

**Everything else — Sales, Purchases, Inventory, Accounting, Treasury, Installments, Manufacturing, Projects, Fixed Assets, Field/Van Sales, CRM, Reports, Settings/Platform — ships in v1**, phased by dependency order.

**Priority re-sequencing (per stakeholder review):** within v1, **Sales, Purchases, Inventory, Accounting, Treasury and Installments (الخزينة/الأقساط) are the highest priority.** Phases 0–9 below are ordered to land every one of those domains — including full Accounting depth (cost centers, period close, FX, reconciliation, ETA) and Reports — before Manufacturing and CRM/Projects/Fixed Assets/Field Sales, which were not named as priorities and now sit last among v1 phases (11–12). Platform & config (10) moves up ahead of them too, since print templates, numbering, and approvals are needed to fully operate the priority modules day-to-day.

**UI approach (per stakeholder review): custom Mezan UI, functionality-first.** Mezan builds its **own visual design, component library and UI elements** — it does not replicate the source app's shadcn tokens, layout, or visual style. This supersedes the "mirror the captured app's idioms" framing in `plan.md` §2.1/§5.1 for the purposes of this backlog. What does **not** change: the catalog is still the **functional specification**. Every field, workflow/state machine, action, tab, and data point documented for a screen must be covered by Mezan's equivalent screen — visual implementation is entirely at the build team's discretion, functional completeness is not. Concretely: every issue's "Scope" column below is a functional-coverage checklist (fields/states/actions), not a layout spec; "effects of this document" explainers, KPI strips, filter panels etc. are named as **functional patterns** to reproduce (what information is shown, when), not prescribed pixels. See §8 for the full reasoning and what changed there as a result of this instruction.

### A repeated pattern worth naming once: domain hubs
The source app has **8 fully-built domain landing/dashboard pages** (`/sales/hub`, `/purchases/hub`, `/inventory/hub`, `/accounting/hub`, `/treasury/hub`, `/assets/hub`, `/crm/hub`, `/pos/hub`) that are **not linked from its own sidebar** — found only by the verification pass reverse-engineering the JS bundle. Mezan should link these deliberately; each ships as a small (S) issue alongside its domain's first phase rather than being invented as a surprise later.

---

## 2. Legend

| Size | Meaning |
|---|---|
| **S** | < 1 day — CRUD screen, config toggle, single report, small fix |
| **M** | 2–4 days — a screen with real workflow/state machine, or a medium engine slice |
| **L** | ~1–2 weeks — a screen family or a substantial engine component |
| **XL** | 2+ weeks — a phase-defining engine; usually the "worth its own sub-breakdown later" flag |

**Labels used in the issue tables:**
- **[parallel]** — independent of other issues in its phase once the phase's own foundation lands; can be picked up by a second engineer/stream immediately.
- **[spec-risk]** — the catalog's evidence for this screen is thin, inferred, or the demo tenant had 0 records; needs either a richer reference tenant or a product decision before/while building (see §10.1 of `plan.md` and the coverage notes below).
- **[cross-phase]** — depends on an entity or engine owned by a *different* phase than the one it's listed under.
- **[decision]** — an explicit open product decision blocks clean scoping; flagged inline and rolled up in §5.

---

## 3. Phase table

| # | Phase | Goal | v1 / Deferred | Issues |
|---|---|---|---|---|
| 0 | Foundations (desktop) | Monorepo, SQLite-behind-ports persistence, Money/Qty, auth, permissions engine, entitlements/licensing skeleton, numbering engine, audit trail, workflow engine core, notification bus core, RTL app shell + UI-audit spike, Electron shell + backup/restore | v1 | 15 |
| 1 | Master data & key pages | Items, categories/brands/seasons, customers, suppliers, tax rates, chart of accounts, cost centers (master), treasury accounts (master), fiscal periods (master) | v1 | 15 |
| 2 | Ledger & costing engine | Double-entry posting, journal entries, WAC + immutable cost layers, stock movement ledger, golden-ledger fixtures | v1 | 8 |
| 3 | Core Sales & Purchases documents *(priority)* | Sales Invoices; Purchase Orders → Goods Receipts → Purchase Invoices (happy-path chain, no gates yet) | v1 | 12 |
| 4 | Inventory operations *(priority)* | Stock balance, transfers, adjustments (8 reasons + opening balance), physical counts, valuation + drift + aging write-down, labels, product templates, configurable-product definitions | v1 | 19 |
| 5 | Full Sales *(priority)* | Quotes, sales returns, price lists (incl. per-item override grid), promotions/coupons engine, credit control | v1 | 14 |
| 6 | Full Purchases *(priority)* | RFQs, purchase returns, landed costs, the 3 procurement strictness gates, historical import | v1 | 12 |
| 7 | Treasury completion + Installments *(priority)* | Unified 10-type voucher, invoice allocation, cheque register (7-state), bank reconciliation, installment plans + overdue batch + follow-ups | v1 | 14 |
| 8 | Accounting depth *(priority)* | Cost-center P&L, fiscal period close, tax groups/account-linking, exchange rates + FX revaluation, balance reconciliation, ETA e-invoicing, opening-balances decision | v1 | 12 |
| 9 | Reports & printing *(priority)* | ReportDefinition abstraction, print rendering engine, amount-in-words, export pipeline, report issues covering all 33 reports (2 already shipped in Phase 4, 1 in Phase 5, 1 folded into Phase 8) | v1 | 22 |
| 10 | Platform & config | Workflow/approvals builder + inbox, notification-rules builder, numbering-sequences admin, print-template designer, barcode-rule config, WAC drift settings, data-migration wizard, audit-log UI, roles/permissions UI, users, dashboard home, global UX, branch 360 | v1 | 18 |
| 11 | Manufacturing | BOMs (versioned, waste%), work orders (4-stage execution), configurable-product order instances, production dashboard | v1 | 10 |
| 12 | CRM + Projects + Fixed Assets + Field/Van Sales | Leads/opportunities/pipeline/activities, projects, asset register + categories + depreciation runs, van trips | v1 | 18 |
| 13 | **[DEFERRED]** HR & Payroll | All 13 screens: employees, departments, job titles, attendance, holidays, contracts, leave requests, leave policies, leave accrual batches, payroll runs, advances, my-leave, shift settings | Deferred | 13 |
| 14 | **[DEFERRED]** POS | Terminals, sessions/shifts, sales/refunds ledgers, discount approvals, restaurant mode (tables/kitchen/reservations/deliveries), loyalty, + the net-new selling screen | Deferred | 16 |
| 15 | **[DEFERRED]** Cloud/SaaS website edition | Postgres dialect + dual-engine conformance, cloud JWT + RLS, Node server app, SSE+Redis realtime, S3 storage, subscription→entitlements, tenant onboarding, API keys/webhooks/WhatsApp | Deferred | 15 |

**Total candidate issues: 233** — 189 in v1 (Phases 0–12) + 44 deferred (Phase 13 = 13, Phase 14 = 16, Phase 15 = 15). *(+3 vs. the previous pass: a Phase 0 UI-audit spike, a Phase 4 aging-based write-down job, and a Phase 10 WAC-drift-settings panel — all surfaced by the §7/§8 deep-dive research below.)*

---

## 4. Phases in detail

### Phase 0 — Foundations (desktop) · XL · v1

*(Already drafted in `plan.md` §4; summarized here for completeness.)* Nothing else is buildable until this exists. Scope trimmed from the original dual-target draft: **SQLite only**, via Drizzle behind repository ports, with a `SqlDialect` capability shim left in place so a Postgres implementation is a later addition (Phase 15), not a rewrite. No dual-engine conformance suite yet — that's a Phase 15 issue, once Postgres exists to conform against.

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Monorepo + package boundaries + lint enforcement | S | — | pnpm/Turborepo, `eslint-plugin-boundaries`, RTL lint rules |
| Persistence architecture: schema-spec DSL → SQLite (Drizzle) + repository/UnitOfWork ports | L | — | Author-once spec → sqlite schema + migrations; `SqlDialect` shim scoped for future pg swap-in |
| `Money`/`Qty` value objects + scaled-int (10⁻⁶) codecs + rounding policy | M | — | `decimal.js`-backed, largest-remainder allocation, overflow guard tests |
| Auth: desktop local user store + `AuthContext` | M | — | Local session sealed via Electron `safeStorage`, PIN fast-switch |
| Permissions engine: ~268-permission catalog, dependency graph, sensitive flag, view/view_own/view_all, branch+warehouse scoping | L | — | Data-driven manifest; role editor UI is Phase 10 |
| Entitlements port + license verification skeleton (Ed25519, fingerprint, grace) | M | — | Per `plan.md` §2.5; read-only-after-grace, never data-destructive |
| Numbering engine: 25 sequence types, atomic counters (`BEGIN IMMEDIATE`) | M | — | Prefix/suffix/pad-length/annual-reset; admin UI is Phase 10 |
| Audit trail core (append-only, security + sensitive-op streams, severity taxonomy) | M | — | UI screen is Phase 10 |
| Workflow engine core (pluggable confirmation gate, 26 action types, ordered sequential role steps) | L | — | Chain builder UI + `/approvals` inbox are Phase 10 |
| Notification bus + rules engine core (39-event domain taxonomy, transactional outbox) | L | — | Rule builder UI is Phase 10; in-app delivery only for v1 (email/push are online-only, deferred with Phase 15) |
| Own design-system foundation + functional-coverage ruling pass | M | — | Mezan's own visual design/component library — no source-UI replication. Write one explicit ruling (fix/avoid, not "copy") per known source *behavioral* defect (i18n fallback-handling gap, CRM Hub label mismatch, GRN nav/header mismatch, reservation-dialog time bug, WO-list row-click bug, stored `direction:"LTR"` bug) so these functional bugs aren't accidentally reintroduced — see backlog §8. Feeds the App-shell issue below |
| App shell: RTL layout system, i18n scaffolding (ar+en), typography | L | — | `<DocumentList>`/`<DocumentDetail>`/filter-panel/KPI-strip shared primitives (Mezan's own visual implementation) — the *information* each surfaces, not source styling — pay for themselves ~40× |
| Settings foundation: tenant settings object, branches, warehouses (5 types incl. van), general/company/tax tabs | M | — | Full settings depth (credit-control/purchase-control/treasury-policy tabs) is Phase 10 |
| Electron shell: window, IPC bridge, `app.fetch()` mount, auto-update, backup/restore | L | — | First-class feature per `plan.md` §3.7 — automatic + manual backup, guided restore, integrity checks |
| Hono app layer + command/query routing | M | — | Thin transport layer so a future HTTP server (Phase 15) is additive |

### Phase 1 — Master data & key pages · L · v1

*(Already drafted.)* Note: product templates and configurable-product **definitions** moved to Phase 4 (they're inventory-operations-adjacent, not pure master data); price lists moved to Phase 5 (they're a Full-Sales feature).

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Items master: identity/classification, types, multi-barcode, image | L | Phase 0 | Product/Service/Raw/Finished/Consumable/Recipe types, conditional fields |
| Item categories, brands, seasons | S | — | Inline-CRUD from Items screen (confirmed: no standalone routes in source) |
| Item pricing/costing fields + per-item GL account mapping | M | Phase 2 (accounts) | Revenue/COGS/inventory account override with type-level defaults |
| Item inventory policy: costing method (WAC/FIFO — **[decision]** is FIFO in scope for v1?), batch/expiry (FEFO) flags, reorder point/qty | M | — | `[spec-risk]`: no FIFO-costed item ever observed in source |
| Item alternate UOM + conversion factors | S | — | Shared mechanism with Product Templates (Phase 4) |
| Item ETA classification fields (EGS/GPC codes) | S | Phase 8 (ETA) | Fields only here; submission logic is Phase 8 |
| Customers master + detail/360 view | L | Phase 0 | Credit terms/limit, category, ETA buyer type, tax exemption, 7 detail tabs |
| Customer categories + merge/deactivate actions | S | [parallel] | |
| Suppliers master + detail/360 view | L | Phase 0 | [parallel] with Customers |
| Supplier categories | S | [parallel] | |
| Tax rates + ETA V001–V009 subtypes + posting accounts (2200/1400) | M | Phase 2 | |
| Chart of Accounts: tree, CRUD, hierarchy, natural balance, main-vs-postable | M | Phase 0 | Account-detail statement panel bundled; "Account Linking" tab deferred to Phase 8 `[spec-risk]` |
| Cost centers (master CRUD, hierarchical, optional branch link) | M | — | Full P&L integration is Phase 8 |
| Treasury accounts (master CRUD, GL mapping, opening-balance mechanism) | M | Phase 0 | Full voucher/statement depth is Phase 7 |
| Fiscal periods (generate-year, list, 3-state field) | S | — | Close/lock **workflow** is Phase 8 |

### Phase 2 — Ledger & costing engine · XL · v1

*(Already drafted — the heart of the system.)*

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Double-entry posting engine: balance enforcement, append-only, period gate | L | Phase 0, 1 | `Σdebit=Σcredit` in domain + DB constraint |
| Journal Entries: list + create (line table, min 2 lines, live balance diff, draft/post) | L | ↑ | |
| Journal Entries: detail panel (balance badge, account↔JE drill-down) | M | ↑ | draft→pending→posted→reversed state machine `[spec-risk: reversed/pending states never exercised in source]` |
| WAC costing engine: cost-layer creation on receipt, weighted-average recompute on issue | L | Phase 1 | |
| Cost-layer immutability + per-item Cost tab (layers keep receipt-time cost, explainer copy) | M | ↑ | Kept verbatim per `plan.md` — deliberate design, not a bug |
| Stock movement ledger (append-only, source-doc-linked) | M | ↑ | Every stock-affecting document in Phases 3–4 writes here |
| Golden-ledger fixture test suite | M | ↑ | Invoice→stock+COGS+AR+VAT scenario asserted to the minor unit; the regression safety net for the whole engine |
| Multi-currency capture on documents (currency + rate-at-document-time) | S | Phase 1 | Full FX revaluation engine is Phase 8 |

### Phase 3 — Core Sales & Purchases documents · XL · v1

*(Already drafted — narrowed from the original plan: quotes/returns/promotions/credit-control move to Phase 5; RFQ/landed-costs/purchase-returns/gates move to Phase 6.)*

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Sales Invoices: create/edit form, line items, variant picker, ad-hoc product | L | Phase 1, 2 | |
| Sales Invoices: status lifecycle (draft→confirmed→partial→paid→overdue/cancelled) + stock deduction + AR posting | L | ↑ | |
| Sales Invoices: "effects of this document" explainer panel | S | ↑ | Shared design-system component — reused by Purchase Invoices, Vouchers, Sales Returns |
| Sales Invoices: detail view + tabs (items, collections link, accounting entries, attachments, audit) | M | ↑ | |
| Sales Hub (domain landing page) | S | [parallel] | |
| Purchase Orders: create/edit + confirm/send workflow | M | Phase 1, 2 | |
| Goods Receipts: create-from-PO, line auto-fill, confirm | M | ↑ | `[spec-risk]`: PO→GRN auto-fill never observed (0 POs in source tenant) |
| Purchase Invoices: create manual + from-receipt auto-fill, mixed inventory/expense lines | L | ↑ | `[spec-risk]`: invoice-from-receipt auto-fill unobserved |
| Purchase Invoices: status lifecycle + stock receipt + AP posting | L | ↑ | |
| Purchase Invoices: effects explainer + detail tabs | M | ↑ | |
| Purchases Hub (domain landing page) | S | [parallel] | |
| Procurement happy-path integration test (PO→GRN→Invoice, no gates yet) | S | ↑ | Gates themselves are Phase 6 |

### Phase 4 — Inventory operations · XL · v1

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Stock Balance (cross-warehouse rollup, reorder visibility) | S | Phase 2 | |
| Stock Transfers: draft→confirmed one-way workflow, incl. van-warehouse endpoint | M | ↑ | Valuation-neutral by design |
| Stock Transfers: Excel import for transfer lines | S | ↑ [parallel] | |
| Stock Adjustments: 8 reasons incl. `INITIAL_STOCK` opening balance | L | ↑ | The opening-balance mechanism the whole go-live import depends on |
| Stock Adjustments: GL journal posting + cost-layer injection | M | ↑ | |
| Physical Counts: session workflow (start→count-entry grid→variance→generate adjustment) | L | ↑ | `[spec-risk]`: entire count-entry grid and generate-adjustment step unobserved (0 counts in source) |
| Inventory Valuation report + GL-vs-computed reconciliation card | M | Phase 2 | Ships here (not Phase 9) — directly consumes the costing engine it validates |
| Inventory valuation drift detection/rebuild tool | M | ↑ | Preserves the `/reports/inventory/drift` pattern from `plan.md` §2.3 |
| Aging-based inventory write-down: monthly batch, provisions slow-moving stock, posts JE to 5060 (provision)/1190 (expense) | M | Phase 2 | Distinct mechanism from WAC drift — named in `plan.md` §3.5's jobs list but not previously turned into its own issue |
| Label Printing: 3 fixed sizes (40×30/50×25/100×50) + barcode-fit validation, item-mode | M | — | |
| Label Printing: document-mode | S | ↑ | `[spec-risk]`: scope unclear beyond its existence |
| Barcode rendering infra (bwip-js integration) | S | [parallel] | Shared by Labels here and embedded-barcode scanning later |
| Product Templates: attribute CRUD + variant-combination generator | L | Phase 1 | |
| Product Templates: alternate-UOM propagation to generated variants | S | ↑ | |
| Configurable Products: config input variables (formula identifiers, min/max, type) | M | Phase 1 | |
| Sandboxed expression evaluator (no `eval`) | L | — | Built once here for material/waste/pricing formulas; reused by BOM waste% and custom-order execution in Phase 11 |
| Configurable Products: material-quantity formulas + waste % | M | ↑↑ | |
| Configurable Products: pricing formula + labour/overhead cost formulas | M | ↑↑ | |
| Inventory Hub (domain landing page) + Warehouse detail hub (quick-action deep links) | M | [parallel] | |

### Phase 5 — Full Sales · L · v1

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Quotations: CRUD + status lifecycle (draft→sent→accepted→converted, +rejected/expired) | M | Phase 3 | |
| Quotations: send-to-customer action | S | ↑ [parallel] | |
| Quotations: convert-to-invoice flow | S | ↑, Phase 3 invoices | `[spec-risk]`: explicit "convert" affordance on the quote itself not found in source |
| Sales Returns: create against confirmed invoice, qty-remaining logic, reason enum | L | Phase 3 | |
| Sales Returns: confirm/cancel workflow + refund-voucher linkage | M | ↑ `[cross-phase: Phase 7 vouchers]` | `[spec-risk]`: confirm/cancel never exercised in source |
| Price Lists: CRUD (name/code/base-list) | S | Phase 1 | |
| Price Lists: per-item price-override grid | M | ↑ | `[spec-risk]`: never observed (0 populated lists in source) — the actual pricing mechanism, needs a design pass |
| Promotions: percentage/fixed/special-price discount types | M | Phase 3 | |
| Promotions: buy-X-get-Y (BXGY) | M | ↑ [parallel] | |
| Promotions: bundle pricing | M | ↑ [parallel] | |
| Promotions: coupon code + day/hour restriction | S | ↑ | |
| Credit control: warn-vs-block policy on invoice/quote creation | M | Phase 1 (customers) | `[spec-risk]`: toggle-vs-payload discrepancy noted in source, re-verify intent |
| Sales invoice profit/margin computation (post-return net) | M | Phase 3, this phase's returns | |
| Delivery notes — **[decision]** | — | — | Genuinely absent from source (stock deducts on invoice confirm). Not scoped as an issue; flagged for a product decision — see §5 |

### Phase 6 — Full Purchases · L · v1

| Issue | Size | Deps | Scope |
|---|---|---|---|
| RFQs: CRUD + draft→sent→closed/cancelled workflow | M | Phase 3 | |
| RFQs: supplier invitation + quote entry/comparison | M | ↑ | `[spec-risk]`: entirely unobserved (0 RFQs in source) |
| RFQ→PO conversion | S | ↑, Phase 3 POs | |
| Purchase Returns: create against confirmed invoice, qty-available guard, reason enum | M | Phase 3 | |
| Purchase Returns: confirm/cancel + refund linkage | M | ↑ `[cross-phase: Phase 7 vouchers]` | |
| Landed Costs: document CRUD + distribution by value / by quantity | L | Phase 3 | |
| Landed Costs: linked-invoices multi-select + embedded tab on invoice detail | M | ↑ | `[spec-risk]`: picker chain behavior unobserved |
| Procurement gate: require-PO-for-GRN | S | Phase 3 | Confirmed enforced pattern in source; tenant payload confirms `requirePoForGrn: false` by default — match as Mezan's default |
| Procurement gate: require-GRN-for-invoice | S | ↑ | `[spec-risk]`: not evidenced as enforced in source — manual invoice path exists regardless; `requireGrnForInvoice: false` by default in the source tenant — match as Mezan's default |
| Procurement gate: sold-item cancellation guard | S | ↑, `/sold-tracking` API | |
| Historical purchase invoice/return Excel import | M | Phase 1, 3 | Go-live migration: archive fully-paid docs without a JE, record remaining balance as payable, never touch stock |
| Supplier statement i18n fix + categories-dialog polish | S | [parallel] | Do not inherit the source's `customers.openingBalance` key-leak bug |

### Phase 7 — Treasury completion + Installments · L · v1

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Unified voucher: type picker + collection/payment types, create+confirm atomic flow | L | Phase 1, 2 | |
| Unified voucher: refund types (customer refund, supplier refund) | M | ↑ `[cross-phase: Phase 5/6 returns]` | |
| Unified voucher: other income/expense, partner capital injection/withdrawal, tax authority payment | M | ↑ [parallel] | |
| Unified voucher: inter-treasury transfer type | M | ↑ [parallel] | |
| Invoice allocation / cash application (reversible per-line, "needs allocation" state) | L | ↑, Phase 3 invoices | |
| Account statements (running balance + opening balances) | M | ↑ | |
| Cheque Register: 7-state lifecycle (incoming/outgoing), accounts 1320/1360 | L | ↑ | `[spec-risk]`: entire lifecycle inferred from filter chips, 0 cheques in source |
| Bank statement CSV import + persisted per-account column mapping | M | ↑ | `[spec-risk]`: entirely unexercised (0 bank accounts in source) |
| Bank reconciliation: line matching | M | ↑ | |
| Cash-vs-bank negative-balance policy (cash hard-blocked, bank overdraft allowed) | S | ↑ | Account-type-aware rule — preserve explicitly |
| Treasury Hub (domain landing page) | S | [parallel] | |
| Installment Plans: invoice-driven creation, 4 frequencies, down payment, schedule preview | L | Phase 3 invoices | |
| Installment overdue batch + late penalties — **[decision]** | M | ↑ | Late-fee configuration is not exposed anywhere in the source product; needs a product decision on calculation rule before full scoping |
| Collection Follow-ups (customer-scoped log, 5 types) | M | ↑ [parallel] | |

### Phase 8 — Accounting depth · L · v1

*(Moved up — user priority pass: Accounting/Treasury named as top priority alongside Sales/Purchases/Inventory.)*

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Cost-center full integration + Cost Center P&L report | M | Phase 1, 2, 9 | Explicit "unassigned" catch-all row; WIP-capitalized labor/overhead hits this report only at sale time — preserve that timing |
| Fiscal period close workflow (مفتوحة→مغلقة→مقفلة, stale-open warning, posting lock) | M | Phase 1, 2 | |
| Tax groups screen + Chart-of-Accounts "Account Linking" tab | S | Phase 1 | `[spec-risk]`: both never opened in source, scope from field-name inference only |
| Exchange rates: CRUD + approval/lock workflow | M | Phase 1 | `[spec-risk]`: approval states never exercised (0 rates in source) |
| FX Revaluation: period-end run, auto-reversing JE, multi-currency select | L | ↑, Phase 2 | `[spec-risk]`: never run in source, output entirely inferred from the form. Tenant payload names `fxRateMissingPolicy`/`fxResidualTolerance`/`revaluationReversalMode` fields with no settings-tab UI found in source — scope these into this issue's config surface |
| Balance Reconciliation: sub-ledger vs control-account cards (inventory/treasury/AR/AP) + unlinked-entries tab | M | Phase 2, 4, 7 | Never seen with a real mismatch in source — treat as an always-clean baseline to protect |
| Accounting Hub (domain landing page) | S | [parallel] | |
| ETA e-invoicing: readiness tracker + config (activity code, address, buyer-ID threshold) | M | Phase 1 | |
| ETA e-invoicing: connection/credentials (AES-encrypted secrets, signing method test/prod) | M | ↑ | |
| ETA e-invoicing: item/unit/branch code mapping | M | ↑ | `[spec-risk]`: only readiness counters seen in source, not mapping-table detail |
| ETA e-invoicing: submission queue + lifecycle + JSON export | L | ↑, Phase 3 | **Online-only.** Production doc v1.0 requires e-seal signing (noted "coming phase" even in the source system) — desktop builds/queues locally, transmits when connected. Compliance-deadline exposure is a named risk, not silently absorbed |
| Opening balances for non-treasury GL accounts (AR/AP/equity) — **[decision]** | M | Phase 1, 2 | No clean mechanism exists anywhere in the source; ship a manual-JE-based path and flag the product decision (dedicated screen vs. JE vs. migration-tool-only) |

### Phase 9 — Reports & printing · XL · v1

Cross-cutting infra (6 issues) plus 16 report-shaped issues grouping all 33 reports (Inventory Valuation + Drift shipped in Phase 4; Promotions Report shipped in Phase 5; Cost Center P&L ships in Phase 8 — noted, not duplicated).

| Issue | Size | Deps | Scope |
|---|---|---|---|
| `ReportDefinition` abstraction (params schema → query plan → column/format spec) | L | Phase 2 | The core investment — makes the remaining 24 report-shaped issues configuration, not 24 bespoke screens |
| Report export pipeline (XLSX via `exceljs` + CSV) — export everywhere | M | ↑ | Source only exposes export on 5/33 reports; Mezan exports on all |
| GL-reconciliation banner component | S | ↑ | Shared by Sales-by-Item, Purchases-by-Item, Inventory Valuation/Aging/Slow-Moving |
| On-demand execution pattern (General Ledger, Account Ledger) | S | ↑ | Explicit "عرض التقرير" click, not auto-run — preserves source UX for the two expensive reports |
| Print rendering engine: React+CSS print components, A4/A5 pipeline | L | Phase 0 | `webContents.printToPDF`/`print()`; thermal/ESC-POS path deferred to Phase 14 with POS |
| Arabic amount-in-words engine | M | — | Masculine/feminine agreement, currency + subunit naming — small but fiddly, budget explicitly |
| Sales reports pack A: by-Period, by-Item [GL-recon], by-Customer, Top Products | M | ↑ | [parallel] |
| Sales reports pack B: by-Salesperson (**shell only — data wiring is Phase 14**), Van Sales | S | Phase 12 (van trips) | |
| Purchases reports pack: by-Period, by-Supplier, by-Item [GL-recon] | M | ↑ [parallel] | |
| Inventory reports pack A: Stock Levels, Stock Movement, Stock Ledger | M | Phase 4 [parallel] | |
| Inventory reports pack B: Aging [GL-recon], Expiring Soon (FEFO), Slow-Moving [GL-recon] | M | ↑ [parallel] | |
| Debt aging pack: Customer Aging, Supplier Aging | M | Phase 1, 3 [parallel] | |
| POS reports pack (**shells only — data wiring is Phase 14**): Daily Sales Summary, Shift Reports | S | — | |
| Installments reports pack: Overview, Overdue | S | Phase 7 [parallel] | |
| Make vs Buy report | S | Phase 11 | |
| Trial Balance | M | Phase 2 [parallel] | |
| Income Statement | M | ↑ [parallel] | Multi-step structure (gross profit, operating income subtotals) + YoY compare toggle |
| Balance Sheet | M | ↑ [parallel] | Assets = Liabilities + Equity check row |
| Cash Flow (indirect method) | M | ↑ [parallel] | Working-capital adjustment lines, opening+change=closing reconciliation |
| VAT Return | M | Phase 1 (taxes) [parallel] | Output vs input by rate, net-payable formula row |
| General Ledger report tab | M | Phase 2 | On-demand; per-account debit/credit/balance summary incl. zero-activity accounts |
| Account Ledger report tab | M | ↑ | On-demand, required-account gate, opening/closing + JE-line table |

### Phase 10 — Platform & config · L · v1

*(Moved up ahead of Manufacturing/CRM — serves the prioritized modules directly: print templates for invoices/vouchers, numbering admin, approvals on JEs/vouchers, roles/permissions for day-to-day operation.)*

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Workflow/Approvals: chain builder UI (26 action types, ordered steps, role assignment) | M | Phase 0 (engine) | Engine is unconditional — no thresholds/conditions, by design |
| Workflow/Approvals: `/approvals` inbox + pending/rejected badge | M | ↑ | `[spec-risk]`: 0 chains configured in source — reject/modification-requested runtime behavior is inferred |
| Notification Rules: rule builder UI (event→condition→recipient→priority→channels) | M | Phase 0 (bus) | |
| Notification Rules: Arabic message templating | M | ↑ | Email/push template editor deferred with Phase 15 (online-only channels) |
| Numbering Sequences: admin screen (25 types, prefix/suffix/pad-length/annual-reset, reset counter) | M | Phase 0 (engine) | `[decision]`: source is tenant-global; multi-branch customers usually expect branch-prefixed numbering — flagged, not resolved |
| Print Templates: 9-tab designer (identity/header/content/line-items/totals+amount-in-words/footer+signature/watermark/POS-thermal-stub/per-doc overrides) | L | Phase 9 (rendering engine) | |
| Barcode Codes: embedded/weight barcode rule config (prefix+digits+decimals+EAN-13 check) + live test panel | M | Phase 4 (barcode infra) | Consumer is mostly POS (deferred), but item-lookup-by-scan elsewhere in v1 benefits |
| Data Migration wizard: framework + step sequencer + template download/import/validation UI | L | Phase 0 | Dry-run + validation report + all-or-nothing commit |
| Data Migration: entity-import steps (treasury opening balances, suppliers, customers, items, units, historical sales/purchase invoices+returns) | L | Phase 1, 2, 3, 5, 6 | Employee/asset import steps stubbed until Phase 12/13 land |
| Audit log UI: `/audit/reports` screen, linked into nav (source leaves it command-palette-only) | M | Phase 0 (audit trail) | |
| Roles & Permissions UI: role CRUD + full matrix editor | L | Phase 0 (permissions engine) | |
| Users screen: CRUD, role assignment, branch/warehouse scoping | M | ↑ | Employee-link field stubbed until Phase 13 |
| Dashboard home: KPI tiles, trend chart, aging widget, expense breakdown, top items/customers | L | Phase 2, 3 | Company-wide, not branch-filtered — matches source's own (possibly deliberate) behavior |
| Global UX: command palette (~80 pages + quick actions), top-bar search, notifications panel | M | Phase 0 | Index the 8 domain hubs under their distinct palette names (source lists them as "لوحة المبيعات", "لوحة الخزينة", "نظرة عامة على المحاسبة", etc. — confirms they're a deliberate, dual-discoverable surface, not redundant) |
| Settings depth: credit-control, inventory-policy, purchase-control, treasury-policy tabs | M | Phase 5, 6, 7 | Remaining settings beyond Phase 0's general/company/tax basics. Inventory Policy tab includes `allowBackorder`, `allowNegativeStock`, `allowCrossWarehouseSales`, `showOtherWarehouseStock` — confirmed real, documented fields |
| WAC drift settings panel (`wacDriftTolerance`, `wacDriftAlertThreshold`, `wacAutoRebuildOnDrift`) | S | Phase 4 (drift report) | Source has these fields platform-managed-only with no tenant-editable UI anywhere — Mezan exposes them deliberately rather than replicating that gap |
| Profile screen (self-service: info/security/activity tabs) | S | [parallel] | |
| Branch 360 detail view (KPIs + tabs that progressively light up as later phases land) | M | Phase 7, 12, 14 | |

### Phase 11 — Manufacturing · L · v1

*(Moved down — not named in the user's priority list.)*

| Issue | Size | Deps | Scope |
|---|---|---|---|
| BOMs: versioned recipe CRUD + waste% gross-up logic | L | Phase 1, 4 (evaluator) | |
| BOMs: cost breakdown (materials+labour+overhead) + version history/audit | M | ↑ | |
| Work Orders: creation wizard (BOM picker, qty/priority, warehouses, scheduling) | M | ↑ | |
| Work Orders: 4-stage execution engine (بدء العمل→صرف المواد→استلام المنتج→إكمال) + material issue/return/waste | XL | ↑ | Largest single issue in the phase — likely needs its own sub-breakdown during sprint planning |
| Work Orders: WIP cost accumulation + GL posting chain (finished-goods receipt, overhead, labor) | L | ↑, Phase 2 | Confirmed real behavior: work-order completion auto-posts a 5-entry JE chain in source |
| Work Orders: detail tabs (materials/costs/usage/stock-movement/receipts/journal-entries/log) | M | ↑ | |
| Config Instances (custom manufacturing orders): spec entry, live cost preview, close order, auto-generate linked WO | L | Phase 4 (configurable products + evaluator) | |
| Production Dashboard (exception cockpit) | M | ↑ | Surfaces WOs needing action now |
| Bug note: WO list row-click opens the *item*, not the WO, in source | S | ↑ | Explicitly do not replicate — fix-forward |
| Manufacturing domain integration test (BOM→WO→finished-goods→GL, full round-trip) | M | ↑ | |

### Phase 12 — CRM + Projects + Fixed Assets + Field/Van Sales · L · v1

*(Moved down — not named in the user's priority list.)*

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Leads: CRUD + 6-state lifecycle | M | Phase 1 (customers) | `[spec-risk]`: 0 leads in source, no detail view or conversion mechanism observed |
| Opportunities: CRUD + stage-driven open/won/lost | M | ↑, Pipeline Stages | `[spec-risk]`: same — 0 opportunities |
| Sales Pipeline: kanban view + drag-drop between stages | M | ↑ | `[spec-risk]`: drag-drop confirmation not observed |
| Pipeline Stages config: reorder, probability%, win/loss flags | S | — | Source of truth for both Opportunities and Pipeline |
| Lead→Opportunity conversion mechanism — **[decision]** | S | ↑ | Never observed in source; needs explicit design |
| CRM Activities / My Tasks | S | [parallel] | Residual capture gap in source — create-form never opened, build from list/empty-state + inference |
| CRM Hub (domain landing page) | S | [parallel] | |
| Projects: CRUD + status machine (مخطط→نشط→مكتمل, +معلق/ملغي) + auto-create `PRJ-{code}` cost center | M | Phase 8 (cost centers) | |
| Progress billing (مستخلصات) — **[decision]** | S | — | Zero evidence in source despite an advance-voucher type existing (`plan.md`); investigate/spike before scoping further |
| Asset Register: CRUD, scope toggle (general/branch/warehouse), acquisition fields | L | Phase 1 | |
| Asset Categories: CRUD + depreciation defaults + GL mapping (1500/5400/1590/4500/5450) | M | ↑ | Encode source's placeholder defaults as seed data |
| Depreciation Runs: draft→posted workflow, daily proration (IFRS) calc | L | ↑ | `[spec-risk]`: run-creation trigger entirely unreachable in source (gated on ≥1 asset, no button rendered even in empty state) |
| Asset disposal flow | M | ↑ | |
| Assets Hub (domain landing page) | S | [parallel] | |
| Van Trip: open-trip form (crew, van warehouse, opening cash float, per-payment-method treasury routing) | M | Phase 7 (treasury) | |
| Van Trip: van stock load via transfer | S | Phase 4 (transfers) | |
| Van Trip: in-field sales/collections | M | Phase 3/5 (sales), Phase 7 | |
| Van Trip: settlement (cash reconciliation expected-vs-counted-vs-variance, stock reconciliation table) | L | ↑ | |

### Phase 13 — [DEFERRED] HR & Payroll · XL

All 13 screens, ordered by dependency. Deep Egyptian labour-law compliance (Article 47 seniority, overtime multiplier, day-divisor basis, Law 12/2003 + 14/2025 presets modeled as versioned dated data, never hardcoded).

| Issue | Size | Deps | Scope |
|---|---|---|---|
| HR Dashboard | S | — | KPI tiles, 3 charts, leave-consumption table, 3 alert chips |
| Departments + Job Titles | S | — | Thin CRUD, no detail page (confirmed by-design in source) |
| Employees: full detail page (8 tabs) + create form | L | ↑ | Clock-in biometric/selfie switches, overtime-inheritance chain, Article 47 field |
| Shift Settings | S | — | Feeds Attendance |
| Attendance: calendar-grid, day status codes, monthly summary | L | ↑ | Only non-list-pattern screen in the HR catalog |
| Official Holidays | S | [parallel] | Year-tabbed, recurring vs one-time |
| Leave Policies: matrix + two dated legal presets | M | — | `[spec-risk]`: matrix schema inferred from column headers, 0 rows in source |
| Contracts: type/pay-basis/currency, leave-entitlement overrides, allowance/deduction lines | L | Employees, Leave Policies | |
| Leave Requests: workflow, half-day, leave-type resolution | L | Contracts, Leave Policies | `[spec-risk]`: the task's "9 granular per-leave-type gates" is not evidenced in the HR catalog file itself (only a flat status chip set) — cross-check against `09-settings...md`'s workflow catalog (26 action types include 9 leave-type entries) before finalizing scope |
| Leave Accrual Batches: run + GL journal posting | M | ↑, Phase 2 | |
| Employee Advances: 4-state workflow, balance-sheet-asset treatment | M | Employees, Phase 2 | Expensed only on write-off, not on disbursement |
| My Leave (self-service) | S | Employees | |
| Payroll: 5-state run lifecycle + calculation engine | XL | Contracts, Attendance, Advances | Biggest unknown in the whole catalog — calc-engine internals entirely unobserved in source, needs a dedicated design pass before implementation, not just a build |

### Phase 14 — [DEFERRED] POS · XL

Back-office parity is straightforward; the selling screen is net-new design work with no reference implementation anywhere in the source (`plan.md` §4 Phase 6 risk note carries over verbatim).

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Terminals: CRUD (branch/warehouse/cash-drawer/payment-methods/printer) | M | Phase 7 (treasury) | |
| Payment-method catalog | S | [parallel] | Two non-deletable built-ins (Cash/Card) |
| Sessions/Shifts: open→running→close, variance calc, 6 sub-tabs | XL | ↑ | Settlement, payment breakdown, AR collections, cash movements, sales summary, salesperson breakdown |
| POS Sales ledger + detail (5 tabs) | M | ↑ | |
| POS Refunds: per-line qty-capped returns | M | ↑ | |
| Discount Approvals: queue + thresholds + 5-min expiry | M | — | POS-specific mechanism, deliberately separate from the Phase 10 workflow engine |
| Restaurant mode: Table Management (floor designer, occupancy, stats) | L | — | |
| Restaurant mode: Kitchen Display (stage transitions, meal/course routing) | L | ↑ | `[spec-risk]`: empty queue in source, ticket UI/bump controls inferred; hard-latency screen, needs a dedicated realtime channel |
| Restaurant mode: Reservations | M | ↑ | `[decision]`: source has both an embedded tab and a standalone screen for the same data — consolidate |
| Deliveries: driver assignment, 6-state pipeline | L | — | `[spec-risk]`: 0 records in source, driver-assign/live-map unconfirmed |
| Loyalty points config | S | [parallel] | |
| POS Hub (domain landing page) | S | [parallel] | |
| **POS Selling Screen — net-new design spike** | XL | All of the above | Product grid+scan, cart, held sales, split/multi-method payment, customer attach + walk-in default, AR collection from till, discount-over-limit request, course/meal routing, table assignment, cash-drawer movements. Interview a real cashier; prototype and test on actual hardware before implementation — per `plan.md` §7.4 |
| Barcode-embedded price/weight scan integration | M | Phase 10 (barcode rules) | |
| ESC/POS thermal receipt printing + cash-drawer kick | M | Phase 9 (print engine) | `tcp://ip:9100` raster/text path |
| Offline sale queue + `force_close` permission | L | — | Confirms the source models a shop that stays open with no connectivity — the desktop-native case |

### Phase 15 — [DEFERRED] Cloud/SaaS website edition · XL

Everything the "Path A" architecture decision (SQLite-only now, ports-first) was designed to make additive.

| Issue | Size | Deps | Scope |
|---|---|---|---|
| Postgres dialect: schema-spec DSL codegen for `pg-core`, migrations | L | Phase 0 | |
| Dual-engine conformance test suite (pg+sqlite matrix in CI) | L | ↑ | The safety net this whole architecture bet was made for |
| Cloud JWT auth + refresh-token flow (`HttpOnly` cookie), Argon2id hashing | M | Phase 0 | Two deliberate improvements over the source: no `localStorage` tokens, in-memory access token |
| Postgres Row-Level Security (RLS) per-tenant enforcement | M | ↑ | Defence-in-depth under the repository's own tenant scoping |
| Node server app (`apps/server`): Hono over HTTP, tenant resolution by company code | M | Phase 0 | |
| SSE + Redis pub/sub realtime fan-out | M | Phase 0 (event bus) | Kitchen Display's hard-latency requirement lands properly here |
| S3-compatible file storage adapter | M | Phase 0 (FileStore port) | Swaps for the desktop content-addressed store |
| Subscription/plan → entitlements mapping | M | Phase 0 (entitlements) | Billing integration is a separate, later decision |
| Tenant onboarding flow (company-code registration, seed wizard) | M | ↑ | |
| Multi-tenant admin/platform-admin permissions tier | S | Phase 0 | Source has exactly 2 platform-admin-only permissions |
| API Keys + Connected Apps screen | M | ↑ | Confirmed real feature in source, just unlinked from nav there |
| Webhooks: outbound HMAC-signed event delivery + event-type picker | M | ↑ | `[spec-risk]`: per-event checklist never expanded in source capture |
| WhatsApp integration settings | S | — | `[spec-risk]`: module-gated off in source tenant, only the generic gate screen was ever reachable |
| Email delivery (SMTP/Resend) + headless-Chromium PDF generation | M | Phase 9 (print engine) | Offline must never depend on this path — desktop always has the client-render fallback |
| Cloud backup: PITR, cross-region snapshots, per-tenant export | M | Phase 0 (backup) | Doubles as the cloud→desktop migration path |

---

## 5. Open decisions flagged during extraction (not silently resolved)

These came up repeatedly across the catalog and need a product answer before or during the phase that touches them — each is marked `[decision]` inline above too:

1. **FIFO costing** — option exists in the item form; zero FIFO-costed item was ever observed. Is FIFO in v1 scope, or is Mezan WAC-only at launch? (Phase 1)
2. **Delivery notes** — genuinely absent from the source app (stock deducts on invoice confirmation). Fill the gap, or match the original deliberately? (Phase 5, currently unscoped)
3. **Installment late fees** — no configuration surface exists anywhere in the source. Fixed rule, tenant setting, or per-plan? (Phase 7)
4. **Opening balances for non-treasury GL accounts** (AR/AP/equity) — no clean mechanism found; only treasury accounts have one. (Phase 8)
5. **Branch-scoped numbering sequences** — source is tenant-global; multi-branch customers usually expect prefixes. (Phase 10)
6. **Lead→Opportunity conversion mechanism** — never observed. (Phase 12)
7. **Projects progress billing (مستخلصات)** — a voucher type implies it exists, zero UI evidence. Needs a spike before it can even be sized. (Phase 12)
8. **ETA offline posture** — desktop can build/queue e-invoice payloads but not transmit without connectivity; production doc v1.0 needs e-seal signing. Does desktop require a periodic connectivity window for ETA-enabled tenants, is ETA cloud-only, or does desktop ship with an explicit escalating-banner acknowledged-risk mode? (Phase 8, carried over verbatim from `plan.md` §6.3.4)
9. **Third locale (German)** — offered in the source's language switcher. Real requirement or scaffolding leftover?
10. **Reservations screen duplication** — Table Management's embedded tab and the standalone `/pos/reservations` screen show the same data in the source. Consolidate for Mezan? (Phase 14)
11. **HR leave-type gating** — the task brief's "9 granular per-leave-type workflow gates" isn't directly evidenced inside `06-crm-hr.md`; needs reconciling against the 26-action-type workflow catalog in `09-settings-dashboard-ux.md` before Phase 13 leave-request scoping is final.
12. **Payroll calculation engine internals** — entirely unobserved in source (1 employee, 1 contract, no run ever executed). This is the single largest specification hole in the entire catalog and needs its own design pass, not just a build ticket. (Phase 13)

None of these block starting the phases above them — they block *finishing* the specific issue they're attached to, and are called out so review doesn't mistake "flagged" for "forgotten."

---

## 6. Coverage check — 15 catalog domains → phases

| # | Domain | Catalog file | Covered in phase(s) |
|---|---|---|---|
| 1 | Sales | `01-sales.md` | 3 (core, *priority*), 5 (full, *priority*), 9 (reports) |
| 2 | Purchases | `02-purchases.md` | 3 (core, *priority*), 6 (full, *priority*), 9 (reports) |
| 3 | Inventory | `03-inventory.md` | 1 (items master), 4 (operations, *priority*), 9 (reports) |
| 4 | Accounting | `04-accounting-treasury.md` | 1 (master data), 2 (ledger engine), 8 (depth, *priority*), 9 (financial statements) |
| 5 | Treasury | `04-accounting-treasury.md` | 1 (master data), 7 (completion, *priority*) |
| 6 | POS | `05-pos-installments.md` | **14 [DEFERRED]** |
| 7 | Installments | `05-pos-installments.md` | 7 (*priority*) |
| 8 | CRM | `06-crm-hr.md` | 12 |
| 9 | HR | `06-crm-hr.md` | **13 [DEFERRED]** |
| 10 | Manufacturing | `07-mfg-projects-assets.md` | 4 (configurable-product definitions), 11 (full engine) |
| 11 | Projects | `07-mfg-projects-assets.md` | 12 |
| 12 | Fixed Assets | `07-mfg-projects-assets.md` | 12 |
| 13 | Field/Van Sales | `07-mfg-projects-assets.md` | 12 |
| 14 | Reports (33) | `08-reports.md` | 4 (2 reports), 5 (1 report), 9 (29 reports), 8 (1 report — Cost Center P&L) |
| 15 | Settings/Dashboard/UX | `09-settings-dashboard-ux.md` | 0 (foundation), 10 (full depth); integrations (API Keys/Webhooks/WhatsApp) → **15 [DEFERRED]** |

*Priority tags reflect the stakeholder's explicit call-out: Accounting, Treasury, Installments, Inventory, Purchases, Sales.*

**Deferred, explicitly:** HR & Payroll (all 13 screens, Phase 13), POS (all 16 screens/engines incl. the net-new selling screen, Phase 14), and the Cloud/SaaS surfaces of Settings — API Keys, Webhooks, WhatsApp, subscription/plan, plus the whole multi-tenant/Postgres/realtime/S3 stack (Phase 15).

**Everything else is scheduled.** Every one of the 125 screens the verification pass (`10-verification.md`) confirmed as real — including the 8 previously-hidden domain hubs, CRM Activities, HR My Leave, Settings Profile/API-Keys/Webhooks/WhatsApp — has an explicit home in the table above, whether that home is a v1 phase or a named deferred phase.

---

## 7. What didn't fit cleanly (flagged, not dropped)

A follow-up research pass went back to the primary catalog files (not the condensed extraction summaries) for each item below, to pull exact evidence and turn "flagged" into "flagged with a concrete recommendation."

### 1. Domain hub pages (×8)
**Evidence:** Confirmed real for all 8 (`/sales/hub`, `/purchases/hub`, `/inventory/hub`, `/treasury/hub`, `/accounting/hub`, `/assets/hub`, `/crm/hub`, `/pos/hub`) via bundle-route extraction + test-navigation (`10-verification.md` §1). Content pattern, fullest in `01-sales.md`'s write-up: attention banner (overdue-count style), quick-start button row, a "مناطق العمل" tile grid (per-sub-screen tile with a live count + deep link), recent-activity panel. Accounting Hub's activity feed is called out as the catalog's best evidence of Manufacturing→Accounting auto-posting (work-order completions appearing as journal entries). Treasury Hub's "التخصيصات" tile is confirmed to just redirect into `/treasury/vouchers?tab=needs_allocation`, not an independent screen.
**New finding:** the hubs are *also* independently indexed in the command palette under distinct Arabic names ("لوحة المبيعات", "لوحة الخزينة", "نظرة عامة على المحاسبة", etc. — `09-...md` line 193) — discoverable two ways, not dead code. Strengthens the case for linking them deliberately.
**Unknown:** why they're unlinked from the sidebar at all — the catalog itself only speculates (leftover nav design / breadcrumb-root landing target / reserved for a future simplified-nav mode). Unresolvable from a read-only pass.
**Recommendation:** Build as spec'd, no spike needed — content is fully captured for all 8. (Already scoped as 8 small issues across Phases 3, 4, 8, 9, 12 — unchanged.)

### 2. Delivery notes
**Evidence:** `01-sales.md`: *"No delivery notes / إشعار تسليم screen exists anywhere under Sales or the rest of the visible nav... stock is deducted directly when an invoice is confirmed."* No delivery/logistics module appears in `activeModules[]` either (checked against the full module list in the tenant payload).
**Unknown:** whether this is a deliberate simplification for SMB trading/retail, or a gap a logistics-heavy tenant would hit.
**Recommendation:** Product decision, not a spike. Two clean options: (a) match source exactly, no separate document — cheapest, recommended for v1 given zero evidence of demand; (b) an optional delivery-note step gated behind a setting, relevant mainly to Field/Van Sales (Phase 12). Revisit under (b) only if it comes up post-launch.

### 3. Progress billing / مستخلصات for Projects
**Evidence:** Projects screen (`07-mfg-projects-assets.md`) is CRUD-only — 0 records, so no detail/costing/billing tabs were ever reachable. The create dialog confirms budget field + auto-created `PRJ-{code}` cost center, nothing progress-billing-specific. Separately, the unified voucher's 10 types include **"دفعة مقدمة من عميل مقاولات"** (advance from a contracting customer) whose own UI subtitle reads *"تسترد من المستخلصات"* (recovered from progress certificates) — real, verbatim product copy naming the concept.
**Unknown:** the voucher subtitle is the *only* evidence مستخلصات exists as a concept — there is no مستخلصة screen, tab, or recovery action anywhere. Unknown whether مستخلصات are meant to be regular project-tagged invoices, an unshipped document type in the source product itself, or handled entirely outside the system.
**Recommendation:** Spike, not a build ticket — cannot be sized without a product decision on whether Mezan needs a first-class مستخلصة document type or whether "invoice tagged to project" suffices. Until answered, Phase 12's Projects issue stays scoped to CRUD + cost-center creation only; the advance-recovery voucher subtype ships build-as-spec'd but is functionally orphaned until this is resolved.

### 4. Payroll calculation engine
**Evidence:** `/hr/payroll` list, summary strip, 5-state lifecycle (draft→calculated→approved→disbursed, +cancelled) are fully documented. The create-run dialog is genuinely two fields: year and month — nothing else. `06-crm-hr.md` states outright the actual calculation logic (contracts × attendance × advances × allowances/deductions) "presumably happens after run creation, not explorable further since creating a run is a mutating action."
**New finding:** the tenant settings payload carries `payrollDayDivisorBasis: "FIXED_30"` (`09-...md` line 102) — a real config field controlling proration math, with **zero UI surface anywhere** explaining how it's applied.
**Recommendation:** Confirmed as the single largest specification hole in the whole catalog — needs a standalone design deliverable (not just a design-pass note inside the XL issue) before the Payroll issue in Phase 13 can be split into buildable sub-issues. A reference tenant with an actually-executed payroll run is the only way to close this from recon; absent that, design from Egyptian payroll law directly.

### 5. The "Inbox" page
**Evidence:** `09-...md`'s command-palette "الصفحات" group lists ~80 pages including a **صندوق الوارد (Inbox)** entry, explicitly flagged by the catalog's own gap register as unresolved: *"may be a personal task/notification inbox distinct from الموافقات [Approvals]... route wasn't resolved in this pass."* الموافقات (`/approvals`) is confirmed separately as a real, distinct top-level nav item with its own badge endpoints — so صندوق الوارد is a *third* thing, not a mislabel of Approvals.
**Unknown:** actual route, content, and whether it duplicates the existing Notifications panel or Approvals inbox.
**Recommendation:** Not sizeable yet, and no Mezan issue should be built around it speculatively — Mezan's own Notifications panel (Phase 0) + Approvals inbox (Phase 10) likely cover the real need regardless. A 5-minute confirmation pass (type "صندوق" into `Ctrl+K` on a live reference tenant) would close this if one becomes available; not worth a dedicated ticket otherwise.

### 6. WAC drift tolerance/threshold settings
**Evidence:** Three distinct, named fields in the tenant payload — `wacDriftTolerance: 0.01`, `wacDriftAlertThreshold: 0`, `wacAutoRebuildOnDrift: false` — a real structured feature, not a stray flag. Confirmed **absent from every settings tab** including Inventory Policy, where the catalog explicitly notes they "were NOT found as editable fields on this tab or any other... may be platform-managed-only." The drift *report* itself (read side) is fully real and demonstrated live against actual drift data (`03-inventory.md`).
**New findings surfaced by the same settings-tab pass** (not previously captured in the backlog — folded in below as new issues/scope notes):
  - Inventory Policy tab toggles: `allowBackorder`, `allowNegativeStock`, `allowCrossWarehouseSales`, `showOtherWarehouseStock` — real, documented, not yet named in any Mezan issue.
  - A distinct **aging-based inventory write-down**: a monthly batch that provisions slow-moving stock and posts a JE to accounts 5060 (provision) / 1190 (expense) — separate mechanism from WAC drift, previously named only in `plan.md` §3.5's jobs list, never turned into a backlog issue.
  - `requirePoForGrn: false` and `requireGrnForInvoice: false` confirmed **off by default** in the source tenant — useful default for Mezan's Phase 6 gate issues.
  - FX settings fields (`fxRateMissingPolicy`, `fxResidualTolerance`, `revaluationReversalMode`) exist in the payload with no settings-tab UI found — relevant to Phase 8's FX Revaluation issue.
**Recommendation:** Report side ships as spec'd (already in Phase 4). For the config side: expose `wacDriftTolerance`/`wacDriftAlertThreshold`/`wacAutoRebuildOnDrift` as tenant-editable in Mezan rather than replicating the source's platform-managed-only gap — added as a new Phase 10 issue below. The aging-based write-down job is added as a new Phase 4 issue below. The gate defaults and FX field names are folded into the scope notes of their existing Phase 6 / Phase 8 issues.

### 7. Decision-rollup citations (already in §5 — now sourced precisely)
- **Late fees**: the "معالجة المتأخرات" batch action's own confirmation dialog promises penalties are applied *"حسب إعدادات المنشأة"* (per company settings) — but the catalog is explicit the settings surface for those rules was never located, "likely bundled into the same processor... or lives outside `/settings` scope explored here." The feature is wired and real; only its configuration UI is unlocated.
- **Branch-scoped numbering**: `09-...md`'s sequence edit dialog explicitly notes sequences are tenant-global with no per-branch scoping observed, and separately carries an unpopulated suffix field speculated to support year-suffixing (a different mechanism).
- **FIFO**: real, selectable costing method in the item form with explicit helper-text semantics (oldest-first) — but zero FIFO-costed items exist anywhere in the sampled data, so its interaction with the immutable-cost-layer model is completely unverified at runtime.
- **ETA offline posture**: the source system's own Signing Method field defaults to *"بدون توقيع (إصدار 0.9 — للاختبار فقط)"* with helper text stating production v1.0 requires e-seal signing and that HSM/signing-agent support is itself "in a coming phase" — i.e. the reference product hasn't fully solved this either; it's an inherited constraint, not a Mezan gap.
**Recommendation for all five:** no further catalog digging resolves any of these. Each needs either a product decision or is an inherited Egyptian-tax-law constraint. Kept exactly where §5 already puts them.

---

## 8. UI approach — own UI, functionality-first (updated per stakeholder instruction)

**Decision, stated plainly: Mezan uses its own UI, its own component library, its own visual design — full stop. Visual/pixel fidelity to the source app is explicitly *not* a goal. What is non-negotiable is functional completeness: every field, workflow, state, and action documented for a screen must exist somewhere in Mezan's equivalent screen.** This supersedes the earlier assessment below it (kept for record — the initial research, done before this instruction, explored "replicate the source UI faithfully" and is retained so the reasoning trail is visible, not because it's still the recommendation).

**What this changes concretely:**
- The Phase 0 issue previously titled "Design system / UI-audit spike" is **retitled and rescoped** below to "Own design-system foundation + functional-coverage ruling pass" — screenshot recapture and pixel-pattern matching are dropped; what's kept is (a) building Mezan's own component library from scratch (any visual direction the team chooses) and (b) one explicit ruling per **known behavioral/logic defect** in the source (see list below) so those aren't accidentally inherited — those are bugs, not style, and are worth avoiding regardless of which UI Mezan ships.
- Every "Scope" cell throughout this backlog should be read as a **functional checklist**, not a layout spec. The named UI patterns (list screen, detail screen, side-panel drill-down, "effects of this document" explainer) describe **what information the screen surfaces and when**, not what it looks like — Mezan implements that information architecture with its own elements/components.
- The 8 domain hubs, the 33 reports, the 9-tab print designer, etc. still need to expose everything the catalog documents (every tile, every filter, every column, every tab) — "cover everything" is about completeness of function, not appearance.

**Known behavioral/logic defects in the source — still worth avoiding on their own merits, regardless of UI style:**
- Two independent i18n key-leak bugs (`customers.openingBalance` on the Supplier Statement tab; `crm.activitySubject` as a CRM Activities column header) — a missing-fallback-handling **pattern**, not two isolated typos; a functional bug (wrong text shown), not a style choice.
- CRM Hub's Activities tile reads "مهامي" (My Tasks) in two places but the page's own header reads "الأنشطة" (Activities) — naming inconsistency, worth picking one name deliberately.
- A nav-label-vs-page-header mismatch on Goods Receipts.
- A Reservations dialog whose default end time precedes its start time — a logic bug.
- A Work Orders list whose row click opens the *item*, not the work order — a functional bug (wrong navigation target).
- A tenant that stores `direction: "LTR"` while rendering RTL — a data/logic bug, not a rendering choice; Mezan derives direction from locale.
- An HR dashboard showing 1 termination against 1 active employee — a data-consistency bug.
- `02-purchases.md`'s self-contradiction: the Suppliers list's row-click does a full navigation while a tooltip on the same screen claims it opens a side panel — pick one behavior deliberately for Mezan rather than inheriting the ambiguity.

<details>
<summary>Earlier assessment (superseded — kept for the reasoning trail only)</summary>

A separate assessment pass, done before the stakeholder's "use your own UI" instruction, had checked whether "match the current captured UI as closely as possible" was sound, on the premise that `plan.md` §2.1/§5.1 already committed to "deliberately mirrors the captured app's own idioms" (same Tailwind + shadcn/ui tokens, same IBM Plex Sans Arabic, ~9 shared primitives built to reproduce the source's patterns). It found the described UI patterns were internally consistent across the catalog files, but that **no screenshots exist anywhere in this repo** (`docs/catalog/img/` doesn't exist despite one catalog file referencing a filename from it) — meaning any "faithful replication" could only ever have matched prose-described structure, never actual pixels. That finding is now moot given the decision above, but the bug list it produced remains directly useful (folded in above) since avoiding known bugs is independent of which UI Mezan ships.

</details>