# Mezan ERP — Coverage / Parity Audit vs. Reference App

**Date:** 2026-08-23 · **Branch:** `audit/coverage` · **Author:** Bassam Zakaria
**Method:** The catalog under `docs/catalog/01..10` (125-screen census in `10-verification.md`)
is treated as the authoritative spec of the reference app. Each screen / tab / model /
business rule is compared against the actual implementation in `packages/domain/src/*`,
`packages/api/src/*`, `packages/persistence/src/*`, and `apps/web/src/*`
(`ROUTABLE_SCREENS` in `App.tsx`). Live Playwright spot-checks were not required — the
gaps are unambiguous at the code level. **This document is a report only; no feature code
was changed.**

> **Post-audit note (2026-08-23, later the same day):** this audit was written just before two
> merges landed on `main` — the **financial-statement report family** (income statement, balance
> sheet, cash flow, VAT return, general/account ledger) and the **inventory-operations** screens
> (stock adjustments, transfers, physical counts, stock balance). Both are counted as gaps below
> and should be read as closed; the inventory-ops screens are, however, still domain-in-browser
> rather than API-backed (see `docs/web-data-wiring.md`). The parity percentage below has not been
> recomputed — treat it as a floor, not a current figure.

Status legend: **Full** = domain + API + persistence + wired web screen all present ·
**Partial** = some layers present (e.g. backend engine but no UI, or UI on demo data,
or feature computed but not applied) · **Missing** = absent across all layers.

---

## 0. Headline

> ## Parity: **63%** (139.5 / 222 weighted items)

Weighting: Full = 1.0, Partial = 0.5, Missing = 0. Universe = 105 unique screens + 33
reports + 84 audited business rules = 222 items.

| Axis | Full | Partial | Missing | Total | Weighted parity |
|---|---|---|---|---|---|
| **Screens** (deduped) | 51 | 12 | 42 | 105 | **54%** (57/105) |
| **Reports** (catalog 08) | 19 | 1 | 13 | 33 | **59%** (19.5/33) |
| **Business rules** | 57 | 12 | 15 | 84 | **75%** (63/84) |
| **Overall** | 127 | 25 | 70 | 222 | **63%** (139.5/222) |

**One-sentence verdict:** Mezan's accounting/costing/document *engines* are strong and
near-1:1 (business-rule parity 75%), but two entire domains (**POS**, **HR**) are absent,
the **financial-statement report family** is unbuilt, and a swathe of **operational
inventory UIs and settings screens** are backend-only or missing — so screen-level parity
is barely over half.

---

## 1. Gaps ranked by importance

1. **POS domain — entirely absent (0 of 4 layers).** No `packages/domain/src/pos`, no
   POS API routes, no persistence, no schema tables, no screens. 12 reference screens
   missing (Terminals, Sessions/Shifts, POS Sales, POS Refunds, Kitchen Display, Table
   Management, Deliveries, Discount Approvals, Reservations, Shift Settings, POS Selling
   Screen, POS Hub) plus all POS business rules (session cash reconciliation, POS
   sale→GL+stock-out, refunds, discount approvals). `pos` exists only as a licensing
   module id (`permissions/catalog.ts`) and a "قريباً" nav placeholder
   (`apps/web/src/sample-data.ts:223`). *Note: the reference itself ships the actual
   selling screen `/pos/sell` on mobile/desktop only — that one screen is NA on web even
   upstream.*

2. **HR domain — entirely absent (0 of 4 layers).** No `hr` domain module, no `hr-routes`,
   no HR store, no HR schema (`schema.ts`'s only `employeeId` belongs to field-sales van
   trips). 13 screens missing (HR Dashboard, Employees, Departments, Job Titles,
   Attendance, Official Holidays, Contracts, Leave Requests, Payroll, Employee Advances,
   Leave Policies, Leave Accrual Batches, My Leave). A full `hr.*` RBAC permission set
   exists (`permissions/catalog.ts:228-263`) and `hr` is in `demoActiveModules` — **dead
   scaffolding gating nothing.** Payroll→GL posting, leave accrual/approval, advances,
   attendance, Egyptian Labor Law leave presets: all unimplemented.

3. **Financial-statement report family — unbuilt.** Of the reference `/accounting/reports`
   7-tab page, only **Trial Balance** and **Cost-Center P&L** exist. **Income Statement
   (P&L), Balance Sheet, Cash Flow, VAT Return, General Ledger report, Account Ledger
   statement** have zero implementation (grep for `incomeStatement`/`balanceSheet`/
   `cashFlow` is empty). Plus Trial Balance's screen runs on hard-coded sample data
   (`TrialBalanceReportScreen.tsx:6-25`), not the live posted ledger. This is the single
   biggest *accounting-output* hole.

4. **5 accounting-depth screens run on an in-browser demo store, not the API.**
   `FxRevaluationScreen`, `EtaScreen`, `ReconciliationScreen`, `CostCenterPnLScreen`,
   `ExchangeRatesScreen` import `store/accounting-depth-store.ts` (executes real domain
   logic in-browser over seed data) instead of `data/hooks`. The other 40 screens are
   correctly wired to the real HTTP API. Domain + API layers for these 5 are real and
   independently tested — only the end-to-end UI→API→persistence wiring is absent.

5. **Inventory operational UIs missing / backend-only.** Stock Balance, Stock Transfers,
   Stock Adjustments are "قريباً" nav placeholders (not in `ROUTABLE_SCREENS`) — the
   write-side engines and `POST` endpoints exist (`inventory-routes.ts`) but there is no
   list/detail GET and no screen. Physical Counts has **no engine at all** (only an
   adjustment reason `PHYSICAL_COUNT`). Product Templates (variant/SKU generator) and
   Label/Barcode Printing are wholly absent.

6. **Sales pricing/promotions computed but not applied to real documents.** The promotions
   engine (`promotions/engine.ts`) computes all discount kinds but is wired only to an
   `/evaluate` preview — never persisted onto confirmed invoices; the Promotions Report
   endpoint is a zero-returning stub. Price-list `resolvePrice` exists but invoice/quote
   line-building never invokes it, so an assigned price list does not drive line prices.

7. **Withholding tax absent.** Line VAT and tax-exemption are implemented; no WHT model
   anywhere (spec references it via ETA buyer-type/national-ID thresholds).

8. **JE approval (`pending`) transition not wired.** `pending` is a declared journal
   status (`journal.ts:20`) but no submit-for-approval/approve transition or route exists
   — only draft→posted directly. The spec's draft→pending-approval→posted chain is broken
   at the pending step. (The generic `workflow/gate.ts` approval engine exists and is used
   on sales/purchase/returns/landed-cost docs, but is not applied to journals.)

9. **Settings surface is backend-heavy, UI-thin.** Engines for numbering, workflow/
   approvals, audit, entitlements, and historical import are well-factored, but their
   config/read **web screens are missing**: no `/settings/sequences`, `/settings/workflow`,
   `/settings/data-migration`, `/audit` log viewer. Entirely absent: Notification Rules
   (no engine at all), Barcode, Profile, API Keys, Webhooks, WhatsApp, Shift Settings.

10. **Lower priority:** all 8 domain **Hub landing pages** missing (Sales/Purchases/
    Inventory/Accounting/Treasury/CRM/Assets/POS) — the reference itself leaves these
    unlinked from the sidebar. **Projects** is skeletal (master data + budget + auto
    `PRJ-` cost center only; no cost/revenue rollup or document linkage). **Make-vs-Buy**,
    **Sales-by-Salesperson**, **Van Sales**, **Expiring-Soon (FEFO)**, **POS Daily/Shift**
    reports missing. Inventory-valuation→live-GL reconciliation is internal-only.

---

## 2. Per-domain detail

### 2.1 Sales (catalog 01)

| Screen / Rule | Status | Evidence / Gap |
|---|---|---|
| Customers | Full | `screens/CustomersScreen.tsx`; `domain/customers`; `customers-routes.ts`; `customer-repository.ts` |
| Sales Invoices | Full | `screens/SalesInvoicesScreen.tsx`; `domain/sales-invoices`; `sales-invoices-routes.ts`; `sales-invoice-store.ts` |
| Quotes | Full | `screens/SalesQuotesScreen.tsx`; `domain/sales-quotes`; `sales-quotes-routes.ts` |
| Sales Returns | Full | `screens/SalesReturnsScreen.tsx`; `domain/sales-returns` |
| Van/Rep Trips | Full | `screens/VanTripsScreen.tsx`; `domain/field-sales`; `van-trip-store.ts` |
| Price Lists | Full | `screens/PriceListsScreen.tsx`; `domain/price-lists/pricing.ts` |
| Promotions | Full | `screens/PromotionsScreen.tsx`; `domain/promotions/engine.ts` |
| Promotions Report | Partial | `promotions-routes.ts:85` is a zero stub; no web screen |
| Sales Hub `/sales/hub` | Missing | no screen/route/nav key |
| Rule: Invoice GL (AR/revenue/VAT/COGS/inventory) | Full | `sales-invoices/gl.ts:41` — 4 balanced legs |
| Rule: WAC on delivery/COGS | Full | `sales-invoices/service.ts:221` via `stock.issue` moving-avg |
| Rule: Credit-limit BLOCK gate on confirm | Full | `sales-invoices/service.ts:288` `CreditLimitExceededError`; `credit-control/credit-check.ts:50` |
| Rule: Sales-return GL reversal + restock at WAC | Full | `sales-returns/sales-return-document.ts:146` |
| Rule: Quote → Invoice conversion | Full | `sales-quotes-routes.ts:287` |
| Rule: Line tax / exemption | Full | `sales-invoices/totals.ts:131` |
| Rule: Withholding tax | Missing | no WHT logic anywhere |
| Rule: Price-list auto-applied to lines | Partial | `resolvePrice` exists but not invoked during line build |
| Rule: Promotions applied/persisted to invoices | Partial | engine computes; only `/evaluate` preview, never persisted |

### 2.2 Purchases (catalog 02)

| Screen / Rule | Status | Evidence / Gap |
|---|---|---|
| Suppliers | Full | `screens/SuppliersScreen.tsx`; `domain/suppliers`+`partners` |
| RFQs | Full | `screens/RfqsScreen.tsx`; `domain/purchasing/rfq.ts`; `rfq-store.ts` |
| Purchase Orders | Full | `screens/PurchaseOrdersScreen.tsx`; `domain/purchasing`; `purchasing-stores.ts` |
| Goods Receipts | Full | `screens/GoodsReceiptsScreen.tsx`; `purchasing/goods-receipt.ts` |
| Purchase Invoices | Full | `screens/PurchaseInvoicesScreen.tsx`; `purchasing/purchase-invoice.ts` |
| Purchase Returns | Full | `screens/PurchaseReturnsScreen.tsx`; `domain/purchase-returns` |
| Landed Costs | Full | `screens/LandedCostsScreen.tsx`; `domain/landed-costs` |
| Purchases Hub `/purchases/hub` | Missing | no screen/route |
| Rule: PO→GR→PI auto-populate from parent | Full | `goods-receipt.ts:138`; `purchase-invoice.ts:219` |
| Rule: GRN stock-in at cost | Full | `goods-receipt.ts:299` → `stock.postReceipt` |
| Rule: PI GL (inventory/expense Dr, VAT Dr, AP Cr) | Full | `purchase-invoice.ts:326-335` |
| Rule: Landed-cost allocation → WAC | Full | `landed-costs/distribution.ts:53`; revalues on confirm |
| Rule: Purchase-return GL + stock-out at cost | Full | `purchase-returns/purchase-return-document.ts:120` |
| Rule: RFQ workflow + RFQ→PO | Full | `purchasing/rfq.ts:323` |
| Rule: Historical import (payable only, no JE/stock) | Full | `purchasing/historical-import.ts:9` |
| Rule: Per-supplier payable subledger / statement | Partial | AP at GL-account level only; no per-supplier balance rollup |

### 2.3 Inventory (catalog 03)

| Screen / Rule | Status | Evidence / Gap |
|---|---|---|
| Items | Full | `screens/ItemsScreen.tsx`; `domain/items`; `items-routes.ts` |
| Configurable Products | Full | `screens/ConfigurableProductsScreen.tsx`; `manufacturing/configurable-product.ts` |
| Product Templates (variant generator) | Missing | no domain/API/screen |
| Stock Balance | Partial | nav placeholder, not routable; only `GET /balance` per-position; no overview UI |
| Stock Transfers | Partial | `POST /transfers` + `postTransfer` engine exist; no list/detail GET, no screen |
| Stock Adjustments | Partial | `POST /adjustments` + `postAdjustment` engine; no list/detail GET, no screen |
| Physical Counts | Missing | only adjustment reason `PHYSICAL_COUNT`; no count-session engine/UI |
| Label / Barcode Printing | Missing | no nav/screen/API |
| Warehouses | Full | `settings/WarehousesPage.tsx`; `warehouses-routes.ts`; `warehouse-store.ts` |
| Branches | Full | `settings/BranchesPage.tsx`; `branches-routes.ts`; `branch-store.ts` |
| Inventory Valuation report | Full | `report-inventory-valuation`; `inventory-routes.ts:123 getValuation` |
| Inventory Hub `/inventory/hub` | Missing | no hub screen |
| Rule: WAC maintenance on every in/out | Full | `stock-ledger-service.ts:216 applyMovement`; pure `wac.ts:82 replay` |
| Rule: Ledger postings (receipt/issue/transfer/adjustment) | Full | `postReceipt/postIssue/postTransfer/postAdjustment` |
| Rule: Negative-stock prevention | Full | `applyMovement:251 NegativeStockError` (policy-gated) |
| Rule: Multi-warehouse separation | Full | snapshots/layers keyed by (item, warehouse) |
| Rule: Physical-count variance→auto-adjustment | Partial | reason only; no system-vs-counted variance engine |
| Rule: Valuation Σ(qty×WAC) tie to live GL | Partial | drift is cache-vs-ledger-vs-layers; no compare vs live GL inventory account |

### 2.4 Accounting & Treasury (catalog 04)

| Screen / Rule | Status | Evidence / Gap |
|---|---|---|
| Chart of Accounts | Full | `screens/ChartOfAccountsScreen.tsx`; `domain/accounts`; `accounts.ts` |
| Cost Centers | Full | `screens/CostCentersScreen.tsx`; `domain/cost-centers` |
| Cost Center P&L | Full (UI on demo store) | `screens/CostCenterPnLScreen.tsx` (in-browser store); `domain/cost-center-pl` |
| Journal Entries | Full | `screens/JournalsScreen.tsx`; GL engine `gl/post.ts`; `gl-routes.ts` |
| Fiscal Periods | Full | `screens/FiscalPeriodsScreen.tsx`; `fiscal-periods/transitions.ts` |
| Taxes | Full | `screens/TaxesScreen.tsx`; `tax-rates/tax-rate.ts` |
| Exchange Rates | Full (UI on demo store) | `screens/ExchangeRatesScreen.tsx` (in-browser store); `exchange-rates/convert.ts` |
| ETA e-Invoicing | Full (UI on demo store; transmit stubbed) | `screens/EtaScreen.tsx`; `domain/eta/*`; online transmit stubbed, offline queue real |
| Financial Reports (GL + Account Ledger + P&L/BS/CF tabs) | Partial | only standalone Trial Balance on sample data; 6 of 7 tabs missing |
| Balance Reconciliation | Full (UI on demo store) | `screens/ReconciliationScreen.tsx`; `reconciliation/reconciliation.ts` |
| FX Revaluation | Full (UI on demo store) | `screens/FxRevaluationScreen.tsx`; `fx-revaluation/revaluation.ts` |
| Treasury Accounts | Full | `screens/TreasuryAccountsScreen.tsx`; `domain/treasury-accounts` |
| Cash/Payment Vouchers | Full | `screens/TreasuryVouchersScreen.tsx`; `domain/vouchers` (10 types, GL, allocation) |
| Bank Reconciliation | Full | `screens/BankReconciliationScreen.tsx`; `domain/bank-reconciliation` |
| Cheque Register (7-state) | Full | `screens/ChequesScreen.tsx`; `cheques/status.ts` + `cheque-service.ts` |
| Accounting Hub / Treasury Hub | Missing | not in `ROUTABLE_SCREENS` |
| Rule: Double-entry balanced posting → GL | Full | `gl/post.ts:126 assertBalanced` |
| Rule: Fiscal-period posting gates | Full | `assertPeriodOpen` at `gl/post.ts:159`; open→closed→locked |
| Rule: JE lifecycle draft→pending→posted→reversed | Partial | pending declared but no approve transition/route |
| Rule: Cost-center allocation + P&L | Full | `JournalLine.costCenterId`; `cost-center-pl.ts` |
| Rule: Multi-currency + FX reval gain/loss | Full | `convert.ts`; `fx-revaluation/revaluation.ts` (auto-reverse next day) |
| Rule: Trial balance over live ledger | Partial | screen on sample data; live `gl/ledger.ts:accountBalance` not wired to report |
| Rule: Vouchers → GL + invoice allocation | Full | `vouchers/voucher-service.ts:57`; `vouchers/allocation.ts` |
| Rule: Cheque 7-state + GL per transition | Full | `cheque-service.ts` (underCollection/collect/bounce/replace) |
| Rule: Bank rec (match statement↔book) | Full | `bank-reconciliation/matching.ts:suggestMatches` |
| Rule: Balance rec (subledger↔GL drift) | Full | `reconciliation/reconciliation.ts:41` |
| Rule: Numbering sequences (JE/CV/CHQ) | Full | `numbering/sequences.ts`; no-gap inside JE txn |
| Rule: Withholding tax | Partial | VAT thorough; no dedicated WHT rate type |

### 2.5 POS & Installments (catalog 05)

| Screen / Rule | Status | Evidence / Gap |
|---|---|---|
| Terminals | Missing | no domain/API/persistence/screen |
| Sessions / Shifts | Missing | — |
| POS Sales | Missing | — |
| POS Refunds | Missing | — |
| Kitchen Display | Missing | — |
| Table Management | Missing | — |
| Deliveries | Missing | — |
| Discount Approvals | Missing | — |
| Reservations | Missing | — |
| Shift Settings | Missing | — |
| POS Selling Screen `/pos/sell` | Missing | NA on web even in reference (mobile/desktop only) |
| POS Hub | Missing | — |
| Installment Plans | Full | `screens/InstallmentPlansScreen.tsx`; `domain/installments/*`; `installment-plan-store.ts` |
| Collection Follow-ups | Full | `screens/InstallmentFollowUpsScreen.tsx`; `follow-up-store.ts` |
| Rule: POS session cash reconciliation | Missing | — |
| Rule: POS sale → GL + stock-out at WAC + payment | Missing | — |
| Rule: POS refund / discount-approval workflow | Missing | — |
| Rule: Restaurant (kitchen/tables/reservations/deliveries) | Missing | — |
| Rule: Installment schedule generation | Full | `installments/schedule.ts` (down payment, tenor, even split via `allocate`) |
| Rule: Overdue tracking | Full | `installments/overdue.ts` |
| Rule: Collection posting via Treasury voucher | Full (by design) | plan posts nothing to GL; collection is a voucher concern (`installment-plan-document.ts:4-7`) |
| Rule: Late-fee computation | Partial (parity) | explicit stub returning zero — the reference also leaves late-fee config unbuilt (catalog 05) |

### 2.6 CRM & HR (catalog 06)

| Screen / Rule | Status | Evidence / Gap |
|---|---|---|
| Leads | Full | `screens/LeadsScreen.tsx`; `crm/lead.ts` |
| Opportunities | Full | `screens/OpportunitiesScreen.tsx`; `crm/opportunity.ts` |
| Sales Pipeline (kanban) | Full | `screens/PipelineScreen.tsx` |
| Pipeline Stages | Full | `screens/PipelineStagesScreen.tsx`; `crm/pipeline-stage.ts` |
| CRM Activities / My Tasks | Full | `screens/ActivitiesScreen.tsx`; `crm/activity.ts` (first-class nav item — improvement over spec) |
| CRM Hub | Missing | no `/crm/hub` landing |
| HR Dashboard, Employees, Departments, Job Titles, Attendance, Holidays, Contracts, Leave Requests, Payroll, Advances, Leave Policies, Leave Accrual Batches, My Leave | Missing (all 13) | no `hr` domain/routes/store/schema/screens; only `hr.*` permission scaffolding |
| Rule: Lead status machine + lead→customer/opportunity conversion | Full | `crm/transition-lead.ts`; `crm/convert-lead.ts`; routes `crm-routes.ts:186/202` |
| Rule: Opportunity win/loss auto-close | Full | `crm/move-opportunity-stage.ts:12` |
| Rule: Pipeline stages config/reorder + kanban | Full | `crm/pipeline-stage.ts`; `crm-routes.ts:294/298/323` |
| Rule: CRM activity lifecycle | Full | `crm/activity.ts`; `crm-routes.ts:342-382` |
| Rule: HR employees/contracts/org | Missing | — |
| Rule: Attendance | Missing | — |
| Rule: Leave policies/requests/approval/accrual/balances | Missing | — |
| Rule: Payroll (calc/deductions/GL posting) | Missing | — |
| Rule: Employee advances | Missing | — |
| Rule: Official holidays | Missing | — |

### 2.7 Manufacturing, Projects, Assets, Field (catalog 07)

| Screen / Rule | Status | Evidence / Gap |
|---|---|---|
| Production Dashboard | Partial | `GET /dashboard` (`manufacturing-routes.ts:662`) exists; no UI screen |
| Work Orders | Full | `screens/WorkOrdersScreen.tsx`; `manufacturing/work-order.ts` (full stage machine) |
| BOMs | Full | `screens/BomsScreen.tsx`; `manufacturing/bom.ts` |
| Config Instances | Full | `screens/ConfigInstancesScreen.tsx`; `manufacturing/config-instance.ts` |
| Make-vs-Buy report | Missing | no `makeVsBuy` anywhere |
| Projects | Partial | `screens/ProjectsScreen.tsx`; `projects/project.ts` — budget + auto `PRJ-` cost center only; no cost/revenue rollup or doc linkage |
| Asset Register | Full | `screens/AssetRegisterScreen.tsx`; `fixed-assets/create-asset.ts` |
| Depreciation Runs | Full | `screens/DepreciationRunsScreen.tsx`; `post-depreciation-run.ts` |
| Asset Categories | Full | `screens/AssetCategoriesScreen.tsx`; `fixed-assets/asset-category.ts` |
| Van/Rep Trips | Full | (see Sales 2.1) |
| Assets Hub | Missing | no hub screen |
| Rule: WO BOM consumption / FG stock-in at rolled cost / WIP | Full | `work-order.ts` issue/receive/complete; `buildWorkOrderGlPosting:558` |
| Rule: Configurable products / formula resolution | Full | `configurable-product.ts`; `config-instance.ts`; `formula.ts` |
| Rule: Straight-line depreciation + category-driven GL | Full | `depreciation.ts`; `post-depreciation-run.ts:87` (Dr expense/Cr accum) |
| Rule: Projects cost/revenue + doc linkage | Partial | cost-center hook only; no aggregation/linkage |

### 2.8 Reports (catalog 08 — 33 reports)

**19 full · 1 partial · 13 missing.** Full: Sales by Period/Item/Customer, Top Products;
Purchases by Period/Supplier/Item; Inventory Stock Levels/Movement/Ledger/Valuation/Aging/
Slow-Moving/Drift; Customer & Supplier Aging; Installments Overview & Overdue; Trial
Balance; Cost-Center P&L (all in `domain/reports/*` + `report-*` routable keys).
Partial: Promotions Report (backend stub). **Missing (13):** Sales-by-Salesperson, Van
Sales, Expiring-Soon (FEFO), Make-vs-Buy, POS Daily Summary, POS Shift Reports, Income
Statement, Balance Sheet, Cash Flow, VAT Return, General Ledger report, Account Ledger
statement (plus Promotions Report as the partial). The `/accounting/reports` 7-tab page is
1 of 7 tabs implemented.

### 2.9 Settings, Dashboard, Global UX, Cross-cutting (catalog 09)

| Screen / Rule | Status | Evidence / Gap |
|---|---|---|
| General (tabbed) `/settings` | Partial | `settings/SettingsGeneral.tsx` (`get/put /` only); spec's 10 tabs likely a subset |
| Data Migration `/settings/data-migration` | Partial | backend real (`historical-import-routes.ts` + store); web only first-run wizard |
| Users | Full | `pages/UsersPage.tsx`; `users/save-user.ts`; `users-routes.ts` |
| Roles & Permissions (+matrix) | Full | `pages/RolesPage.tsx`+`RoleEditorPage.tsx`; `permissions/catalog.ts`; `roles-routes.ts` |
| Branches | Full | `settings/BranchesPage.tsx` |
| Warehouses | Full | `settings/WarehousesPage.tsx` |
| Print Templates `/settings/print` | Full | `settings/PrintTemplatesPage.tsx` |
| Dashboard home `/` | Full | `dashboard/DashboardScreen.tsx` |
| Shift Settings `/settings/shifts` | Missing | no screen/domain/API |
| Workflow/Approvals config `/settings/workflow` | Partial | engine `workflow/gate.ts` used on docs; no config screen/route |
| Notification Rules `/notifications/rules` | Missing | no engine (only `events/` bus) |
| Barcode `/settings/barcode` | Missing | — |
| Numbering Sequences `/settings/sequences` | Partial | engine + store real; no config screen/API |
| Leave Policies `/settings/leave-policies` | Missing | HR-owned, absent |
| Global UX (audit log viewer, approvals inbox, command palette) | Partial | audit backend real (`audit/*`, `audit-sink.ts`); no audit web viewer |
| Profile `/settings/profile` | Missing | — |
| API Keys `/settings/api-keys` | Missing | — |
| Webhooks `/settings/webhooks` | Missing | — |
| WhatsApp `/settings/whatsapp` | Missing | — |
| Rule: Permissions catalog (~268) | Full | `permissions/catalog.ts` → **270 codes** (parity) |
| Rule: Role dependency cascade + sensitive flag | Full | `role-editor.ts`, `resolve.ts`; sensitive metadata `catalog.ts:30` |
| Rule: Module licensing / entitlements gating | Full | `entitlements/*`, `licensing/license.ts`, `permissions/module-licensing.ts`, `api/module-gate.ts` |
| Rule: API permission gate | Full | `api/permission-gate.ts` |
| Rule: Company-admin `"*"` bypass | Full | `permissions/auth-context.ts:57`; `catalog.ts:415` |
| Rule: Branch/warehouse scoping on users | Full | `users/user.ts:27-28`; `save-user.ts` |
| Rule: Numbering sequences engine | Full | `numbering/next-number.ts` + `sequences.ts` |
| Rule: Workflow/approvals engine | Full | `workflow/gate.ts` (state machine, resubmit) |
| Rule: Audit log | Partial | domain + sqlite sink real; no read API / viewer |
| Rule: Notification rules engine | Missing | — |
| Rule: Financial statements generation | Missing | — |
| Rule: Data migration / historical import | Full (backend) | `historical-import-routes.ts` + store |

---

## 3. What is genuinely strong (parity ≥ Full)

- **Costing / stock ledger:** WAC, immutable integer cost layers, negative-stock gate,
  multi-warehouse separation, landed-cost revaluation, WO WIP capitalization.
- **GL core:** balanced double-entry posting, fiscal-period gates, header-account
  non-postable enforcement, atomic no-gap numbering inside the posting txn.
- **Document GL/stock hooks:** sales invoice (4-leg), purchase invoice, both returns,
  goods receipt, work order, depreciation run all post correct entries.
- **Treasury:** 10 voucher types with GL + reversible partial allocation; 7-state cheque
  lifecycle with per-transition GL; bank + balance reconciliation.
- **Authorization/licensing:** 270-code permission catalog, dependency cascade, sensitive
  flag, module entitlement gating, API permission gate, company-admin bypass, user scoping.
- **CRM:** full lead→opportunity→conversion + pipeline/kanban + activity lifecycle.
- **Fixed assets & manufacturing:** straight-line depreciation with category-driven
  accounts; BOM/work-order/config-instance chain.

---

## 4. Recommendation summary

To reach ~90% parity, in priority order: (1) build the **financial-statement report
family** (P&L, Balance Sheet, Cash Flow, VAT Return, GL & Account Ledger) on the live
ledger — highest value, engine foundations already exist; (2) wire the **5 accounting-depth
screens** off the in-browser store onto the real API; (3) build the **inventory operational
UIs** (Stock Balance/Transfers/Adjustments list+screen, Physical Counts engine); (4) apply
**promotions & price lists** to real documents and add **withholding tax**; (5) wire the
**JE pending-approval** transition to the existing workflow engine; (6) build out the
**settings config screens** (sequences, workflow, audit viewer, data migration); then the
large net-new domains **POS** and **HR** (each effectively greenfield). Domain **hubs** are
lowest priority (reference leaves them unlinked).
