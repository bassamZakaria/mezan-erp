# Ledger, costing and document invariants

Every rule below is enforced somewhere in `packages/domain`. When you extend the
system, extend the rule — do not route around it. File pointers are the authority;
this page is the map.

## 1. Money and quantity

`packages/domain/src/money/`

- `Money` is a **signed bigint at scale 1e-6** (six decimals). Postgres BIGINT,
  SQLite INTEGER. No IEEE-754 anywhere on the ledger path.
- Enter the type at the boundary with `Money.fromMajor("1250.50")` — an exact
  decimal string. `Money.fromScaled` accepts only safe integers.
- **Never call `Number()` on a scaled amount**, including to interpolate it into a
  string. Format by string surgery at 2 decimals. A notification body once read
  `478.8` because the enricher floated the total purely for display.
- Line extension rounds to the **piastre** (2dp, HALF_UP) *before* anything is
  summed, so the gross total is the sum of rounded lines, never the rounded sum of
  raw products. Any check that recomputes a total must round the same way — three
  lines of 0.005 × 3, 0.005 and 0.33 give 0.36, not 0.35.
- Rounding is permitted **only** at four named boundaries (`rounding.ts`):
  `LINE_EXTENSION`, `TAX_COMPUTATION`, `DISCOUNT_ALLOCATION`,
  `LANDED_COST_DISTRIBUTION`. Everywhere else arithmetic stays exact.
- Splitting a total across parts uses **largest-remainder allocation**: parts sum
  to the total exactly, leftovers go to the largest remainders, ties to the lowest
  index, negatives allocated on magnitude with the sign reapplied. This is why a
  landed cost of 1,000 across three lines still reconciles to 1,000.
- `amountInWords` renders Arabic legal amounts with gender/dual/polarity forms and
  rounds fractional subunits — print previews depend on its exact wording.

## 2. General ledger

`packages/domain/src/gl/`, `post-journal-entry.ts`

- An entry posts only if **debits equal credits exactly**; `UnbalancedEntryError`
  is not advisory.
- Posting is gated on the **fiscal period** and on the account being active.
- A posted entry is **immutable**. Corrections are reversing entries
  (`reverse.ts`): every line mirrored, the original marked `reversed` and linked,
  the reversal itself period-gated. There is no edit and no delete.
- Journal numbers come from the numbering engine (`JOURNAL_ENTRY` sequence), not
  from the caller.
- `accountBalance` is **per account with no subtree rollup** — a control account
  only sees what was posted *to it*. Posting to a child and expecting the parent to
  move is defect D3's exact shape.

## 3. Fiscal periods

`packages/domain/src/fiscal-periods/`

Three states: مفتوحة open → مغلقة closed → مقفلة locked. Closed may be reopened;
**locked is terminal** — no unlock action and no permission for one. Locking an open
period directly is rejected so the reversible close step is never skipped.

## 4. Inventory costing

`packages/domain/src/inventory/`

- The **stock ledger is the single source of truth**; on-hand, value, WAC and cost
  layers are all derived by exact integer replay of the movement list.
- Receipt (IN): value += qty × unitCost and a **new immutable cost layer** is
  created at the receipt-time cost.
- Issue (OUT): stock leaves at the **current moving average**; the average does not
  change on an issue. Layers draw down FIFO for display only.
- A layer's `unitCost` is **never rewritten**. Layer value and WAC value therefore
  diverge legitimately over time — that gap is the *drift report*, not a bug.
- Replay ordering depends on `occurredAt`. Stamp it with the **document date**, not
  `now()`, or a document-dated movement sorts before the receipt that funded it
  (defect D4).
- Landed costs raise the **cost basis** of stock already received: zero quantity
  moves, allocation by value or by quantity, allocated amounts summing exactly to
  the entered total. They mutate the WAC snapshot and rewrite cost layers while
  appending nothing to the movement ledger, so `replay()` cannot reproduce a position
  a landed cost has touched and the drift report's `cacheDrift` reads nonzero on a
  healthy tenant (D36). Fixing it needs a value-carrying movement kind.
- Reconcile per **document**, not per line: `costItems` is denormalized onto every
  line, and summing per line overcounted a multi-line landed cost N times.
- Stock transfers are valuation-neutral (and stay visible from both ends by design).
  Adjustments and physical counts are not — each reason needs a GL account pair, and
  any reason without one moves stock silently (D2, still open: only `INITIAL_STOCK`
  is mapped).

## 5. Documents

`packages/domain/src/documents/`, plus each module's `*-document.ts`

- Lifecycle is draft → confirmed → (returned / cancelled / voided). **Confirm is
  where everything happens**: numbering, stock plan, GL posting, sub-ledger update,
  workflow gate, events. A confirm that posts nothing is the defect to look for first.
- A confirmed document is voided, never deleted — the trail survives.
- Returns validate against **server-computed** invoiced quantity, never against a cap
  in the request body — the same goods were returnable twice. The same rule caught a
  receipt that could be invoiced twice: check the `invoiced` flag, not just the status.
- Validate invoice-level discounts, not only line-level ones: an unvalidated negative
  invoice discount applied as a subtraction and turned 950.00 into 1,140.00.
- Discounts are deducted **before** VAT; a historical document records which
  promotion applied, and deactivating that promotion later must not change it.
- A goods receipt moves stock but posts GL only when its invoice confirms; a
  confirmed-uninvoiced receipt legitimately puts the sub-ledger ahead of GL 1200.

## 6. Receivables, payables and allocation

`packages/domain/src/vouchers/`

- One voucher document, **10 types**, discriminated. Collections and payments are
  **allocated** across open invoices: partial in both directions (a voucher across
  several invoices, an invoice paid by several vouchers), and reversible — undoing
  an allocation restores both the voucher remainder and the invoice balance.
- **Do not create a second store of the same fact.** `SalesInvoiceService.recordPayment`
  incrementing a cumulative `amountPaid` alongside the allocation sub-ledger is
  defect D1, still open: AR overstates by every collection ever recorded, AP stands
  35,554.00 above GL 2100, and the balance-reconciliation screen shows a permanent
  mismatch. The UI prefers allocations and the aging reports take the larger of the
  two, but the backend can still record one collection twice. Converging
  `recordPayment` onto the allocation sub-ledger removes the second store — a decision
  about a shared contract, not a patch.
- Sales and purchase invoice confirms now populate `AllocatableInvoiceRepository`, so
  `/open-invoices`, the supplier statement and per-partner balances are live. Keep
  every new document type that creates a receivable or payable feeding it.
- Outstanding = grand total − allocated − **confirmed returns**. Omitting the returns
  term made a fully-returned invoice read as owed in full while the GL had credited AR.
- Cash guard: a CASH treasury account may not go negative when
  `preventNegativeCashBalance` is on; BANK accounts are exempt. The guard bites on
  the account whose balance *decreases* — the payer, and the source of a transfer.
- Cheques: 5 stored states rendered as **7 UI states** by deriving
  pending/under-collection/due-today from `dueDate` vs `asOfDate`. Manual outcomes
  (deposited, collected, bounced, replaced) pass through unchanged.

## 7. Numbering

`packages/domain/src/numbering/`

31 sequences with prefix, pad length and annual-reset policy. Numbers must be
**gap-free under concurrency**: the counter row is bumped inside the same
transaction as the document insert (`BEGIN IMMEDIATE` on SQLite,
`SELECT ... FOR UPDATE` on Postgres). The domain owns the port; atomicity is the
store's job. Never allocate a number outside the document's transaction.

## 8. Access control — four independent gates

A user action must pass all four, and they are distinct:

1. **Permission** — ~268 codes closed over a dependency graph (`.confirm` implies
   `.view_own`), resolved once so `can()` is set membership. `"*"` is tenant admin.
2. **Role** — workflow approval steps are gated on **role codes**, read from
   `x-role-codes`; the `"*"` admin still short-circuits. Passing a resolved permission
   set as `actorRoles` — which two routes used to do — silently makes every role step
   satisfiable only by that bypass. An approval must also *post* the held document:
   re-submitting a fresh request on the next confirm discards the approval just
   granted, and deciding only the request record leaves the document unposted.
3. **Scope** — branch and warehouse come from `x-branch-scope` / `x-warehouse-scope`
   and must actually narrow list queries. A header that no route reads is a gate
   that does not exist (fixed F8 for warehouse, F32 for branch — twelve branch-owned
   list routes now narrow, proven against a real second branch).
   Scope narrows; it never widens beyond the session grant.
4. **Entitlement** — `{ plan, activeModules[], features{}, seats, expiresAt }`,
   identical in shape for cloud (subscription) and desktop (Ed25519-signed offline
   licence). Never license a module that does not exist, and never grant a
   permission whose module is not entitled.

## 9. Multi-tenancy, audit and events

- Audit events are append-only with a severity taxonomy; the sink must actually be
  passed into the app or nothing is recorded. The trail is branch-scopable.
- This build emits 5 of the 39 catalogued events — derived live from the bridge
  mappings in `create-backend.ts`. The purchase order/receipt/invoice chain publishes
  nothing because it is not a `DocumentService`; that is an open decision, not an
  oversight to paper over with invented bridges.
- Notification template variables resolve against the event payload, and a **missing
  key is indistinguishable from an empty value** — supply every variable a rule
  author would reach for (`documentNumber` was silently blank for exactly this reason).
- Webhook retries must stop before the store closes; a bounded retry outliving
  shutdown throws while recording its own attempt and loses the final delivery record.
  A failing delivery must never roll back the business operation that triggered it.
- Domain refusals reach an Arabic UI: give every error type an Arabic label in its own
  module. A raw status code or an English state-machine message in the UI is a defect.

## 9. Metadata a posting must carry (and mostly does not)

Proved in `scripts/scenarios/seams.ts`; each gap is a register entry.

- **Currency and rate.** `glJournalLineSchema` carries `currency` and `fxRate`, and
  the FX revaluation engine (`fx-revaluation/revaluation.ts`) is correct end to end:
  it derives the open foreign balance from base ÷ rate, restates at the closing rate,
  posts gain/loss against 4900/5900 only, and auto-reverses next day. But **no
  document route ever sets those fields** — a `currency: "USD"` purchase invoice
  posts its foreign numbers as EGP (D24). `findRate` correctly refuses a pending
  rate, so an unapproved rate is genuinely unspendable.
- **Tax rate.** A sales invoice, quote, purchase invoice and return line stores
  `taxRateId` — the tax-rate ROW it was charged under — beside its percent (D28,
  D79). On the journal: a sales posting tags its revenue and VAT lines with the
  percent and the id; a purchase posting tags its cost-side lines (inventory, the
  2120 received-not-invoiced clearing, freight, expense) and its input-VAT line;
  returns tag the same lines in reverse. The AR/AP line carries neither, and a 0%
  line posts no VAT line, so its rate reaches the ledger on the base line only.
  The id is resolved server-side (`resolveDocumentLineTax`): a named id must
  exist, be active and agree with any percent sent; `taxRateId: null` means "no
  rate" and stores NULL; an omitted id is inferred from the percent only above 0%
  and only when exactly one active rate has it. **A rate is never inferred at
  0%** — exempt (V003), export (V001) and not-subject are all 0%, so a retention
  release, a tax-exempt customer's sale and a VAT-off sale store NULL. A rate that
  any stored line names keeps its percent and ETA sub-type for good (409
  `TAX_RATE_IN_USE`); it may be renamed or deactivated, and an inactive rate still
  answers for lines already posted. The VAT return groups by the stored id and
  never assigns a NULL-id line to a rate at report time. Its output base counts
  revenue accounts plus the routed «فواتير مستخلصات على العقود» liability (2165),
  which a cost-to-cost certificate invoice credits instead of revenue; its input
  base is read only off purchase-side entries, so a sale that credits an asset
  is not a negative purchase. NULL — a pre-D79 row, or a line that named no
  rate — is the only case the e-invoice builders match the percent, and they
  match it only above 0%. A NULL 0% line on a tenant holding ANY specific zero
  classification (exempt, export) is a blocking pre-validation finding on an
  e-invoice and refuses a consumer e-receipt (`ETA_RECEIPT_NOT_READY`); the sale
  itself still confirms and posts. `POST /tax-rates` with an existing id is 409
  `TAX_RATE_ID_EXISTS`, never an overwrite. Still open: an item carries a
  percent, not a rate id; a manual journal cannot name one; and a tax rate
  cannot express a partial taxable base (Egypt's 14%-on-36% construction
  treatment), so a transitional-basis certificate invoice posts 5.04% with a NULL
  id.
- **Cost centre.** Journal lines carry `costCenterId` and the cost-centre P&L groups
  by it, with a غير مخصص bucket so totals always reconcile. Treasury vouchers have no
  such field (D26), so the report is blind to almost all real spending.
- **Branch.** The audit sink stamps the **caller's** `x-branch-scope`, not the
  document's branch, so a caller scoped to all branches (the default) writes rows with
  `branchId: null` that the audit viewer's branch filter can never find (D30).
- **Withholding.** No account, no field, no report (D27) — the voucher stores the net
  paid, so a supplier's ledger still shows them owed what the tenant is legally
  holding for the authority.

Two more facts worth knowing before writing anything that reads the books:

- **A confirmed document's journal entry uses the document's own id** for sales
  invoices and vouchers — but *not* for purchase invoices, whose entry has to be
  found by its memo (`فاتورة مشتريات <number>`).
- **There is no year-end close** anywhere in the product (D34): revenue and expense
  accounts never reset and GL 3900 (الأرباح المرحلة) is never posted to. Reports
  window by date, so they read correctly; the ledger alone cannot state last year's
  result.
