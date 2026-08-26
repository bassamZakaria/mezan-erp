# Reference audit — status and route map

Full audit of Mezan against the running reference product. Started 2026-08-26.
Every line here was read from a live screen on both sides; nothing is inferred
from `docs/catalog/`.

## Route inventory (complete)

The reference exposes **113** routes; Mezan's nav exposes **116** screens.
**99** reference routes have a Mezan counterpart.

### On the reference, absent from Mezan (14)

| Route | Note |
|---|---|
| `/pos/terminals` `/pos/sessions` `/pos/sales` `/pos/refunds` `/pos/kitchen` `/pos/tables` `/pos/deliveries` `/pos/discount-approvals` `/pos/reservations` | the whole POS module — **descoped from v1** by `docs/plan.md` |
| `/reports/pos/daily` `/reports/pos/shifts` | POS reports, same decision |
| `/sales/promotions/report` | promotion-usage report; our API has `GET /promotions/report` and no screen |
| `/settings/shifts` | work shifts (POS/HR adjacent) |
| `/settings/label-templates` | label templates; ours live inside `inventory/labels` |

### On Mezan, absent from the reference (18)

Six module hubs (sales, purchases, inventory, manufacturing, accounting, treasury,
CRM, assets), `inventory/writedown-runs`, `accounting/trial-balance-report`,
`crm/crm-activities`, `hr/leave-balances`, `hr/my-leave`, `settings/settings-profile`,
`settings/settings-api-keys`, `settings/settings-webhooks`, `settings/audit`,
`system/status`. None of these is a problem — extra surface, not missing surface.

## Screens audited so far

| Module | Screens | Depth | Document |
|---|---|---|---|
| Sales — quotes | 3 (list, create, detail) | field level | `01-sales-quotes.md` |
| Sales — invoices | 3 + 8 tabs | field level | `02-sales-invoices.md` |
| Purchases | 7 lists | list level | `03-purchases.md` |
| Inventory · Treasury · Accounting · Customers | 9 lists | list level | this file, below |

**Audited: 22 of 99. Not yet audited: 77.**

## Findings so far (filed in `docs/defects.md`)

- **D39** suppliers list reports the opening balance as the amount due — reads 0.00
  against 150,867.60 of confirmed purchase invoices.
- **D40** customer remaining credit is computed against the opening balance, so it
  ignores every live invoice.
- **D41** every treasury account's balance — column and all three KPIs — is the
  opening balance; reads 0.00 with 10 confirmed vouchers on file.

These are one shape: **an opening balance rendered as if it were a live balance.**
Wherever a screen shows a partner or account balance, check which field it reads.

## Inventory · Treasury · Accounting · Customers — list-level gaps

| Screen | Reference has that we do not |
|---|---|
| Customers | live **Amount owed** column and "Total to collect" KPI (we show opening balance), customer **categories**, filters (phone, credit-limit range, balance range), "customers with balance" chip |
| Items | Item categories · **Export** · out-of-stock alert card · chips by item type (product/service/raw material/finished good) and low/out of stock · filters (type, category, unit, sell-price range, cost-price range, hide variants, show auto-generated) · **specification facets** (colour…) · per-row "Set opening stock" |
| Stock balance | needs-attention card · low/out-of-stock chips · filters (warehouse, category, unit, total range, reorder-level range) · **reorder level** column |
| Stock transfers | needs-attention card (draft transfers) · filters (source warehouse, destination warehouse, dates, line-count range) · **created-by** column |
| Stock adjustments | **voided** bucket · filters (warehouse, reason, dates) · **total value** and **created-by** columns |
| Physical counts | **created-by** column |
| Treasury accounts | **live balance** (D41) · filters (branch, status, currency, balance range) · cash/bank chips exist on both |
| Cash vouchers | **needs-allocation** and **pending-approval** buckets · filters (branch, all 10 voucher types, dates) · **created-by** column |
| Cheques | ours matches closely (same 8 statuses, direction filter, same columns incl. created-by); reference adds a branch filter and "in custody" bucket |
| Journal entries | **pending-approval** bucket · **print entries** action · filters (dates, **source module**) · **source module** and **created-by** columns |
| Chart of accounts | **Account routing** tab · **account-number guide** · expand-all · status/type filters · header/detail account counts |
| Financial reports | one screen with 7 report tabs (trial balance, income statement, balance sheet, **cash flow**, VAT return, general ledger, account ledger); ours splits these across separate screens and has no cash-flow report |

## Next

77 screens remain: the rest of inventory and accounting, CRM, assets, projects,
manufacturing, installments, van sales, reports (22), settings (11) and HR (12,
descoped in v1 — audit last). Then a second pass over the create forms and
document views, which is where the quotes and invoices audits found the real
defects.
