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

- [ ] **D43** Remove the four "(المرحلة الثانية)" placeholders and wire the real data
  - [ ] item detail → stock by warehouse (same source as the stock-levels report)
  - [ ] item detail → cost, from the WAC layers
  - [ ] chart-of-accounts detail → account movements from the GL
  - [ ] treasury account detail → movements from the voucher postings
  - [ ] delete the two tests that assert the placeholder is present
- [ ] **D44 / R6.7** Cost centres get their own columns + "create from departments"
- [ ] **D45** Seed configurable-products, custom-manufacturing, installment-follow-ups; add all three to `pnpm check:seed`
- [ ] **R1.1** Add `…/counts` and `…/stats` endpoints to every list resource; move chip counts and KPI money off the loaded page and onto the server
- [ ] **R2.2** Returns must start from a source document, and returnable quantity must be recomputed server-side

## P1 — shell and navigation

- [ ] **A1** Third nav level: extend `NavGroup` in `packages/ui/src/shell/types.ts`, render sub-groups, regroup `nav-config.tsx`
  - [ ] التقارير → المبيعات / المشتريات / المخزون / التصنيع / الأعمار / الأقساط
  - [ ] المخزون → المنتجات / الحركات · التصنيع → الإنتاج / التعريفات
  - [ ] الإعدادات → عام / المستخدمون / الفروع والمستودعات / سير العمل / الطباعة / التكاملات
  - [ ] المحاسبة → التعريفات / الدورة / التقارير · الموارد البشرية → الموظفون / الحضور والإجازات / الرواتب
- [ ] **R1.5** Ctrl+K command palette: quick actions + go-to
- [ ] **R1.6** Notification centre (all / unread, mark all read)
- [ ] **R1.14** Branch and warehouse as a global header scope
- [ ] **R1.9** Attention banners on lists (overdue, out of stock, drafts) that apply the filter when clicked
- [ ] **R1.10 / R1.11 / R1.12 / R1.13** Empty states with a CTA, collapsible KPI strip, page-size selector, active-filter badge
- [ ] **R1.7 / R1.8** System-status indicator and support entry point

## P2 — reports engine

- [ ] **A2** `ReportDefinition` gains `kpis` and `charts`; server returns the aggregates; `ReportRunner` renders a KPI strip and a chart row
- [ ] **A3** Quick period chips (هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة)
- [ ] **A4** Replace the hardcoded `TODAY = "2026-08-22"` with the real current date
- [ ] **A6** % contribution on by-item / by-customer / top-products / by-supplier / by-salesperson
- [ ] **A7** GL-reconciliation tile on sales-by-item and purchases-by-item
- [ ] **A5** Drill-down side panel from entity cells
- [ ] Roll across all 22 reports, then the 7 financial statements (**R6.6** KPI totals + charts)
- [ ] Keep CSV/Excel export everywhere — the reference has none (**X7**)

## P3 — document surfaces

- [ ] **R2.1** Creation-method step on sales and purchase invoices
- [ ] **R2.3** Live available-stock and out-of-stock badge per line
- [ ] **R2.4** Per-line unit of measure with conversion
- [ ] **R2.5** Per-line and per-document discount type (percentage / fixed)
- [ ] **R2.7** Totals block: add subtotal and tax lines; keep our return-adjusted net
- [ ] **R2.8** Three-card "effects of this document" explainer including "no automatic collection"
- [ ] **R1.4** Attachments across documents and entities
- [ ] **R1.3** State-dependent row overflow menus everywhere
- [ ] **R2.11** Cross-document creation from row menus and detail tabs
- [ ] **R3.4** Sales-invoice detail: add installments and attachments tabs; add تحصيل, new return, new installment plan, submit-to-ETA actions
- [ ] **R4.4** Purchase-invoice detail: add landed-costs and attachments tabs; consumed/received per line; inline pay action
- [ ] **R2.6** Coupon codes · **R2.9** quick-preview panel · **R2.10** share document

## P4 — entity 360

- [ ] **R3.6** Customer 360: statement of account, installments, returns, attachments, audit log, and the create-invoice / collect / new-quote action bar
- [ ] **R4.5** Supplier 360: supplier statement and the purchase-side action bar
- [ ] **R5.5** Item detail: stock by warehouse (with reserved), cost layers, price lists, specifications, attachments, audit log; adjust-stock / transfer / purchase-request / movement-ledger actions
- [ ] **R5.6** Reserved stock per warehouse
- [ ] **R10.2** Employee 360 tabs and the re-hire action
- [ ] **R5.3 / R8.4** Inline opening-balance actions on zero-stock items and treasury accounts
- [ ] **R3.7** Loyalty points — decide in or out for v1; if in, build it as a sub-ledger

## P5 — missing features

- [ ] **R8.1** Voucher types 4 → 11, card grid with explanations, correct GL routing for partner capital, drawings and tax payments
- [ ] **R5.1** Item types 2 → 6, with the behavioural rules per type
- [ ] **R4.2** Purchase-invoice line types (stock / expense / freight)
- [ ] **R5.9** Stock-adjustment reason wizard, per-reason GL accounts, reason on the list and the journal entry, reason filter
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
- [ ] **R12.1** Approvals: inbox / my requests / my actions
- [ ] **R3.8** Customer form advanced options (logo, registrations, tax-exempt, entity type, contact)
- [ ] **R3.9** Sales return: per-line reason, awaiting-refund state, refund action
- [ ] **R3.11 / R3.12** Price-list min-quantity tiers; promotion types, caps, priority, bundles
- [ ] **R3.13** Van trip crew roles and van→warehouse→treasury cascade
- [ ] **R4.6 / R4.7** GRN from PO only; landed-cost allocation basis and typed cost lines
- [ ] **R5.4** Item form: image, description, default supplier, season, channels, per-price-list prices, specifications
- [ ] **R5.8** Transfer import from Excel
- [ ] **R5.10** Brands, seasons and specification facets
- [ ] **R10.5** Leave-request create action
- [ ] **R1.15 / R1.16** 11 document currencies; per-currency AR/AP balances

## P6 — list-surface parity

One task per row of the per-screen tables in `gap-inventory.md` §B–D2. Start with
the money-bearing ones: purchase-invoice payment dimension (**R4.1**), items stock
column (**R5.2**), stock-balance filters (**R5.7**), sales-returns filter bar,
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
