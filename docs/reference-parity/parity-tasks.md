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
- [~] **D44 / R6.7** Cost centres get their own columns + "create from departments"
      - [x] Own column headers — the tree was rendering chart-of-accounts labels over cost-centre data
      - [ ] "Create from departments" (the reference has `accounting/cost-centers/importable-departments`; we have no such endpoint)
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
- [ ] **R1.6** Notification centre (all / unread, mark all read)
- [x] **R1.14** Branch and warehouse as a global header scope — six document lists now narrow by warehouse, and changing the scope refetches
- [x] **R1.9** Attention banners on lists (overdue, out of stock, drafts) that apply the filter when clicked
- [~] **R1.10 / R1.11 / R1.12 / R1.13** Empty states with a CTA, collapsible KPI strip, page-size selector, active-filter badge
- [ ] **R1.7 / R1.8** System-status indicator and support entry point

## P2 — reports engine

- [~] **A2 / R21.2** `ReportDefinition` gains `kpis`; the server returns the aggregates; `ReportRunner` renders a collapsible KPI strip
  - [x] the mechanism, and a default that gives EVERY report a strip from its own total columns
  - [x] chart captions (R21.3), methodology footnote (R21.9) and the balance banner (R21.10) as runner capabilities
  - [x] charts — eight reports declare one, rendered from the SAME rows the table shows
  - [x] **R21.4** chart view toggles (bars / pie / table / hide) on the chart card
  - [ ] per-report `kpis` overrides where the column totals do not say enough
  - [ ] charts on the remaining inventory / accounting reports
- [x] **A3** Quick period chips (هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة) — on every report that has a date range
- [x] **A4** Replace the hardcoded `TODAY = "2026-08-22"` with the real current date — and fix the UTC day-shift in every `toISOString()` "today" across 21 screens
- [x] **A6 / R21.6** % contribution on by-item / by-customer / top-products / by-supplier / by-salesperson — rendered as an inline bar, not a bare number
- [x] **A7** GL-reconciliation tile on sales-by-item and purchases-by-item — both tie to the cent
- [x] **R21.1** Every report subtitle is the question that report answers, in both languages (29 rewritten)
- [x] **R21.10** The trial balance states that it balances, as a banner above the table
- [x] **R7.1–R7.6** ETA e-invoicing: readiness meter, general + credentials tabs, item and unit mapping, submissions queue — and the payload now carries the registered codes instead of a hardcoded VAT sub-type
- [~] **R23.1** Pipeline board: stage colour dots, board/list toggle, customer and value-range filters — branch filter not built, opportunities carry no branch
- [ ] **A5** Drill-down side panel from entity cells
- [ ] Roll across all 22 reports, then the 7 financial statements (**R6.6** KPI totals + charts)
- [ ] Keep CSV/Excel export everywhere — the reference has none (**X7**)

## P3 — document surfaces

- [ ] **R2.1** Creation-method step on sales and purchase invoices
- [ ] **R2.3** Live available-stock and out-of-stock badge per line
- [ ] **R2.4** Per-line unit of measure with conversion
- [ ] **R2.5** Per-line and per-document discount type (percentage / fixed)
- [x] **R2.7** Totals block: subtotal and tax lines added, return-adjusted net kept
- [ ] **R2.8** Three-card "effects of this document" explainer including "no automatic collection"
- [ ] **R1.4** Attachments across documents and entities
- [~] **R1.3** State-dependent row overflow menus (primitive built; on sales invoices — roll out to the rest)
- [~] **R2.11** Cross-document creation (invoice → return / plan / collection; customer → invoice / collection / quote; quote → its invoice)
- [~] **R3.4** Sales-invoice detail: installments tab and the cross-document actions done; attachments tab still open
- [ ] **R4.4** Purchase-invoice detail: add landed-costs and attachments tabs; consumed/received per line; inline pay action
- [ ] **R2.6** Coupon codes · **R2.9** quick-preview panel · **R2.10** share document

## P4 — entity 360

- [~] **R3.6** Customer 360: statement already existed; action bar done; installments/returns/attachments/audit tabs still open
- [ ] **R4.5** Supplier 360: supplier statement and the purchase-side action bar
- [~] **R5.5** Item detail: stock by warehouse (with reserved), cost layers, price lists, specifications, attachments, audit log; adjust-stock / transfer / purchase-request / movement-ledger actions
  - [x] stock by warehouse with available / reserved / total
  - [x] cost layers (remaining qty, unit cost, source, date)
  - [x] price lists (list, base price, custom price, delta)
  - [ ] specifications, attachments, audit log tabs
  - [ ] header actions: adjust stock, transfer, raise purchase request, movement ledger
- [x] **R5.6** Reserved stock per warehouse — derived from open documents, never stored
- [ ] **R10.2** Employee 360 tabs and the re-hire action
- [~] **R5.3 / R8.4** Inline opening-balance actions on zero-stock items and treasury accounts
  - [x] **R5.3** items list: row-menu action on zero-stock rows, routed to the adjustment form with the reason and item already answered
  - [ ] **R8.4** the same on treasury accounts
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
- [ ] **R4.2** Purchase-invoice line types (stock / expense / freight)
- [x] **R5.9** Stock-adjustment reason wizard, per-reason GL accounts, reason on the list and the journal entry, reason filter
- [ ] **R9.1 / R9.2** Work-order shop-floor actions and the seven detail tabs with shortage tracking
- [ ] **R6.1** **Account routing screen** — the whole GL-mapping configuration (tax, leave, contracting, sales-discount contra, per-reason inventory adjustments, payroll components, per-item-type revenue/COGS/inventory)
- [ ] **R7.1–R7.6** ETA: readiness meter, general settings, credentials with test-connection, item mapping, unit mapping with suggestions, submissions queue with exclude
- [ ] **R11.1–R11.8** Split settings into the ten policy tabs and make each toggle actually change document behaviour:
  - [ ] credit control mode (warn vs block)
  - [ ] sell-from-another-warehouse, show other-warehouse stock, backorders, negative stock, aging write-down provision, auto batch numbers
  - [ ] require PO before GRN, require GRN before purchase invoice
  - [ ] block negative cash balances (drawers only, not banks)
  - [ ] VAT enable / default rate / inclusive vs exclusive / depreciation in month of acquisition
  - [ ] email SMTP + test send + template
  - [ ] multi-currency enable, allowed currencies, missing-rate policy, numeral system, fiscal-year start
- [x] **R12.1** Approvals: inbox / my requests / my actions, with the document-type filter (R14.1)
- [ ] **R3.8** Customer form advanced options (logo, registrations, tax-exempt, entity type, contact)
- [ ] **R3.9** Sales return: per-line reason, awaiting-refund state, refund action
- [ ] **R3.11 / R3.12** Price-list min-quantity tiers; promotion types, caps, priority, bundles
- [ ] **R3.13** Van trip crew roles and van→warehouse→treasury cascade
- [ ] **R4.6 / R4.7** GRN from PO only; landed-cost allocation basis and typed cost lines
- [~] **R5.4** Item form: image, description, default supplier, season, channels, per-price-list prices, specifications
  - [x] description, default supplier (bound to a real supplier), season, brand, specifications
  - [ ] image — needs the attachments resource (R1.4)
  - [ ] channels & visibility — no sales-channel concept exists anywhere in the product yet; needs a decision before it can be built
  - [ ] editing a per-price-list price from the item form (the read-only view landed with R5.5)
- [ ] **R5.8** Transfer import from Excel
- [x] **R5.10** Brands, seasons and specification facets — brands and seasons are entities, items carry registry-checked specification values, and the list filters by all three
- [ ] **R10.5** Leave-request create action
- [ ] **R1.15 / R1.16** 11 document currencies; per-currency AR/AP balances

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
