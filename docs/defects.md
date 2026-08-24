# Mezan — defect register

**The single list of known defects.** Every test run reads this before starting
and updates it before finishing. Nothing else tracks defects — if it is not
here, it is not tracked.

Updated 2026-08-24.

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
| D6 | Webhooks | Delivery retries outlive backend shutdown | `TypeError: The database connection is not open` from `WebhookDispatcher.record` after the store closes | Low |

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

### D6 — webhook retries outlive shutdown

The dispatcher's bounded retry keeps running after the backend closes its store,
then throws on recording the attempt. `pnpm smoke` still passes, but it prints
stack traces that look like failures. In a real shutdown the delivery record for
the final attempt is lost.

---

## Fixed

| # | Defect | Fixed by |
|---|---|---|
| F1 | AR and AP sub-ledgers ignored returns and landed costs, so the GL moved and the sub-ledger stood still — every tenant that posted a return saw a false mismatch | `0717a47` |
| F2 | `text-on-brand` named a token that does not exist, so the selected financial-statement tab rendered near-black on dark teal at **1.52:1** | `1aa6a51` |
| F3 | Server parameter-validation errors were swallowed — an invalid date left the report sitting on its placeholder with no message | `274f53e` |
| F4 | 11 form fields had no accessible name; three EntityPickers hand-rolled a caption div instead of using the component's own `<label for>` | `fff206f` |
| F5 | Label printing had no page `h1`; cost-centre P&L rendered a second, empty one | `9f17f28` |
| F6 | The approvals note field had no accessible name — found the first time the inbox had a row to test | this commit |

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
