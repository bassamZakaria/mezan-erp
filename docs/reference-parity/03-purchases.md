# Reference parity — المشتريات (Purchases)

**Method.** Both sides driven live on 2026-08-26: every reference purchases screen
read from its rendered DOM, then the same screen in Mezan on a seeded database.
List surfaces only in this pass — create forms and document views are the next pass.

Reference route → ours: `/purchases/suppliers` → `purchases/vendors` ·
`/purchases/rfqs` → `purchases/rfqs` · `/purchases/orders` →
`purchases/purchase-orders` · `/purchases/receipts` → `purchases/goods-receipts` ·
`/purchases/invoices` → `purchases/purchase-invoices` · `/purchases/returns` →
`purchases/purchase-returns` · `/purchases/landed-costs` → `purchases/landed-costs`.

---

## Suppliers

| Reference | Mezan |
|---|---|
| KPIs: **Amount due to suppliers** · Suppliers with balance · Total suppliers · Active | Total · Active · Amount due |
| **Amount due reads a real balance (248,152.68)** | **reads 0.00 for every supplier, with 7 confirmed purchase invoices worth 150,867.60 on file** ⛔ |
| Chips: All / Active / Inactive | ✅ |
| Filters: Phone · Balance from · Balance to | ❌ none |
| Columns: supplier · phone · payment terms · amount due · category | ✅ |
| "Supplier categories" button | ❌ |
| Pagination + rows per page | ❌ |

⛔ **Finding P-1** — the supplier list reports every supplier's payable as 0.00.
Whatever the vendors screen sums, it is not the confirmed purchase invoices. Same
family as D18 (the AP sub-ledger ignoring payments); needs its own measurement.

## RFQs

| Reference | Mezan |
|---|---|
| Chips: All / Draft / Sent / Closed / Cancelled | ✅ |
| Filters: date from · date to · lines · **responses** · purchase order | ❌ none |
| Columns: number · date · lines · **responses** · purchase order · status | missing **responses** count |
| KPIs | ours has 4 (total / sent / closed / draft); the reference shows none |

## Purchase orders

| Reference | Mezan |
|---|---|
| KPIs: total orders · sent · total value · fully received | ✅ same four |
| Chips: All / Draft / Sent / Partially received / Fully received / Cancelled | ✅ |
| Filters: branch · warehouse · supplier · date from · date to | ❌ none |
| Columns: number · **expected delivery date** · total · status · **created by** | missing both; ours shows supplier as its own column instead of under the number |
| Pagination + rows per page | ❌ |

## Goods receipts

| Reference | Mezan |
|---|---|
| KPIs: total receipts · confirmed · total value · draft | ✅ (ours reports "not invoiced" instead of draft) |
| Chips: All / Draft / Confirmed / **Not invoiced** | ours: All / Draft / Confirmed / Cancelled — no "not invoiced" bucket |
| Filters: branch · warehouse · supplier · date from/to · **cost from/to** | ❌ none |
| Columns: number · supplier · purchase order · total cost · invoice status · **created by** | missing created-by |

## Purchase invoices

| Reference | Mezan |
|---|---|
| KPIs: **total purchases · paid to suppliers · total returned · unpaid balance** (+ unallocated disbursements) | count / count / total purchases / count — a different shape entirely |
| Chips: All / **Overdue** / **Due soon** / Draft / Confirmed / **Partially paid** / **Paid** / Voided | All / Draft / Confirmed / Cancelled |
| Columns: number · **due date** · **remaining amount** · status · created by | number · supplier · date · total · status |
| Row action **Disburse payment** | ❌ |
| Filters · pagination | ❌ |

⛔ **Finding P-2** — none of the payment axis exists on our purchase invoices: no
due date, no remaining amount, no partially-paid/paid state, no disbursement.
`packages/domain/src/reports/aging-suppliers.ts` says so in its own docstring —
"purchase invoices carry no payment tracking, so every confirmed invoice's FULL
total is bucketed". This is the AP twin of the sales side and the root of P-1.

## Purchase returns

| Reference | Mezan |
|---|---|
| KPIs: total returns · confirmed · total returned value · draft | total · confirmed |
| Chips: All / Draft / Confirmed / **Awaiting supplier refund** | All / Draft / Confirmed / Cancelled |
| **"Import past returns"** action | ❌ |
| Filters: branch · warehouse · supplier · date from/to | ❌ none |
| Columns: number · supplier · total · status · **created by** | missing created-by |

## Additional costs (landed costs)

| Reference | Mezan |
|---|---|
| KPIs: total vouchers · confirmed · confirmed cost · drafts · voided | total · confirmed |
| Chips: All / Draft / Confirmed / **Pending settlement** / **Voided** | All / Draft / Confirmed |
| Filters: branch · warehouse · **allocation method** · date from/to · amount from/to | ❌ none |
| Columns: number · **date** · **warehouse** · allocation method · **linked invoices** · total cost · status | number · allocation method · total cost · status |
| Create is its own page | ours still opens a drawer — this screen was not in the sub-page sweep |

---

## Cross-cutting, every purchases list

1. **No filter bar** on any of the seven; the reference has branch / warehouse /
   supplier / date-range on all of them, plus screen-specific ones (cost range,
   amount range, allocation method).
2. **No `createdBy`** anywhere — the same backend gap already filed for quotes and
   sales invoices. One column, seven screens.
3. **No pagination or rows-per-page** except where the sweep already added it.
4. Two substantive findings above (P-1, P-2) that are ledger behaviour, not UI.
