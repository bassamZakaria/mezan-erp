# Mezan — defect register

**The single list of known defects.** Every test run reads this before starting
and updates it before finishing. Nothing else tracks defects — if it is not
here, it is not tracked.

Updated 2026-08-24 (after the fix pass on the register's own OPEN table).

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
| D1 | Treasury / AR | A confirmed collection voucher never moves the invoice's `amountPaid` | `VCH-DEMO-1` collects **6,279.12** and credits AR in the GL; every invoice still reports `amountPaid: 0`. AP is the same defect on the other side: the sub-ledger counts every confirmed purchase invoice in full and ignores supplier payments, so it stands **35,554.00** above GL 2100 | High |
| D2 | Inventory / GL | A `PHYSICAL_COUNT` adjustment moves stock with **no journal entry** | Single-sided count leaves inventory off by exactly **122.00** | High |
| D3 | Manufacturing / GL | `completeWorkOrder` never touches GL 1200 | BOM-DEMO-1 at qty 10 leaves inventory off by exactly **80.00** | High |
| D13 | Fixed assets | No disposal action exists — the status value and permission exist, the route and button do not | | Medium |
| D18 | Inventory reporting | A landed cost writes **no stock movement**, so it cannot be replayed | `applyLandedCostRevaluation` bumps the snapshot and rewrites cost layers directly. `GET /inventory/drift` therefore reports `cacheDrift` on a healthy tenant: ITEM-DEMO-1 cached **146.827936** vs recomputed **140.000000** — and the field's own docstring says a nonzero value "means the cache is CORRUPTED" | Medium |
| D19 | Dashboard / reports | `gl.receivables` and the customer-aging report disagree by **5,486.12** | The tile sums EVERY code-11xx asset account (trade AR 1105, installment AR 1110, retention 1150, employee advances 1160, and the credit-natural provision 1190 sign-flipped positive); aging covers sales-invoice trade AR only. 47,079.28 vs 52,565.40 — a scope question, not arithmetic | Medium |

Every other row that stood here has moved to FIXED below.

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

### D18 — a landed cost is invisible to the movement ledger

`applyLandedCostRevaluation` raises the position's value by mutating the WAC
snapshot and deleting + re-adding cost layers at a higher unit cost. It appends
nothing to the movement ledger, and `StockMovement` has no value-only shape to
append, so `replay()` — which sums IN/OUT movements — can never reproduce the
snapshot on any position a landed cost has touched.

The snapshots themselves are correct, and reconciliation against GL 1200 is
exact. What is wrong is the **diagnostic**: `cacheDrift` is documented as
"nonzero means the cache is CORRUPTED and needs a rebuild", and it is nonzero on
a perfectly healthy tenant. Fixing it needs a value-carrying movement kind —
a change to the ledger's shape, not a patch.

This was found while fixing D4, and is the residue of what D4's original
evidence (`valueDiff 2400`) was reading.

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
| F18 | **An admin rejecting someone else's pending request approved it instead** (D8). The gate's admin branch never read `input.decision`; an admin now bypasses the step's ROLE only | this commit |
| F19 | **An approved request never posted its document.** Every confirm re-submitted a FRESH request over the standing one, discarding the approval that had just been granted, and deciding moved only the `ApprovalRequestRecord`. An approval now posts the held document; a rejection or a modification request hands it back as an editable draft; a rejected request refuses a re-confirm outright | this commit |
| F20 | **TREASURY_VOUCHER_CONFIRM's gate was wired to a resolver that always returned null**, and held voucher requests were never persisted — no configured chain had any effect and nothing reached the inbox. `SALES_INVOICE_CONFIRM`'s seeded chain was equally inert: `salesInvoices` was never given the workflow gate at all | this commit |
| F21 | **HR reported a disbursement as done while its treasury voucher sat unapproved** — the run went مصروف with no cash moved and no journal entry. It now refuses with `TREASURY_DISBURSEMENT_HELD`, and disbursing again after the approval finds the same voucher already posted | this commit |
| F22 | **The VAT return's grand total summed the tax column across BOTH sides** — a figure with no accounting meaning, which the dashboard read as "VAT due". A report column can now declare its own grand total; the VAT return's declares output − input (D of the F17 family, on the server side this time) | this commit |
| F23 | **The 22 operational reports still swallowed server parameter-validation errors** (D14) — F3 had covered only the 7 financial statements. Both hooks now share one extractor | this commit |
| F24 | **An invoice's `remainingBalance` never subtracted confirmed returns** (D9), so a fully-returned invoice read as owed in full while the GL had credited AR. It nets them off and reports `returnedCredit` | this commit |
| F25 | **RFQs, purchase orders and purchase invoices stamped the ids `"MAIN"` / `"MAIN-WH"`** (D10), which exist in no tenant this app seeds. They resolve branch and warehouse from the caller's own scope, and refuse to save when none is available | this commit |
| F26 | **Approving leave drove the balance negative** (D11) — nothing checked the entitlement. It now refuses with `LEAVE_BALANCE_EXCEEDED`, naming days requested vs available; unpaid leave is exempt. The seed had taken the same shortcut and now grants the entitlement it uses | this commit |
| F27 | **A project's status was never guarded** (D12) — any status reached any other, so a completed project could go back to "planned". `PROJECT_TRANSITIONS` is now enforced on the server and the picker only offers legal moves | this commit |
| F28 | **Every domain state-machine refusal reached the Arabic UI in English**, naming raw status codes (D15), and the payroll exclusion embedded the code `"hourly"` in Arabic prose. Nine error types now read in Arabic through their module's own labels | this commit |
| F29 | **Stock movements were dated by the wall clock on a confirm** but by the document date elsewhere (D4), so a replay consumed stock before the receipt that funded it. Every document-caused movement now derives its timestamp from its document's date | this commit |
| F30 | **The seeded tenant never funded its bank account** (D17): cash read **−100,524.88**. An opening capital deposit precedes the first purchase; cash reads **+149,475.12** | this commit |
| F31 | **`employees.xlsx` and `items.xlsx` shipped with a required column blank on every row** (D16), so each rejected all of its own rows. The generator's rows now carry hire date and base unit code | this commit |
| F32 | **The branch selector filtered nothing** (D7) — the same failure F8 fixed for warehouses. Twelve branch-owned list routes now narrow; proven against a second branch that owns nothing | this commit |
| F33 | **The ETA queue had no producer** (D5): `enqueue` existed and nothing called it, so `/eta/submissions` could not hold a row. A confirmed sales invoice now queues one, and `check:seed`'s exemption is gone — 102 surfaces populated, 0 empty | this commit |
| F10 | `GET /items/:id` served `onHand: "0"` with `stockStubbed: true`, on a comment saying real figures arrive "once Phase 2 lands the movements ledger" — which it had | `46e527c` |

`pnpm lint` now fails on F2's whole class: `scripts/check-color-tokens.mjs`
checks every colour utility against the compiled stylesheet.

`pnpm scenarios` now fails on the approvals, scope, lifecycle and report-total
classes: the executable suite asserts the FIXED behaviour, so a regression in
any of F18–F33 turns it red. The four assertions still failing are the four
defects still open above — deliberately, so the register and the suite agree.

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
