# المقاولات — the baseline this module starts from

Verified against the code on this branch, not against `STATUS.md` or `plan.md`.
Everything below was re-checked by hand; where a stakeholder review contradicted
the written docs, the code won.

## What a project is today

`packages/contracts/src/project.ts` — a header and nothing else:

| Field | Note |
|---|---|
| `code`, `nameAr`, `nameEn` | |
| `status` | planned / active / on_hold / completed / cancelled |
| `customerId`, `managerId` | nullable |
| `startDate`, `endDate` | nullable |
| `budget` | **one** Money string for the whole project |
| `siteAddress`, `notes` | |
| `costCenterId` | auto-created `PRJ-{code}` on create (`create-project.ts`) |

`packages/domain/src/projects/` holds `create-project.ts` and `update-project.ts`.
There is no BOQ, no certificate, no retention, no advance, no variation order, no
subcontract, no cost rollup and no revenue recognition. `ProjectsScreen.tsx` is the
only screen; the nav already carries المقاولات as its own workspace with that one row.

## The load-bearing problem: there is no cost dimension

`costCenterId` appears in exactly four wire contracts — `project.ts`, `voucher.ts`,
`cost-center-pl.ts` and `gl.ts`. `projectId` appears in **none**. Tracing the GL-line
builders:

| Posting path | Carries a dimension? |
|---|---|
| Stock issue — `inventory/stock-ledger-service.ts` | No |
| Inventory GL hook — `inventory/document-hooks.ts` | No |
| Goods receipt — `purchasing/goods-receipt.ts` | No |
| Supplier invoice — `purchasing/purchase-invoice.ts` | No |
| Sales invoice — `sales-invoices/gl.ts` | No |
| Treasury voucher — `vouchers/voucher-document.ts` | **Yes**, counterparty leg only |
| Manual journal — `documents/journal-document.ts` | Domain yes; the UI's `LineDraft` has no field |
| Fixed-asset depreciation — `fixed-assets/post-depreciation-run.ts` | No |
| Landed cost — `landed-costs/landed-cost-document.ts` | No |
| Manufacturing work order — `manufacturing/work-order.ts` | No |

One of ten cost paths carries a dimension, and it is the smallest one. A project
P&L built today would be very close to empty, and the emptiness would not look like
a bug — it would look like a quiet site. **Nothing else in this module matters until
this is fixed**, because every requirement below reduces to a number that has to
reach a project.

Two further notes on the same subject: the Cost Center P&L buckets on the exact
`costCenterId` with no parent rollup, though cost centers are hierarchical; and a
single dimension gives project totals only — a contractor needs cost *category*
(مواد / عمالة / معدات / مقاول باطن / غير مباشرة) as well, or they will build fake
cost centers named `PRJ-07-مواد` and encode meaning the code never rolls up.

## What already exists and should not be rebuilt

Two things the planning documents record as missing are in fact present, and the
first stakeholder pass caught both:

- **Withholding tax (خصم وتحصيل).** `packages/contracts/src/voucher.ts` carries
  `withholdingAmount`, `withholdingRatePercent` and `withholdingGlAccountId`;
  `vouchers/voucher-document.ts` posts it; account `2210 ضريبة خصم وتحصيل مستحقة`
  is in the COA template; `reports/withholding-tax.ts` reports it. It exists on the
  **payable** side only — there is no debtor account for WHT a client withholds from
  our own certificate, and the GL account is caller-supplied per voucher rather than
  routed.
- **Contracting account routing.** `packages/domain/src/accounts/account-routing.ts`
  already ships four slots: `contracting.revenue` (4100),
  `contracting.retention_receivable` (1150), `contracting.customer_advances` (2160),
  `contracting.late_penalty` (5910). There is **no** `retention_payable` counterpart,
  so retention exists customer-side and not subcontractor-side — the module's first
  asymmetry, and one worth closing before either is built on.

Also present and reusable: the `CONTRACT` numbering sequence (`CTR-`) exists in
`numbering/sequences.ts` with **no consumer**.

## Adjacent domains this module will lean on

GL posting with balance and fiscal-period enforcement, WAC inventory with immutable
cost layers, purchasing RFQ→PO→GRN→invoice, landed costs, treasury (10 voucher types,
7-state cheques, bank reconciliation), installments, fixed assets, the 26-action
workflow gate, 25 numbering sequences, the 268-permission catalog, the audit trail,
the notification bus and the ETA e-invoicing queue.

Descoped and therefore not available: HR/payroll, POS, cloud. Still missing
product-wide: multi-currency (presented, unimplemented), a year-end close posting,
and per-rate VAT return reporting.
