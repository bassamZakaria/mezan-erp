# Reference parity — فواتير المبيعات (Sales Invoices)

> **Archived 2026-08-29 — a point-in-time record, not current state.** Read `../ROADMAP.md`
> for what is built and open, and `../TESTING.md` for how it is verified. Paths cited
> below may name documents that have since moved; `README.md` in this directory maps them.


**Method.** Enumerated from the running reference product on 2026-08-25 by driving
its `/sales/invoices` list, the row expander, the quick-preview panel and all eight
of its tabs, and `/sales/invoices/new` — then each line checked against Mezan running
on a seeded database, in the browser. Not from `docs/catalog/`.

---

## List

| Reference | Mezan | Note |
|---|---|---|
| KPI strip: Total Sales · Collected · Returned · Remaining | ✅ | was sales/collected/remaining + an invoice count; **returned** now reported from `returnedCredit` |
| Expanded KPI adds **Unallocated Receipts** | ❌ | needs the voucher-allocation sub-ledger, not on the invoice wire |
| "Needs follow-up" banner: N overdue + View Overdue | ✅ | filters the list to متأخرة |
| Partially-paid count card | ✅ | both cards render only when the count is non-zero, as in the reference |
| Status chips: All · **Open** · **Overdue** · Draft · Confirmed · Partially paid · Paid · Voided | ✅ | open and overdue are derived, not stored |
| Search by number or customer | ✅ | client-side (server has no `?q=`, D32) |
| Filters: Branch · Customer · From · To · Warehouse · Source | ⚠️ | all but **Source** (Mezan has no per-invoice source channel) |
| Due-date column with "N day(s) overdue" | ✅ | day count computed from the due date |
| Balance column: returns (−) and collected shown under the figure, "Fully settled" marker | ✅ | |
| Created-by column | ❌ | the invoice record carries no `createdBy` — same backend gap as quotes |
| Row action **Collect** + ⋯ menu | ⚠️ | Collect opens the invoice's payments tab; no ⋯ menu (no print) |
| Row expander → inline detail with cost/profit | ❌ | our row opens the document page instead |
| Pagination + rows per page | ✅ | |

## Detail

| Reference | Mezan | Note |
|---|---|---|
| Quick-preview side panel from the list, with "Open in full page" | ❌ | we open the full page directly |
| Summary: date · customer · due date · warehouse · **branch** · outstanding · invoice total | ✅ | branch added this pass |
| "Effects of this invoice" — 3 cards | ✅ | rendered as the effects list |
| Tab: Invoice Lines with Cost, Profit (amount + %), returned-qty strikethrough | ⚠️ | cost and profit per line ✅; **returned-qty strikethrough** ❌ |
| Totals: Total Cost · Total Profit · Gross Margin · Confirmed returns deduction · Net after returns | ✅ | measured on INV-000001: cost 9,320.00, profit 2,920.00, margin 23.9%, returns −1,197.00, net 12,756.60 |
| Tab: Payments (allocations) | ✅ | plus recording a collection |
| Tab: Returns + "New Return" | ⚠️ | lists the invoice's returns; **no create-from-here button** |
| Tab: Installments + "Create Installment Plan" | ❌ | the module exists; not linked from the invoice |
| Tab: Accounting — the JE lines with account names, debit, credit | ✅ | |
| Tab: E-Invoice (ETA) — status, UUID, version, submitted/validated, attempts, Submit | ⚠️ | status + UUID + updated-at; no version/attempts/Submit |
| Tab: Attachments + upload | ❌ | no attachment store anywhere in Mezan |
| Tab: Audit Trail | ✅ | filtered from `/audit` |

## New invoice

| Reference | Mezan | Note |
|---|---|---|
| Creation method: manual vs **from quote** | ✅ | from-quote converts an accepted quote through the existing convert route |
| Customer picker + quick-add (+) | ⚠️ | picker ✅, quick-add ❌ |
| Creation date | ✅ | |
| Due date auto-computed from the customer's payment terms, editable, with the hint | ✅ | measured: شركة الأمل (30 days) on 2026-08-25 → 2026-09-24 |
| Branch * | ✅ | was silently taken from the working location |
| Warehouse * | ✅ | |
| Currency | ✅ | |
| Items: item · qty · unit price · total + tax badge | ✅ | |
| Document discount: type + value + coupon + Apply | ⚠️ | type/value/coupon ✅; the coupon applies at confirm, no separate Apply |
| Notes · Internal notes | ✅ | |
| Summary aside: price list · subtotal · grand total | ✅ | price list resolved from the customer, else the base list |
| Attachments upload | ❌ | as above |
| Save as Draft · Confirm | ✅ | |

**Persistence checked** after a draft save: `branch_id=BR-MAIN`, `currency=EGP`,
`notes` stored, `due_date=2026-09-24` — the fields the form now collects reach the
database, they are not decoration.

---

## What the remaining gaps need

1. **`createdBy`** on the invoice (and quote) — the service already has the actor.
2. **Attachments** — a store, routes and UI; a module, not a field.
3. **Installments from an invoice** — link the existing plans module to the document.
4. **ETA detail** — document version, attempt count and a Submit action on the tab.
5. **Quick-preview panel** — a list-side preview with "open in full page"; ours is
   page-only. Worth doing after the drawer→page sweep settles, not before.
6. **Unallocated receipts** — needs the allocation sub-ledger surfaced per customer.
7. **Returned-qty strikethrough** on invoice lines — needs per-line returned totals.
