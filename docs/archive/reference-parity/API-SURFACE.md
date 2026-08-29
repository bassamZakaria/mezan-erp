# Reference API surface

> **Archived 2026-08-29 — a record, not current state.** Read `../../ROADMAP.md` for what is
> built and open, and `../../TESTING.md` for how it is verified. Paths cited below may name
> documents that have since moved; `../README.md` in the archive root maps them.


Captured 2026-08-26 by instrumenting `fetch`/`XHR` in an authenticated session and
walking every route. **201 distinct GET endpoints** were observed (plus one
`POST /cdn-cgi/rum` telemetry beacon from the CDN, not the product).

No write endpoint was exercised. Every `POST`/`PUT`/`PATCH`/`DELETE` the product
uses is therefore **absent from this document** — the create/confirm/void contracts
must be inferred from form fields and labelled as inferred, per the audit's
read-only rule. Response *shapes* only were recorded (key names and value types);
no field values were retained.

## The three-endpoint pattern — the most important finding

Almost every list resource is served by **three** endpoints, not one:

```
GET <resource>            ?limit&page&sortBy&sortDir&…filters   → the rows
GET <resource>/counts                                           → the status-chip numbers
GET <resource>/stats                                            → the KPI-strip money
```

`/counts` appears on ~40 resources; `/stats` on the money-bearing ones (sales
invoices, quotes, returns, purchase invoices, purchase returns, treasury accounts,
HR employees). This is why the reference's chips and KPI tiles are instant and
correct regardless of pagination: **they are never derived from the loaded page of
rows.** Mezan computes both from the current page, which is why our chip counts and
KPI figures drift from the real totals on any list longer than one page.

A fourth pattern serves pickers:

```
GET <resource>/select     ?q&limit    → id + label only, for a combobox
GET <resource>/search     ?q&limit    → same, where the resource is large
```

Present on: accounting/accounts, accounting/cost-centers, branches, warehouses,
admin/roles, hr/employees, inventory/items, sales/customers, sales/price-lists,
purchases/suppliers, treasury/accounts. Every entity a form must bind to has one.
This is the contract behind "every entity field is a picker, never free text".

## Shared query contract

| Concern | Keys |
|---|---|
| Pagination | `limit`, `page` |
| Sorting | `sortBy`, `sortDir` |
| Search | `search` on lists, `q` on `/select` and `/search` |
| Report period | `dateFrom`, `dateTo`, `asOfDate`, `periodFrom`, `periodTo` |
| Report grouping | `groupBy` (day/week/month, trip/rep/van) |
| Tax presentation | `taxMode` (inc/exc) — on by-customer, by-item, top-products |
| Status filters | `status`, `statuses`, `tab`, plus boolean flags (`open`, `overdue`, `unallocated`, `lowStock`, `outOfStock`, `isActive`, `hideGenerated`) |

## Endpoints by domain

### Accounting
```
accounting/accounts                     ?limit
accounting/accounts/counts
accounting/accounts/select              ?q&limit
accounting/chart-of-accounts
accounting/cost-centers                 ?limit&page
accounting/cost-centers/counts
accounting/cost-centers/importable-departments
accounting/cost-centers/select          ?q&limit
accounting/fiscal-periods               ?fiscalYear&status&limit&page
accounting/fiscal-periods/check-date    ?date
accounting/fiscal-periods/counts
accounting/journal-entries              ?sourceDocumentType&sortBy&sortDir&limit&page
accounting/journal-entries/counts
accounting/reconciliation/summary
accounting/reconciliation/unassigned-control-lines
accounting/tax-groups
accounting/tax-rates                    ?search&status&limit&page
accounting/tax-rates/counts
exchange-rates                          ?sortBy&sortDir&limit&page
exchange-rates/counts
```

### Financial statements
```
accounting/reports/trial-balance        ?asOfDate
accounting/reports/balance-sheet        ?asOfDate
accounting/reports/income-statement     ?periodFrom&periodTo
accounting/reports/cash-flow            ?periodFrom&periodTo
accounting/reports/cost-center-pl       ?periodFrom&periodTo
accounting/vat-return                   ?periodFrom&periodTo
```

### ETA e-invoicing
```
accounting/eta/health
accounting/eta/readiness
accounting/eta/credentials
accounting/eta/documents                ?tab&limit&page
accounting/eta/documents/counts
accounting/eta/uom-mappings
accounting/eta/catalogs/activity-codes  ?q&limit
accounting/eta/catalogs/tax-subtypes    ?taxType
accounting/eta/catalogs/unit-types
```
Nine endpoints back the five ETA tabs Mezan does not have. `readiness` and `health`
are pre-flight checks — the product tells the user whether it *can* submit before
they try.

### Sales
```
sales/customers                         ?search&limit&page
sales/customers/counts
sales/customers/search                  ?q&limit
sales/customers/balance-by-currency
sales/invoices                          ?status&source&open&overdue&search&limit&page
sales/invoices/counts
sales/invoices/stats
sales/quotes                            ?status&expiringBefore&limit&page
sales/quotes/counts
sales/quotes/stats
sales/returns                           ?limit&page
sales/returns/counts
sales/returns/stats
sales/price-lists                       ?limit
sales/price-lists/:id
sales/price-lists/search                ?limit
sales/price-resolve/active-list         ?branchId
sales/promotions                        ?sortDir&limit&page
sales/promotions/counts
sales/promotions/report                 ?dateFrom&dateTo
field/van-trips                         ?limit&page
field/van-trips/counts
```
`sales/invoices?source=` confirms invoices carry a provenance dimension (manual vs
converted from quote vs van vs POS). `price-resolve/active-list?branchId` is a
first-class endpoint: the active price list is resolved per branch, server-side.
`customers/balance-by-currency` means receivables are tracked per currency, not
collapsed to base.

### Purchases
```
purchases/suppliers                     ?limit&page
purchases/suppliers/counts
purchases/suppliers/search              ?q&limit
purchases/suppliers/balance-by-currency
purchases/invoices                      ?limit&page
purchases/invoices/counts
purchases/invoices/stats
purchases/orders                        ?limit&page
purchases/orders/counts
purchases/receipts                      ?limit&page
purchases/receipts/counts
purchases/returns                       ?limit&page
purchases/returns/counts
purchases/returns/stats
purchases/rfqs                          ?sortDir&limit&page
purchases/rfqs/counts
purchases/landed-costs                  ?limit&page
purchases/landed-costs/counts
```

### Inventory
```
inventory/items                         ?search&type&isActive&lowStock&outOfStock&hideGenerated&specValueIds&limit&page
inventory/items/counts
inventory/items/search                  ?q&forSale&limit
inventory/items/base-uoms
inventory/categories
inventory/brands
inventory/seasons
inventory/specifications
inventory/product-templates             ?isActive&limit&page
inventory/stock/counts
inventory/stock/overview                ?status&limit&page
inventory/stock/ledger                  ?direction&limit&page
inventory/stock/expiring-soon           ?withinDays&sortBy&sortDir&limit&page
inventory/transfers                     ?limit&page
inventory/transfers/counts
inventory/adjustments                   ?limit&page
inventory/adjustments/counts
inventory/physical-counts               ?sortDir&limit&page
inventory/physical-counts/counts
inventory/valuation                     ?sortDir&limit&page
inventory/valuation/drift               ?sortBy&sortDir&limit&page
inventory/provision/preview
```
`items?specValueIds=` is a facet filter — items are filterable by specification
value (colour, size). `items/search?forSale=` scopes the picker by context, so a
sales line cannot pick a raw material. `inventory/brands` and `inventory/seasons`
are entities Mezan has no equivalent of.

### Manufacturing
```
manufacturing/dashboard
manufacturing/work-orders               ?limit&page
manufacturing/boms                      ?limit&page
manufacturing/boms/counts
manufacturing/boms/:id/cost-estimate
manufacturing/configurable-products     ?limit&page
manufacturing/configurable-products/counts
manufacturing/config-instances          ?limit&page
manufacturing/config-instances/counts
```

### Treasury and financial papers
```
treasury/accounts                       ?limit&page
treasury/accounts/counts
treasury/accounts/stats
treasury/accounts/select                ?type
treasury/cash-vouchers                  ?status&unallocated&limit&page
treasury/cash-vouchers/counts
treasury/cash-vouchers/unallocated-stats ?intent
treasury/bank-statements                ?limit&page
treasury/bank-statements/counts
financial-papers/cheques                ?limit&page
financial-papers/cheques/counts
financial-papers/cheques/summary
```
`cash-vouchers/unallocated-stats?intent=` is the "needs allocation" queue as a
first-class server concern, split by intent (receipt vs payment).

### HR
```
hr/dashboard
hr/employees                            ?statuses&limit&page
hr/employees/search                     ?limit
hr/employees/stats
hr/departments                          ?status&limit&page
hr/departments/counts
hr/job-titles                           ?limit&page
hr/job-titles/counts
hr/contracts                            ?limit&page
hr/contracts/counts
hr/attendance                           ?dateFrom&dateTo&limit
hr/holidays                             ?year
hr/holidays/month                       ?year&month
hr/payroll/runs                         ?sortDir&limit&page
hr/payroll/runs/counts
hr/advances                             ?limit&page
hr/advances/counts
hr/leave/requests                       ?sortBy&sortDir&limit&page
hr/leave/requests/counts
hr/leave/batches                        ?limit&page
hr/leave-policies
hr/leave-policies/presets
```
`hr/leave-policies/presets` ships ready-made statutory policy sets — the "apply a
preset" affordance that makes first-run configuration cheap.

### CRM, projects, assets, installments
```
crm/leads                               ?limit&page
crm/leads/counts
crm/opportunities                       ?limit&page
crm/opportunities/counts
crm/opportunities/pipeline
crm/pipeline-stages
projects                                ?limit&page
projects/counts
assets                                  ?status&limit&page
assets/counts
assets/categories
assets/categories/counts
assets/depreciation/runs                ?limit&page
assets/depreciation/runs/counts
installments/plans                      ?status&limit&page
installments/plans/counts
installments/follow-ups                 ?limit&page
installments/follow-ups/counts
installments/overdue/summary
```

### Operational reports
```
reports/sales/by-period                 ?dateFrom&dateTo&groupBy
reports/sales/by-item                   ?dateFrom&dateTo&taxMode&sortBy&sortDir&limit&page
reports/sales/by-customer               ?dateFrom&dateTo&taxMode&sortBy&sortDir&limit&page
reports/sales/by-salesperson            ?dateFrom&dateTo&sortDir&limit&page
reports/sales/top-products              ?dateFrom&dateTo&taxMode&limit
reports/sales/van                       ?dateFrom&dateTo&groupBy&limit&page
reports/purchases/by-period             ?dateFrom&dateTo&groupBy
reports/purchases/by-supplier           ?dateFrom&dateTo&sortBy&sortDir&limit&page
reports/purchases/by-item               ?dateFrom&dateTo&sortBy&sortDir&limit&page
reports/inventory/stock-levels          ?limit&page
reports/inventory/movement              ?dateFrom&dateTo&limit&page
reports/inventory/aging                 ?limit&page
reports/inventory/slow-moving           ?daysSinceLastSale&sortBy&sortDir&limit&page
reports/manufacturing/make-vs-buy       ?dateFrom&dateTo&limit&page
reports/aging/customers                 ?asOfDate&limit&page
reports/aging/suppliers                 ?asOfDate&limit&page
reports/installments/overview
reports/installments/overdue            ?limit&page
```

### Platform
```
tenant/current
tenant/current/limits
status/summary
dashboard/attention
branches                                ?all&sortDir&limit&page
branches/counts
branches/select                         ?q&limit
warehouses                              ?sortDir&limit&page
warehouses/counts
warehouses/select                       ?q&limit
admin/users                             ?sortDir&limit&page
admin/users/counts
admin/roles                             ?sortDir&limit&page
admin/roles/counts
admin/roles/search                      ?q&limit
admin/sequences                         ?limit&page
attachments/:id/download
notifications/events
notifications/rules                     ?limit&page
workflow/definitions
workflow/pending                        ?limit&page
workflow/my-submissions                 ?status&limit
workflow/my-rejected                    ?limit
shifts
```
`workflow/pending` + `my-submissions` + `my-rejected` are the three approvals tabs
Mezan collapses into one list. `tenant/current/limits` is the entitlement contract.
`dashboard/attention` backs the "needs your attention" panel. `status/summary` backs
the header's system-status indicator.

## What this implies for Mezan

1. **Add `/counts` and `/stats` siblings to every list resource.** Chip counts and
   KPI money must come from the server across the whole filtered set, not from the
   page of rows the client happens to hold. This is a correctness issue, not a
   performance one.
2. **Add `/select` and `/search` picker endpoints** for every entity a form binds
   to. This is the server-side half of the "no free-text entity fields" rule.
3. **Receivables and payables are tracked per currency** (`balance-by-currency`).
4. **Price-list resolution is a server concern, per branch.**
5. **Attachments are a first-class resource** with their own download route.
6. **Brands, seasons and specification-value facets** are entities Mezan lacks.
7. **ETA readiness/health pre-flight** — tell the user whether submission is
   possible before they attempt it.

## Not observed

Every write path. Also not observed: any endpoint behind a role this account does
not hold, anything reachable only from POS (descoped), and anything that only
appears once a document reaches a state absent from this tenant's data.
