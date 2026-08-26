# Parity task list

The ordered work list. Every item traces to a requirement id in
`audit/REQUIREMENTS.md` (R…) or a gap id in `gap-inventory.md` (A…/H…), or to a
defect in `docs/defects.md`. Scenarios that verify them are in
`docs/scenarios/10-reference-parity.md`.

Tick an item only when it has been driven in the running app on seeded data, in
**both locales** (ar/RTL and en/LTR) and **both themes**.

`[ ]` open · `[~]` in progress · `[x]` done and verified live

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
- [~] **R1.1** Add `…/counts` and `…/stats` endpoints to every list resource; move chip counts and KPI money off the loaded page and onto the server
      - [x] Sales invoices — `/sales-invoices/counts` + `/stats`, derived `open`/`overdue` chips resolved server-side, `branchId`/`warehouseId`/`search` added to the list query
      - [x] Purchase invoices — `/purchases/invoices/counts` + `/stats`, payment states (`overdue`/`due_soon`/`partially_paid`/`paid`) resolved server-side
      - [x] The float defect underneath it: 22 money sums across 14 screens moved to bigint (`apps/web/src/lib/money.ts`)
      - [ ] The remaining list resources — picked up per area as the sidebar sweep reaches them
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
- [~] **R1.10 / R1.11 / R1.12 / R1.13** Empty states with a CTA, collapsible KPI strip, page-size selector, active-filter badge
  - [x] The shared primitives — `EmptyState` (with CTA), `DocumentList`'s `statsCollapsible`/`listKey` (collapse persists across reload) and `filterBarCollapsible`/`activeFilterCount` (a "تصفية النتائج N" badge) — built and driven live end-to-end on the new notifications screen, ar+en, both themes
  - [~] Rollout onto the ~63 document-list screens — each is an opt-in, back-compat prop; left to each screen's own owner. Done on customers, sales returns, price lists, promotions and van trips (R3.8/R3.9/R3.11/R3.12/R3.13)
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
- [~] **R23.1** Pipeline board: stage colour dots, board/list toggle, customer and value-range filters — branch filter not built, opportunities carry no branch
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
- [x] **R1.3** State-dependent row overflow menus — on 42 list screens. Every menu is derived from that row's own state, reusing the derivation the screen already had (the cheque's `legalActions`, the config instance's `canAct`, the project's `canTransitionProject`, ETA's `actionable`, the lead's and the employee's `validTransitions`). Verified live: a locked fiscal period offers nothing, a collected cheque offers only view, a bounced one only its replacement, a draft invoice only its confirm — which posts a balanced entry
  - [ ] The 17 remaining `DocumentList` screens are read-only report surfaces (audit log, stock balance, cost-centre P&L, reconciliation, FX revaluation, leave balances and accruals, attendance) or flat master data whose only per-row action is an inline edit (departments, job titles, holidays, asset categories, leave policies, payroll components, pipeline stages, item specifications, product templates). None carries a lifecycle, so a state-dependent menu there would hold a single entry. Settle against the running reference before adding one
- [x] **R2.11** Cross-document creation — invoice → return / plan / collection; customer → invoice / collection / quote; quote → its invoice (convert on an accepted quote, open the invoice on a converted one); plan → the invoice it schedules; supplier → purchase invoice / payment / purchase order
- [x] **R3.4** Sales-invoice detail: installments tab, the cross-document actions and the attachments tab
- [x] **R4.4** Purchase-invoice detail: landed-costs tab, consumed/received/still-in-stock per line (read from the cost layers the funding document created), an inline «تسجيل السداد» that posts a real سند صرف, and the attachments tab
- [ ] **R2.6** Coupon codes · **R2.9** quick-preview panel · **R2.10** share document

## P4 — entity 360

- [x] **R3.6** Customer 360: overview, invoices, statement, installments, returns, attachments and audit — and customer create/update now emit the audit events the trail tab needs
- [x] **R4.5** Supplier 360: the dated supplier statement, reconciled against both the open-invoice sub-ledger and the aging report, and the action bar (فاتورة مشتريات جديدة · سداد للمورد · أمر شراء جديد)
- [~] **R5.5** (all but the purchase-request action) Item detail: stock by warehouse (with reserved), cost layers, price lists, specifications, attachments, audit log; adjust-stock / transfer / purchase-request / movement-ledger actions
  - [x] stock by warehouse with available / reserved / total
  - [x] cost layers (remaining qty, unit cost, source, date)
  - [x] price lists (list, base price, custom price, delta)
  - [x] specifications (named from the catalogue, following the reading language), attachments, movement ledger and audit log tabs
  - [x] header actions: adjust stock and transfer, both routing with the item already answered
  - [ ] "raise purchase request" — no purchase-request document type exists in this product, and routing to a purchase order without prefilling the item would be a half-wired control. Needs the document type, or the purchase-order form to accept an item prefill
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
- [ ] **R3.7** Loyalty points — decide in or out for v1; if in, build it as a sub-ledger

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
  - [ ] credit control mode (warn vs block)
  - [ ] sell-from-another-warehouse, show other-warehouse stock, backorders, negative stock, aging write-down provision, auto batch numbers
  - [ ] require PO before GRN, require GRN before purchase invoice
  - [ ] block negative cash balances (drawers only, not banks)
  - [ ] VAT enable / default rate / inclusive vs exclusive / depreciation in month of acquisition
  - [ ] email SMTP + test send + template
  - [ ] multi-currency enable, allowed currencies, missing-rate policy, numeral system, fiscal-year start
- [x] **R12.1** Approvals: inbox / my requests / my actions, with the document-type filter (R14.1)
- [x] **R3.8** Customer form advanced options — the form splits into everyday fields and «خيارات متقدمة» (tax + commercial registration, tax-exempt, entity type, contact person, address, logo). The logo is chosen from the customer's own attachments, so the bytes live in the attachments resource and the record holds only the id. `priceListId` was a free TEXT field storing whatever was typed; it is now a picker over `/price-lists`, and the routes refuse an id that names no list
- [x] **R3.9** Sales return: a reason PER LINE, a derived awaiting-refund state, and «استرداد للعميل» that creates and confirms a real رد مبلغ لعميل voucher (Dr AR 1105 / Cr the till, one balanced entry). What may still be refunded is recomputed server-side from the posted return and the vouchers already posted against it; `awaitingRefund` is derived from those vouchers rather than stored, so reversing one restores the ledger AND the awaiting state in a single act. `POST /sales-returns/from-invoice` existed in the domain and was mounted nowhere — it is now the shape the screen sends
- [x] **R3.11 / R3.12** Price-list minimum-quantity tiers (an item quoted once per volume threshold, resolved server-side by `resolvePriceTier` and threaded into the sales-invoice pricing check as the line's base quantity); promotion minimum quantity and maximum discount cap, the cap re-allocated by largest remainder so the parts still sum exactly. Both screens now edit every field the reference has, including bundle components over the real item endpoint
- [x] **R3.13** المركبات — a van registry owning each vehicle's warehouse, till and branch. `POST /field/van-trips` takes `vanId` alone and derives the rest, refusing a body that names a van and a different warehouse or till; the crew binds to real employees. The three cascaded fields are read-only and stay empty until a van is chosen
- [x] **R4.6** GRN from PO only — the create form is a creation-method STEP whose «استلام مباشر» card is offered only when the tenant's «إلزام أمر الشراء قبل الاستلام» setting is off. The screen READS that setting; the server gate was already live and now refuses in Arabic
- [x] **R4.7** Landed-cost allocation basis and typed cost lines — a third basis (حسب الوزن) beside value and quantity, the shipped weight carried on the persisted line so a confirmed document still states its basis, and the entered cost broken down by نوع التكلفة on both the form and the document
- [~] **R5.4** Item form: image, description, default supplier, season, channels, per-price-list prices, specifications
  - [x] description, default supplier (bound to a real supplier), season, brand, specifications
  - [ ] image — no longer blocked: R1.4's attachments resource has landed and the item detail already carries the tab. What is left is showing a chosen image AS the item's picture on the form rather than as one more file in the list
  - [ ] channels & visibility — no sales-channel concept exists anywhere in the product yet; needs a decision before it can be built
  - [ ] editing a per-price-list price from the item form (the read-only view landed with R5.5)
- [ ] **R5.8** Transfer import from Excel
- [x] **R5.10** Brands, seasons and specification facets — brands and seasons are entities, items carry registry-checked specification values, and the list filters by all three
- [x] **R10.5** Leave-request create action, including filing on behalf of another employee behind `hr.leave.approve`
- [~] **R1.15 / R1.16** 11 document currencies; per-currency AR/AP balances
      - [x] The eleven-currency registry (`packages/domain/src/currency/`), the demo tenant's allowed list, the exchange-rate and revaluation screens
      - [x] A foreign SALES invoice converts at the approved rate of its own date, tags its receivable line, stamps the rate, and stores the BASE total in the sub-ledger (D24's remaining half)
      - [x] `GET /gl/balances-by-currency` — per-currency, per-party AR/AP in both the transaction and the base currency, shown on the revaluation screen
      - [ ] The document screens still print every amount with the tenant's base-currency label (D52); the sales-invoice form offers only EGP + the customer's own currency rather than the eleven, and the purchase-invoice form has no currency field at all — its route accepts one, no screen sends one

## P6 — list-surface parity

One task per row of the per-screen tables in `gap-inventory.md` §B–D2. Start with
the money-bearing ones: purchase-invoice payment dimension (**R4.1**), items stock
sales-returns filter bar,
journal date filter and source-module column (**R6.3**), tax groups (**R6.4**),
exchange-rate filters (**R6.5**), branch price-list column, CRM KPIs and board view,
HR dashboard charts (**R10.1**), asset status chips.

## Out of scope for v1

POS (9 screens + 2 reports), `/settings/shifts`, a standalone label-templates
screen, statutory payroll computation. Payroll must stay visibly flagged rather
than silently computing a wrong net.

## Do not copy

X1–X8 in `audit/REQUIREMENTS.md` and C1–C13 in `gap-inventory.md`. In particular:
keep report export, keep the hubs linked, keep the daily attendance list, do not
reproduce the 0.00 treasury balance bug, and label a purchase return correctly.
