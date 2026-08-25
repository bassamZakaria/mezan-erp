# Mezan — defect register

**The single list of known defects.** Every test run reads this before starting
and updates it before finishing. Nothing else tracks defects — if it is not
here, it is not tracked.

Updated 2026-08-25 (after the cross-module money-trail pass, docs/scenarios/09-cross-module.md).

## How to use this file

**Before a test run**, read the OPEN table. Those defects will show up. Note
that you saw them and move on — re-filing a known defect as a new finding buries
whatever is actually new.

**After a test run**, update this file in the same commit as any fix:

- Found something new → add a row, with the **measured** evidence, not a
  description. "Off by exactly 122.00" is a defect report; "reconciliation looks
  wrong" is a feeling.
- Fixed something → move it to FIXED with the commit that fixed it. **Do not
  delete it** — a fixed defect is how you recognise its regression.
- Proved something was a false alarm → move it to NOT A DEFECT with what
  actually caused the reading. Silently dropping it means the next person
  rediscovers and re-reports it.

A stale register is worse than none: it is how a real regression gets waved
through as "oh, that's the known one".

---

## Open

| # | Area | Defect | Measured evidence | Severity |
|---|---|---|---|---|
| D1 | Treasury / AR | A confirmed collection voucher never moves the invoice's `amountPaid` | `VCH-DEMO-1` collects **6,279.12** and credits AR in the GL; every invoice still reports `amountPaid: 0` | High |
| D2 | Inventory / GL | A `PHYSICAL_COUNT` adjustment moves stock with **no journal entry** | Single-sided count leaves inventory off by exactly **122.00** | High |
| D3 | Manufacturing / GL | `completeWorkOrder` never touches GL 1200 | BOM-DEMO-1 at qty 10 leaves inventory off by exactly **80.00** | High |
| D4 | Inventory reporting | `occurredAt` stamped `now()` instead of the document date | Drift reports `valueDiff 2400 = 120 × (160 − 140)` — a gap that is not real | Medium |
| D5 | E-invoicing | The ETA queue has no producer | `EtaService.enqueue` exists; **no route and no event bridge calls it**, so no user action can enqueue a document | Medium |
| D7 | Shell / scope | **Branch** scope still filters nothing | No list route reads `branchScope`; unprovable either way while the tenant has one branch | Medium |
| D8 | Approvals | An admin rejecting someone else's pending request **approves** it instead | Decide-side bypass, distinct from the submit-side one | High |
| D9 | Sales | An invoice's `remainingBalance` never subtracts confirmed returns | `INV-DEMO-1` shows its full 13,953.60 despite 1,197.00 returned | Medium |
| D10 | Purchases | Document creation hardcodes `branchId: "MAIN"`, `warehouseId: "MAIN-WH"` — ids that do not exist in this tenant (`BR-MAIN`/`WH-MAIN`) | RFQ, PO and invoice create paths | Medium |
| D11 | HR | A leave request exceeding the balance is **accepted**, not refused — the balance simply goes negative | `consumeLeaveBalance` | Medium |
| D12 | Projects | No status-transition guard, client or server — any status reaches any other | | Medium |
| D13 | Fixed assets | No disposal action exists — the status value and permission exist, the route and button do not | | Medium |
| D14 | Reports | F3's fix covers only the 7 financial statements; `useReport` still swallows validation errors for all 22 operational reports | Same symptom, 22 of 30 unfixed | Medium |
| D15 | UX | Domain state-machine refusals surface in **English** inside the Arabic UI, and the hourly-payroll exclusion embeds the raw string `"hourly"` | | Low |
| D17 | Demo data | The seeded tenant never funds its bank account, so the dashboard shows cash at **−100,524.88** and looks broken | GL 1310: 113,704 credited vs 5,100 debited — payroll and supplier payments disburse from an account with no opening balance | Medium |
| D18 | Treasury / AP reconciliation | The AP sub-ledger ignores every payment: paying or refunding a supplier moves GL 2100 and leaves the sub-ledger figure where it was | `SCN-X-PAY-1` pays **2,280** → GL 2100 falls 2,280, AP sub-ledger unchanged; the reconciliation diff goes 35,554 → **37,834**. `resolveReconciliationControls()` sums confirmed invoice totals − returns + landed costs and never subtracts allocations | High |
| D19 | Settings / Treasury | `preventNegativeCashBalance` and `allowNegativeTreasury` are dead switches — the guard never reads them | With the setting persisted `false` (verified by re-read), the same voucher is still refused `CASH_BALANCE_NEGATIVE`. `create-backend.ts`'s `vouchers:` options never pass `settings`, so `VoucherService.cashPolicy()` returns a hardcoded `true` | Medium |
| D20 | Purchases / fiscal periods | Confirming a purchase invoice into a **closed** period answers `500 Internal Server Error` | Sales confirm, voucher confirm and journal post all return 422 `PERIOD_NOT_OPEN_FOR_POSTING`; `purchases-routes.ts`'s confirm handler does not map `PeriodNotOpenForPostingError` thrown by the GL port | Medium |
| D21 | Purchases / atomicity | That same crash is not atomic: the stock IN is applied before the GL refuses, and never rolled back | One blocked line at qty 1 × 50 leaves the inventory sub-ledger exactly **50.00** ahead of GL 1200, with no document that explains it | High |
| D22 | Field sales / Treasury | A trip's roadside cash never reaches the van treasury, but settling transfers the full counted cash out of it | Float 500 in, 700 of recorded sales, 1,150 counted: the van's GL 1300-2 ends **650** below where it started. `POST /field/van-trips/:id/cash-movements` only mutates the trip document | High |
| D23 | Go-live import / GL | A historical import records **no opening AR or AP at all** — a migrated business owes and is owed nothing in its ledger | Importing an outstanding supplier invoice (250 remaining) and customer invoice (300 remaining) moves GL 2100 and 1105 by **0.00**. The domain posts the opening entry only `if (!archive.settled && deps.gl && deps.accounts)`; `create-backend.ts` wires `historicalImport` / `salesHistoricalImport` with `archives` only | High |
| D16 | Data migration | The commit gate is all-or-nothing **per file**, and two shipped fixtures have a required column blank on every row, so they reject their own valid rows | `employees.xlsx` (hire date), `items.xlsx` (base unit code) | Medium |

### D23 — go-live import archives history and posts none of it

The documented go-live rule is right and the domain implements it: archive
settled documents with no journal entry, post **only** the outstanding balance
against the opening-balance account. The wiring drops the second half.
`packages/backend/src/create-backend.ts` passes `historicalImport: { archives }`
and `salesHistoricalImport: { archives }` — no `gl`, no `accounts` — so
`if (!archive.settled && deps.gl && deps.accounts)` is never true and the opening
entry is never posted.

The visible effect at a customer's go-live: every migrated invoice appears in the
archive, the AR and AP aging reports have rows, and the trial balance says the
business is owed nothing and owes nothing. Third instance of the same failure
shape as D19 — an options object assembled without the dependencies the service
needs to do its real job.

### D18 — the AP sub-ledger never hears about a payment

`resolveReconciliationControls()` (`create-backend.ts`) builds the AP figure from
confirmed purchase invoices, minus confirmed purchase returns, plus landed costs.
Treasury allocations are not in that sum, so **every supplier payment de-reconciles
AP by its own amount** — the exact twin of D1 on the other side of the books.

It stayed invisible because no scenario had ever paid a supplier: the module
suites confirm invoices, and the treasury suite posts vouchers that are not
allocated to purchase invoices. It takes the cross-module trail (buy → pay) to
see it.

### D19 — the cash guard ignores its own setting

`VoucherService.cashPolicy()` returns `true` whenever `deps.settings` is absent,
and `create-backend.ts` never passes `settings` into the `vouchers:` options
object. The Settings screen's منع الرصيد السالب للحسابات النقدية toggle therefore
changes nothing, in either direction. Same shape as the missing
`resolveGateConfig` on the same options object (see the treasury approval-gate
finding in `scripts/scenarios/accounting.ts`) — one under-wired dependency,
two dead features.

### D20 / D21 — a closed period crashes the purchase confirm, and the crash leaks stock

Two defects from one call. The route does not map the domain's period error, so
the caller sees a 500 instead of the 422 every sibling route returns (D20). Worse,
`confirmPurchaseInvoice` moves stock **before** posting the journal entry, and
nothing unwinds the stock movement when the post throws (D21) — the sub-ledger is
left ahead of GL 1200 by the invoice's own value with no document behind it. D21
is the one that corrupts data; D20 is only how it is reported.

### D22 — van trip cash: recorded in one place, transferred from another

`POST /field/van-trips/:id/cash-movements` records a roadside sale on the trip
document and posts nothing to the van's treasury account. `settleVanTrip` then
transfers the whole counted cash — float plus those unposted sales — out of that
treasury. The van's cash account ends every trip short by exactly what the trip
sold, and the shortfall compounds trip after trip.

### D1 — collection voucher does not move `amountPaid`

The AR sub-ledger derives from `grandTotal − amountPaid`, so it overstates by the
full amount of every collection ever recorded. This is the
`recordPayment`-vs-allocations split — **two stores of the same fact** — and it
is the reason `مطابقة الأرصدة` shows an AR mismatch on seeded data.

Converging `recordPayment` onto the allocation sub-ledger removes the second
store entirely. That is a decision about a shared contract, not a patch.

### D2 — `PHYSICAL_COUNT` posts no journal entry

`adjustmentGlAccountsForReason` (`create-backend.ts`) maps only `INITIAL_STOCK`.
Every other reason moves stock and posts nothing, so the sub-ledger changes and
the control account does not.

**The demo seed steers around this**: its two physical counts are the same item
and quantity in opposite directions so they net to zero. That means **the demo
data is not evidence this path is sound** — it is evidence it was avoided.

### D3 — `completeWorkOrder` never touches GL 1200

It posts to 1220 and to 1210 / 5110 / 5210. `accountBalance` is per-account with
no subtree rollup, so the inventory control account never sees the movement.

**No work order in the seed is completed**, for this reason. Same caveat as D2:
the path is unproven, not proven.

### D4 — `occurredAt` is the wall clock, not the document date

Purchase and sales confirms stamp `occurredAt = now()`. Document-dated movements
(transfers, adjustments, count-generated adjustments) carry a plain calendar
date, which sorts *before* them. The drift report replays each position in
`occurred_at` order and therefore consumes stock before the receipt that funded
it.

**The WAC snapshots themselves are correct** — reconciliation against the GL is
exact. Only the replay-based drift report is affected.

### D5 — the ETA queue has no producer

`/eta/submissions` is the one list surface `pnpm check:seed` cannot fill, and it
is exempted there with a pointer back here. Remove the exemption when a route or
event bridge actually calls `enqueue`.

---

## Fixed

| # | Defect | Fixed by |
|---|---|---|
| F1 | AR and AP sub-ledgers ignored returns and landed costs, so the GL moved and the sub-ledger stood still — every tenant that posted a return saw a false mismatch | `0717a47` |
| F2 | `text-on-brand` named a token that does not exist, so the selected financial-statement tab rendered near-black on dark teal at **1.52:1** | `1aa6a51` |
| F3 | Server parameter-validation errors were swallowed — an invalid date left the report sitting on its placeholder with no message | `274f53e` |
| F4 | 11 form fields had no accessible name; three EntityPickers hand-rolled a caption div instead of using the component's own `<label for>` | `fff206f` |
| F5 | Label printing had no page `h1`; cost-centre P&L rendered a second, empty one | `9f17f28` |
| F6 | The approvals note field had no accessible name — found the first time the inbox had a row to test | `c0dd755` |
| F7 | **The same goods could be returned repeatedly.** Both return routes validated the requested quantity against an `availableQty` supplied *in the request body*. Measured: 40 invoiced, two returns of 40 each, both confirmed — stock and AR credited twice for goods sold once | `46e527c`, `4acf10f` |
| F8 | **The warehouse selector filtered nothing.** The shell sent `x-warehouse-scope`, the resolver parsed it, and no list route ever read it. Six surfaces now narrow (stock balance 8→3, on-hand 1,790→119) | `0be2432` |
| F9 | **A document held for approval was permanently stuck** — the gate built its request in memory and discarded it, so the inbox never saw it and nobody could approve or reject. Proven fixed: 8→9 requests | `342b5b9` |
| F17 | **The dashboard's VAT figure had the wrong sign and was out by 37,055.20.** It read the report engine's `grandTotals.tax`, a naive sum across BOTH VAT sides, where the correct figure is `vatNetPayable` = output − input. It showed **24,983 due** while the VAT return screen showed **12,072.20 refundable** — the same tenant, opposite directions | this commit |
| F16 | **The comparative income statement's prior column was always zero on the route the UI uses.** `/financial-reports/income-statement` bounded its GL query to `[periodFrom, periodTo]`, so the comparison window — always earlier — found no entries. The feature looked correct because it was verified on `/reports/accounting/…`, which is unbounded. Now proven against a control: the prior column equals the control run exactly (−64,905.24158) | this commit |
| F13 | **A goods receipt could be invoiced twice.** `createPurchaseInvoice` checked the receipt's status but never its `invoiced` flag, so a second from-receipt invoice was accepted and posted a duplicate Dr Inventory **with no matching stock movement**. The flag and the error both already existed — cancel used them, create did not | this commit |
| F14 | **A landed cost with more than one target line N-times-overcounted its own total in the AP sub-ledger.** `costItems` is denormalized onto every line, and the reconciliation summed per line instead of per document. This was a bug in F1's own fix | this commit |
| F15 | **The warehouse selector still did nothing on the adjustments and transfers screens.** F8 scoped the raw-engine routes; the document-layer routes those screens actually call were missed. A transfer stays visible from both its ends by design | this commit |
| F12 | **A negative invoice-level discount inflated the total.** Every line-level discount was validated 0–100; the invoice-level one was not validated at all, so a negative amount applied as a literal subtraction and turned 950.00 into 1,140.00. Found by the executable sales suite on its first run | this commit |
| F11 | **Webhook retries outlived shutdown**, waking against a closed store and throwing while recording — losing the final delivery record and printing stack traces that read like smoke failures. `stop()` is now called before the connection closes, and guards both the pause and the write. Verified: shutdown errors went from a flood to **0** | this commit |
| F10 | `GET /items/:id` served `onHand: "0"` with `stockStubbed: true`, on a comment saying real figures arrive "once Phase 2 lands the movements ledger" — which it had | `46e527c` |

`pnpm lint` now fails on F2's whole class: `scripts/check-color-tokens.mjs`
checks every colour utility against the compiled stylesheet.

---

## Not a defect

Kept so nobody rediscovers and re-reports them.

| Reading | What actually caused it |
|---|---|
| 86 screens reporting contrast **1.00** | The measuring script returned alpha `1` for any `color(...)` value, ignoring the `/ 0.22` in `color(srgb … / 0.22)`. It compared the sidebar's brass badge text against brass. One parsing bug, one badge in the shell, 86 identical false findings |
| Avatar monograms at **1.04:1** | Brass gradient background; a gradient has no single colour to measure against. Skip, do not guess |
| Every zebra row failing contrast | `color-mix()` resolves to `color(srgb 0.96 …)` — 0–1, not 0–255 |
| `/profile` returning 404 | It returns the **caller's** record; the probe sent a user id that does not exist |
| `/inventory/drift` returning 400 | It requires `itemId` and `warehouseId`; a bare GET is correctly rejected |
| Dashboard screenshot blank | A screenshot of a hidden tab can come back unpainted while the DOM is fully populated. Assert on the DOM |
| "Van sales report is missing" | It was built, routed, screened and in the nav the whole time. `docs/STATUS.md` was wrong |
| "Make-vs-buy needs a schema change" | Both cost sides were already derivable. `docs/STATUS.md` was wrong |
