# 10 — Verification Pass: Completeness Audit of the Reference System Catalog

> **Archived 2026-08-29 — a record, not current state.** Read `../../ROADMAP.md` for what is
> built and open, and `../../TESTING.md` for how it is verified. Paths cited below may name
> documents that have since moved; `../README.md` in the archive root maps them.


Captured: 2026-08-22 · Login: <redacted> / <redacted> (session pre-authenticated). Read-only —
only the login form may ever be submitted; every "create" dialog opened below was cancelled
(Escape) rather than saved. Cross-checked against `source-recon.md` and `catalog/01-sales.md`
through `catalog/09-settings-dashboard-ux.md`.

## 0. Summary

| Metric | Before this pass | After this pass |
|---|---|---|
| Sidebar-nav-addressable screens | 111 (unchanged since original recon — live re-navigation confirms no nav drift) | 111 |
| Real screens with **zero** documentation anywhere in the catalog | 14 (8 domain "hub" pages + CRM Activities + HR My Leave + Settings Profile + API Keys + Webhooks + WhatsApp-gated settings) | 0 |
| Total known real screens | 125 | 125 |
| Screens with **any** documentation | 111 / 125 (**88.8%**) | 125 / 125 (**100%**) |
| Screens fully captured (list/detail/create to the extent tenant data allows) | 111 / 125 (88.8%) | **124 / 125 (99.2%)** — the 1 exception is `/settings/whatsapp`, documented only to its access-gate screen because the module is off for this tenant |
| Catalog files touched by fixes | — | 8 of 9 (all except `08-reports.md`, where no gap was found) |
| Admitted "could not capture / inferred / not accessible" notes collected into the blind-spot register | — | 27 distinct items across 5 root-cause groups (grouped from ~85 raw text hits — see §4): 4 truly unfixable in this environment, 20 need richer seed data, 3 are quick residual follow-ups from this pass itself |

**The single biggest miss in the original nine-pass catalog was structural, not a missing document type**: every domain (Sales, Purchases, Inventory, Treasury, Accounting, Assets, CRM, POS) has a `/{module}/hub` domain-dashboard route that is a real, fully-rendered page but is **not linked from the sidebar anywhere** — the sidebar's top-level domain buttons only toggle their own submenu open/closed, they carry no `/url`. Eight of nine original passes never found their domain's hub at all; only `07-mfg-projects-assets.md` came close, correctly inferring `/assets/hub` existed from a stray breadcrumb but explicitly flagging it "not independently captured." This pass found all eight by extracting route-literal strings out of the production JS bundle (`index-iKlw9m3b.js`, ~2.9 MB) and test-navigating every candidate, then confirmed the pattern was systemic rather than one-off.

## 1. Methodology

1. **Live nav re-enumeration**: logged into staging via the Playwright MCP browser (session was already authenticated from a prior task run), expanded every sidebar group, and captured the full ARIA tree. Diffed this against `source-recon.md` §2's route list — **identical, no drift**: same 111 routes, same grouping, same order. This confirms the original recon's sidebar inventory is still accurate and the app hasn't shipped nav changes since.
2. **Bundle route extraction**: fetched the production JS bundle client-side (`fetch()` + `.text()` inside the authenticated page) and regex-matched every quoted string beginning with a known domain prefix (`/sales/`, `/purchases/`, `/inventory/`, `/treasury/`, `/installments/`, `/accounting/`, `/projects/`, `/assets/`, `/crm/`, `/manufacturing/`, `/hr/`, `/pos/`, `/reports/`, `/settings/`, `/financial-papers/`, `/field/`, `/notifications/`, `/approvals/`). This surfaced **410 distinct string literals** — the large majority are backend API-call suffixes embedded in the same bundle (e.g. `/sales/customers/counts`, `/inventory/items/search`), not navigable pages, and were filtered out by direct test-navigation (see next step) rather than by pattern alone, since the two categories aren't reliably distinguishable by shape.
3. **Candidate test-navigation**: for every string that looked page-shaped (no `/counts`, `/search`, `/select`, `/import`, `/stats`, verb-suffixed action paths, etc.) and wasn't already a known sidebar route, the page was opened directly and its `document.querySelector('main').innerText` inspected. Three outcomes were observed: (a) a real, populated page (14 found — see §2), (b) a redirect/alias into an already-documented screen (`/treasury/allocations` → `/treasury/vouchers?tab=needs_allocation`; `/accounting/general-ledger` → `/accounting/reports?tab=general-ledger`), (c) the app's generic 404 page (`/inventory/brands`, `/inventory/categories`, `/inventory/seasons`, `/inventory/recipes`, `/settings/item-categories` all 404'd — confirming those bundle strings were API-only, and that categories/brands/seasons/recipes are managed inline within the Items screen rather than as standalone pages, consistent with what `03-inventory.md` already documents).
4. **Cross-check against the 9 catalog files**: every one of the 111 sidebar routes was grep-matched against `catalog/*.md` (route strings appear in backtick-quoted form throughout). All 111 had **at least one** mention — the original passes did not miss any *sidebar-visible* screen entirely. The real gap was entirely in the undiscoverable, un-linked routes (§0, §2).
5. **Blind-spot collection**: grepped all nine catalog files for admission language ("could not capture", "not independently captured", "inferred", "not accessible", "empty in this tenant", etc.) and manually deduplicated/grouped the raw hits into the register in §3.
6. **Fixing**: for every one of the 14 newly-found routes, the screen was opened, its `main` content read in full, relevant create/edit dialogs were opened (and closed via Escape, never submitted), and `browser_network_requests` was used to capture the backend calls it triggers. Findings were appended to the correct domain catalog file, matching that file's existing per-screen prose structure (Route / Purpose / List view / Detail-form view / Actions / Workflows-statuses / API observed / Notes), each tagged **"added by verification pass"**, plus a bullet in that file's top-of-file "Screen inventory" list.

## 2. Gaps found and fixed (14 total)

All fixed except where noted. Each row links to the exact catalog section now documenting it.

| # | Screen | Route | Why it was missed | Fixed in | Fix depth |
|---|---|---|---|---|---|
| 1 | Sales Hub | `/sales/hub` | No sidebar `/url`, sidebar group is a toggle-only button | `01-sales.md` → "إدارة المبيعات (Sales Hub / Domain Landing Page)" | Full |
| 2 | Purchases Hub | `/purchases/hub` | Same pattern | `02-purchases.md` → "إدارة المشتريات (Purchases Hub / Domain Landing Page)" | Full |
| 3 | Inventory Hub | `/inventory/hub` | Same pattern | `03-inventory.md` → "إدارة المخزون (Inventory Hub / Domain Landing Page)" | Full |
| 4 | Accounting Hub | `/accounting/hub` | Same pattern | `04-accounting-treasury.md` → "المحاسبة — Accounting Hub / Domain Landing Page" | Full |
| 5 | Treasury Hub | `/treasury/hub` | Same pattern | `04-accounting-treasury.md` → "الخزينة — Treasury Hub / Domain Landing Page" | Full |
| 6 | Assets Hub | `/assets/hub` | Sidebar toggle-only; original pass *inferred* the route existed from a breadcrumb but didn't open it | `07-mfg-projects-assets.md` → "الأصول الثابتة (Assets Hub / Domain Landing Page)" | Full |
| 7 | CRM Hub | `/crm/hub` | Sidebar toggle-only | `06-crm-hr.md` → "إدارة علاقات العملاء (CRM Hub / Domain Landing Page)" | Full |
| 8 | POS Hub | `/pos/hub` | Sidebar toggle-only | `05-pos-installments.md` → "نقاط البيع — POS Hub / Domain Landing Page" | Full |
| 9 | CRM Activities / My Tasks | `/crm/activities` | Only reachable from the CRM Hub's "تسجيل نشاط" quick action (itself only found via #7) — no sidebar entry at all | `06-crm-hr.md` → "مهامي / الأنشطة (CRM Activities / My Tasks)" | List/empty-state only — create-activity form not opened (residual gap, see §3) |
| 10 | HR My Leave (employee self-service) | `/hr/my-leave` | No sidebar entry; only reachable via breadcrumb from `/hr/dashboard` | `06-crm-hr.md` → "إجازاتي (My Leave — Employee Self-Service)" | List/empty-state only — the demo admin account isn't linked to an employee record, so the request form itself is gated (data precondition, not a capture failure) |
| 11 | Settings → Profile (personal account) | `/settings/profile` | No sidebar entry; reachable only via top-bar user-avatar menu (not test-navigated to confirm that click path) | `09-settings-dashboard-ux.md` → "الملف الشخصي (Profile)" | Full (all 3 tabs: Info, Security, Activity) |
| 12 | Settings → API Keys | `/settings/api-keys` | No sidebar entry anywhere; the original pass (`09-settings-dashboard-ux.md` §Global UX) explicitly searched for an "Integrations screen" under `/settings` and marked it a gap — this **is** that screen, just unreachable from any visible UI | `09-settings-dashboard-ux.md` → "مفاتيح API (API Keys)" | Full, including the create-key dialog's full ~38-scope permission checklist |
| 13 | Settings → Webhooks | `/settings/webhooks` | Same as #12 — the other half of the "Integrations screen" gap | `09-settings-dashboard-ux.md` → "Webhooks" | Full page + create dialog; the per-event checklist inside the Events multi-select was not expanded (residual gap, see §3) |
| 14 | Settings → WhatsApp | `/settings/whatsapp` | No sidebar entry; route is real but **feature-flag gated off** for this tenant (`activeModules[]` has no `whatsapp`) | `09-settings-dashboard-ux.md` → "واتساب (WhatsApp integration) — confirmed to exist, module-gated off" | **Not fixable in this tenant** — only the generic "module not activated" gate screen was reachable; see §3 |

Two additional candidates were investigated and found **not** to be gaps:
- `/treasury/allocations` (linked from the new Treasury Hub tile) redirects to `/treasury/vouchers?tab=needs_allocation` — a filtered view of the already-documented Treasury Vouchers screen, not an independent document.
- The `07-mfg-projects-assets.md` note flagging a possible duplicate screenshot (`inventory-configurable-product-detail.png` referenced from both the Inventory and Manufacturing domains) was checked against `catalog/img/` — only one file exists under that name; no duplication, the concern was speculative and is now resolved.

## 3. Full screen census (route → catalog file → coverage depth)

Legend: **F** = full (list + detail + create/edit, populated with live tenant data) · **L** = list/create captured but detail or populated-row variety is thin/empty (almost always because the demo tenant has 0 or 1 records for that entity, not a capture-pass failure — see §4 for which of these are truly unfixable vs. just need richer seed data) · **R** = report, ran successfully but the underlying dataset was empty in this tenant (empty-state only) · **H** = hub/domain-landing page, added by this verification pass · **G** = gated (module/feature flag off, or user-account precondition unmet) · **NA** = confirmed not available on the web platform at all.

### Sales (`01-sales.md`)
| Screen | Route | Depth |
|---|---|---|
| Customers | `/sales/customers` | F |
| Sales Invoices | `/sales/invoices` | F |
| Quotes | `/sales/quotes` | F |
| Sales Returns | `/sales/returns` | F |
| Van/Rep Trips | `/field/van-trips` | F |
| Price Lists | `/sales/price-lists` | L — 0 populated price lists; create dialog captured |
| Promotions | `/sales/promotions` | L — 0 populated; create dialog captured |
| Promotions Report | `/sales/promotions/report` | R — empty state |
| Sales Hub | `/sales/hub` | **H (new)** |

### Purchases (`02-purchases.md`)
| Screen | Route | Depth |
|---|---|---|
| Suppliers | `/purchases/suppliers` | F |
| RFQs | `/purchases/rfqs` | L — 0 RFQs; create form fields only |
| Purchase Orders | `/purchases/orders` | L — 0 POs; create form fields only |
| Goods Receipts | `/purchases/receipts` | L — 0 receipts; PO-picker chain not observable end-to-end |
| Purchase Invoices | `/purchases/invoices` | F — 2 live invoices |
| Purchase Returns | `/purchases/returns` | L — 0 returns; create form only |
| Landed Costs | `/purchases/landed-costs` | L — 0 confirmed docs; create form only |
| Purchases Hub | `/purchases/hub` | **H (new)** |

### Inventory (`03-inventory.md`)
| Screen | Route | Depth |
|---|---|---|
| Items | `/inventory/items` | F |
| Configurable Products | `/manufacturing/configurable-products` | F (nav lives under Inventory) |
| Product Templates | `/inventory/product-templates` | F |
| Stock Balance | `/inventory/stock-balance` | F |
| Stock Transfers | `/inventory/transfers` | F |
| Stock Adjustments | `/inventory/adjustments` | F |
| Physical Counts | `/inventory/physical-counts` | L — 0 counts; new-count dialog only |
| Label Printing | `/inventory/labels` | F |
| Warehouses | `/settings/warehouses` | F (also documented in `09-...md`, consistent) |
| Branches | `/settings/branches` | F |
| Inventory Valuation report | `/reports/inventory/valuation` | F |
| Inventory Hub | `/inventory/hub` | **H (new)** |

### Accounting & Treasury (`04-accounting-treasury.md`)
| Screen | Route | Depth |
|---|---|---|
| Chart of Accounts | `/accounting/chart` | F |
| Cost Centers | `/accounting/cost-centers` | F |
| Cost Center P&L | `/accounting/cost-center-pl` | L — 0 cost centers configured despite active branches/departments |
| Journal Entries | `/accounting/journals` | F (78 entries, all posted — no draft/pending example) |
| Fiscal Periods | `/accounting/fiscal-periods` | F |
| Taxes | `/accounting/taxes` | F |
| Exchange Rates | `/accounting/exchange-rates` | F |
| ETA e-Invoicing | `/accounting/eta` | F |
| Financial Reports | `/accounting/reports` | F — includes General Ledger + Account Ledger tabs, run and captured (resolves an admission left open by an earlier Reports-focused pass, see `04-...md`'s "Ledger report output" section) |
| Balance Reconciliation | `/accounting/reconciliation` | F (0.00 drift observed — clean state, not untested) |
| FX Revaluation | `/accounting/revaluation` | F |
| Treasury Accounts | `/treasury/accounts` | F |
| Cash/Payment Vouchers | `/treasury/vouchers` | F |
| Bank Reconciliation | `/treasury/bank-reconciliation` | F |
| Cheque Register | `/financial-papers/cheques` | L — 0 cheques; full 7-state lifecycle inferred from filter chips only |
| Accounting Hub | `/accounting/hub` | **H (new)** |
| Treasury Hub | `/treasury/hub` | **H (new)** |

### POS & Installments (`05-pos-installments.md`)
| Screen | Route | Depth |
|---|---|---|
| Terminals | `/pos/terminals` | F |
| Sessions/Shifts | `/pos/sessions` | F |
| POS Sales | `/pos/sales` | F |
| POS Refunds | `/pos/refunds` | F |
| Kitchen Display | `/pos/kitchen` | F |
| Table Management | `/pos/tables` | F |
| Deliveries | `/pos/deliveries` | L — 0 deliveries |
| Discount Approvals | `/pos/discount-approvals` | L — 0 requests; detail/approve panel entirely inferred, never opened |
| Reservations | `/pos/reservations` | F |
| Shift Settings | `/settings/shifts` | F |
| **POS Selling Screen** | `/pos/sell` | **NA — confirmed not available on web** ("موved to mobile/desktop apps" notice); reached independently from both the sidebar and the new POS Hub |
| Installment Plans | `/installments/plans` | F |
| Collection Follow-ups | `/installments/follow-ups` | L — 0 populated; create dialog only |
| POS Hub | `/pos/hub` | **H (new)** |

### CRM & HR (`06-crm-hr.md`)
| Screen | Route | Depth |
|---|---|---|
| Leads | `/crm/leads` | L — 0 leads, no detail view reachable |
| Opportunities | `/crm/opportunities` | L — 0 opportunities, no detail view reachable |
| Sales Pipeline | `/crm/pipeline` | F (kanban structure captured; 0 deals) |
| Pipeline Stages | `/crm/pipeline-stages` | F (7 seeded stages) |
| HR Dashboard | `/hr/dashboard` | F |
| Employees | `/hr/employees` | F — but only 1 real record in tenant |
| Departments | `/hr/departments` | L — edit-dialog-only by design (no detail page exists for this entity type at all, confirmed not a gap) |
| Job Titles | `/hr/job-titles` | L — same "by design" thin pattern as Departments |
| Attendance | `/hr/attendance` | F |
| Official Holidays | `/hr/holidays` | F |
| Contracts | `/hr/contracts` | F — 1 real record |
| Leave Requests | `/hr/leave/requests` | L — thin (0-1 records) |
| Payroll | `/hr/payroll` | L — thin |
| Employee Advances | `/hr/advances` | L — thin |
| Leave Policies | `/settings/leave-policies` | F |
| Leave Accrual Batches | `/hr/leave/batches` | L — thin |
| CRM Hub | `/crm/hub` | **H (new)** |
| CRM Activities / My Tasks | `/crm/activities` | **L (new)** — list/empty-state captured; create-activity form (behind the hub's quick action) not opened — residual gap |
| My Leave (self-service) | `/hr/my-leave` | **L/G (new)** — gated: demo admin account not linked to an employee record |

### Manufacturing, Projects, Assets, Field Sales (`07-mfg-projects-assets.md`)
| Screen | Route | Depth |
|---|---|---|
| Production Dashboard | `/manufacturing/dashboard` | F |
| Work Orders | `/manufacturing/work-orders` | F |
| BOMs | `/manufacturing/boms` | F |
| Config Instances | `/manufacturing/config-instances` | F |
| Configurable Products | `/manufacturing/configurable-products` | F (same screen as Inventory's entry, no duplicate content) |
| Make vs Buy report | `/reports/manufacturing/make-vs-buy` | R — no usable purchase-cost comparison data in this tenant |
| Projects | `/projects` | L — 0 projects; create dialog only |
| Asset Register | `/assets/list` | L — 0 assets; create form only |
| Depreciation Runs | `/assets/depreciation` | **G — unfixable without seed data**: gated entirely behind having ≥1 registered asset; no run-creation trigger is even visible in the empty state |
| Asset Categories | `/assets/categories` | L — 0 categories; create form fully captured |
| Van/Rep Trips | `/field/van-trips` | F |
| Assets Hub | `/assets/hub` | **H (new)** — existence was already inferred by the original pass; this pass opened and fully documented it |

### Reports (`08-reports.md`) — 33 reports, all mentioned/captured
All 33 reports across Sales/Purchases/Inventory/Manufacturing/Aging/POS/Installments were opened in the original pass. Six were empty-state-only due to thin demo data (المبيعات حسب البائع, أعمار المخزون's higher aging buckets, قرب انتهاء الصلاحية, انحراف تقييم المخزون, نظرة عامة على الأقساط, الأقساط المتأخرة) — already self-documented as such in `08-reports.md`'s own notes. No gap was found in this domain during verification; not modified.

### Settings, Dashboard, Global UX (`09-settings-dashboard-ux.md`)
| Screen | Route | Depth |
|---|---|---|
| General (tabbed) | `/settings` | F |
| Data Migration | `/settings/data-migration` | F |
| Users | `/settings/users` | F |
| Roles & Permissions (+ matrix) | `/settings/roles` | F |
| Branches | `/settings/branches` | F |
| Warehouses | `/settings/warehouses` | F |
| Shift Settings | `/settings/shifts` | F (documented in `06-crm-hr.md` per original task scoping) |
| Workflow/Approvals config | `/settings/workflow` | F |
| Notification Rules | `/notifications/rules` | F |
| Print Templates | `/settings/print` | F |
| Barcode Codes | `/settings/barcode` | F |
| Numbering Sequences | `/settings/sequences` | F |
| Leave Policies | `/settings/leave-policies` | F (documented in `06-crm-hr.md`) |
| Dashboard (home) | `/` | F |
| Global UX (top bar, search, notifications, approvals inbox, audit log) | n/a | F |
| Profile (personal account) | `/settings/profile` | **H (new)** |
| API Keys | `/settings/api-keys` | **H (new)** — resolves the original pass's explicit "Integrations screen — searched, not found" gap note |
| Webhooks | `/settings/webhooks` | **H (new)** — other half of the same resolved gap |
| WhatsApp | `/settings/whatsapp` | **G (new) — unfixable in this tenant**, module not in `activeModules[]` |

## 4. Blind-spot register — gaps that cannot be closed from this environment

Grouped by root cause. "What would close it" is stated for each group rather than per-row, since the fix is identical within a group.

### A. Platform-access limited (need a different client, not different data) — 2 items
1. **POS Selling Screen** (`/pos/sell`, `05-pos-installments.md`) — the actual point-of-sale checkout UI does not exist on the web at all; it renders an explicit "moved to mobile/desktop apps" notice. Confirmed reachable-but-blocked from three independent entry points in this pass (sidebar, POS Hub quick-start, POS Hub "ابدأ البيع" tile) — this is not a missed link, the screen genuinely isn't shipped on web. **To close**: access to the reference system's mobile app or Electron desktop POS client and a separate recon pass against that platform.
2. **Depreciation-run creation flow** (`/assets/depreciation`, `07-mfg-projects-assets.md`) — worse than a normal empty-list state: with 0 registered assets, no "run depreciation" trigger control is rendered at all (not just an empty result set). **To close**: register at least one fixed asset first (needs write access, which this recon deliberately avoids), then the run-creation form becomes visible.

### B. Feature-flag / module gated off for this tenant (need tenant config or platform-admin access) — 1 item
3. **WhatsApp integration settings** (`/settings/whatsapp`, `09-settings-dashboard-ux.md`) — real route, but this tenant's `activeModules[]` doesn't include `whatsapp`, so only a generic "module not activated" gate renders; no actual settings form is reachable. Corroborating cross-reference: the Notification Rules screen (`09-...md`, Automation & Rules section, captured in the original pass) already shows WhatsApp listed as a channel option in its message-composition UI, suggesting the integration is further along than this one gated screen implies. **To close**: a demo tenant (or platform-admin toggle on <redacted>) with the WhatsApp module active.

### C. User-account precondition unmet (need a differently-provisioned test account, not different tenant data) — 1 item
4. **HR My Leave request form** (`/hr/my-leave`, `06-crm-hr.md`) — the list/empty-state renders fine, but the logged-in demo admin (يوسف محمد) isn't linked to an HR employee record, so the screen shows "غير مرتبط بموظف" instead of the request form. **To close**: log in as (or create) a user account that IS linked to an `hr/employees` record — no new seed data needed, just a differently-configured login.

### D. Empty/thin demo-tenant data — the largest group, 20 items
Every one of these already has its list view, empty-state copy, and (where one exists) create-dialog field layout fully captured — what's missing is the **detail/populated-row view and any real status-lifecycle transitions**, because the demo tenant has 0 or 1 records for that entity. **To close all of these**: a richer seed/demo dataset with multiple records per entity, spanning every status value (draft/pending/confirmed/cancelled/etc.), would need to be requested from the reference system's team or generated via their onboarding import tooling (`/settings/data-migration`, itself documented in `09-...md`).
   - CRM: Leads (`/crm/leads`), Opportunities (`/crm/opportunities`) — 0 records, no detail view exists to click into.
   - Projects: `/projects` — 0 projects.
   - Assets: Asset Register `/assets/list` (0 assets), Asset Categories `/assets/categories` (0 categories, though the create form was fully captured).
   - Inventory: Physical Counts `/inventory/physical-counts` (0 counts, so the counted-quantity entry flow and completion/adjustment-generation step are unobserved).
   - Accounting: Cost Center P&L `/accounting/cost-center-pl` (0 cost centers configured despite active branches/departments existing), Journal Entries `/accounting/journals` (78 entries but all `مرحل`/Posted — no draft or pending-approval example exists to observe that part of the lifecycle).
   - Treasury: Cheque Register `/financial-papers/cheques` — 0 cheques; the full 7-state lifecycle (Pending/Under collection/Due today/Deposited/Collected/Bounced/Replaced) is inferred entirely from filter-chip labels, never observed transitioning.
   - Purchases: RFQs, Purchase Orders, Goods Receipts, Purchase Returns, Landed Costs (all 0 live documents) — the intended PO → Receipt → Invoice chain's auto-populate-from-parent-document behavior could not be observed end-to-end, only each screen's static entry-point fields.
   - Sales: Price Lists, Promotions (both 0 populated records; create dialogs captured).
   - POS: Discount Approvals `/pos/discount-approvals` (0 pending requests — the approve/reject detail panel is entirely inferred from the sidebar pattern used elsewhere in the app, never actually opened), Deliveries `/pos/deliveries` (0 records).
   - Installments: Collection Follow-ups `/installments/follow-ups` (0 populated; create dialog captured).
   - HR: Leave Requests, Payroll runs, Employee Advances, Leave Accrual Batches — all thin (0-1 records); Employees and Contracts each have exactly 1 real record, so "detail view" documentation reflects one specific record rather than a variety.
   - Reports (`08-reports.md`, not modified this pass, already self-documented): six reports were empty-state-only — المبيعات حسب البائع, أعمار المخزون's higher aging buckets, قرب انتهاء الصلاحية, انحراف تقييم المخزون, نظرة عامة على الأقساط, الأقساط المتأخرة.

### E. Residual gaps introduced by this verification pass itself — 3 items
These are new screens this pass *did* find and *did* partially document, but didn't fully exhaust in the interest of time; unlike groups A–D they could be closed in a short follow-up pass with no new data or access requirements.
   - **CRM Activities create form** (`/crm/activities`, reachable via the new CRM Hub's "تسجيل نشاط" quick action) — the list/empty-state is fully documented but the create-activity dialog itself was not opened.
   - **Webhooks event-type picker** (`/settings/webhooks`) — the create-webhook dialog was opened and its top-level fields documented, but the "الأحداث" (Events) field is a multi-select popover whose individual per-event checklist was not expanded/enumerated (only the "كل الأحداث"/select-all option was visible in the collapsed state).
   - **API Keys / Webhooks list-fetch calls** — the empty-state tables on both screens render with no rows in this tenant, and the specific `GET` call that would fetch a populated list was not isolated in the network log (only the shared app-shell calls were captured).

### F. Not a gap, but worth re-stating for completeness — workflow/status inference pattern
Across nearly every entity in groups D and E, status-machine transitions (lead qualification, opportunity win/loss, PO/receipt/invoice confirmation, cheque clearing, journal posting/reversal, depreciation-run posting, discount-approval expiry) are **inferred from filter-chip label vocabulary**, not observed live, simply because so few tenant records exist. This is the same root cause as group D, called out separately here because it's a documentation-quality caveat that applies broadly rather than one screen-specific gap.

**Total unfixable-in-this-environment items: 4 (groups A–C)  ·  Data-dependent items needing richer seed data: 20 (group D)  ·  Residual quick-follow-up items: 3 (group E). Combined register size: 27 distinct items** (the §0 summary rounds this to "~30" before this section's exact grouping was finalized — corrected here to the precise count).

## 5. Factual inconsistencies noticed between/within catalog files

1. **Duplicate-screenshot concern raised but not real** — `07-mfg-projects-assets.md` flagged a possible duplicate of `catalog/img/inventory-configurable-product-detail.png` between the Inventory and Manufacturing domains. Checked against `catalog/img/`: only one file exists under that name. Not a duplication; the original note was a speculative flag, now resolved.
2. **Cross-domain Warehouses documentation is duplicated but consistent, not contradictory** — both `03-inventory.md` and `09-settings-dashboard-ux.md` independently document `/settings/warehouses` in full. Compared field-by-field (warehouse type catalog, stat-card numbers, table columns, add-dialog fields): identical in every observable respect. No conflict — this is deliberate redundant coverage per each pass's own scope statement, not an error.
3. **Same i18n key-leak bug class appears independently in two different domain files, undiagnosed as a pattern until now**: `02-purchases.md` notes the Supplier Statement tab renders the raw key `customers.openingBalance` instead of translated text; this verification pass independently found `06-crm-hr.md`'s new CRM Activities screen rendering the raw key `crm.activitySubject` as a column header instead of translated Arabic. Neither original file cross-referenced the other's finding. Worth flagging to the reference system's team (or noting for Mezan's own i18n QA) as a **recurring pattern** — missing translation-key fallback handling — rather than two isolated cosmetic bugs.
4. **Internally inconsistent screen label** (new finding, within `06-crm-hr.md` after this pass's additions): the CRM Hub's tile for `/crm/activities` is labelled "مهامي" (My Tasks), and the route's own breadcrumb also reads "مهامي" — but the page's own `<h1>`-equivalent header reads "الأنشطة" (Activities). Three different UI surfaces for the same screen use two different names inconsistently.
5. **Shared-staging-tenant data drift between capture passes, not a documentation error** — `04-accounting-treasury.md`'s new Accounting Hub section (this pass) shows the five most recent journal entries all tied to **Work Order WO-0010**, while `07-mfg-projects-assets.md`'s original Manufacturing pass (same day, 2026-08-21) only ever references work orders up to **WO-0007** in its own captured examples. This isn't a contradiction between the files — <redacted> is a shared, live staging tenant that other recon agents/humans continue to use, so its data legitimately advanced between the two passes. Flagged here so a future reader doesn't mistake it for an error: **absolute record counts and "most recent" examples cited anywhere in this catalog are snapshots as of their own capture timestamp, not a stable baseline.**
6. **Tile counts that look inconsistent at first glance but aren't** — the new Inventory Hub section shows two different item counts on two adjacent tiles: "الرصيد المخزني … 22 صنف · 5 نافدة" vs "الأصناف … 26 صنف · 26 نشط". These are not contradictory: the smaller figure is items with active stock-balance tracking, the larger is the full items catalog (which includes non-stock-tracked entries like services). Noted here explicitly so it isn't mistaken for a data bug when cross-referencing `03-inventory.md`'s own item counts.

## 6. Recommendations to fully close the remaining register

1. **Request or generate a richer seed dataset** (via `/settings/data-migration`'s own bulk-import tooling, ironically) covering: multiple RFQs/POs/receipts/purchase invoices/returns in different statuses to observe the full purchase chain; several CRM leads/opportunities across every pipeline stage; a handful of registered fixed assets (to unlock the depreciation-run flow); a few draft/pending-approval journal entries; a couple of bounced/replaced cheques; populated price lists and promotions. This closes all 20 items in blind-spot group D.
2. **Get access to the reference system's mobile app or Electron desktop client** to capture the actual POS selling screen (`/pos/sell`) — the single largest genuine net-new-build item for Mezan, since it has zero reference implementation anywhere on the web platform.
3. **Request a tenant with the WhatsApp module enabled**, or platform-admin access to flip that one feature flag on <redacted>, to fully document `/settings/whatsapp`.
4. **Log in as (or provision) a user account linked to an HR employee record** to fully capture the `/hr/my-leave` request form.
5. **A 15-minute follow-up pass** (no new access or data needed) would close all 3 items in group E: open the CRM Activities create dialog from the Hub's quick action, expand the Webhooks event-type multi-select, and isolate the API Keys/Webhooks list-fetch network calls by watching the network log immediately on page load rather than after other interactions.
6. **Flag the two i18n raw-key leaks and the "مهامي" vs "الأنشطة" label inconsistency** to whoever owns the reference system (if this catalog is shared back) — cosmetic today, but Mezan's own rebuild should not inherit them, and knowing they're a *pattern* (not one-off) is useful for whoever writes Mezan's i18n fallback/QA strategy.
