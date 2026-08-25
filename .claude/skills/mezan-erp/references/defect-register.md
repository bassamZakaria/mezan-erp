# Defect register — what broke, and the shapes it broke in

`docs/defects.md` is the register and the authority; this page is the distilled
pattern behind it. Read its OPEN table before any test run — those defects will
appear, and re-filing a known one buries whatever is actually new. Update it in the
same commit as any fix, and never delete a fixed row: a fixed defect is how its
regression is recognised. `pnpm scenarios` asserts the fixed behaviour, so the suite
and the register agree — the assertions still failing are exactly the defects still
open.

Report **measured** evidence. "Off by exactly 122.00" is a defect report;
"reconciliation looks wrong" is a feeling.

## Open (as of 2026-08-24 — re-read `docs/defects.md`, it moves)

| # | Area | Defect | Evidence |
|---|---|---|---|
| D1 | Treasury / AR+AP | `recordPayment` and the allocation sub-ledger are **two stores of the same fact**; a confirmed collection never moves the invoice's `amountPaid` | `VCH-DEMO-1` collects 6,279.12 and credits AR; invoices still report `amountPaid: 0`. AP stands 35,554.00 above GL 2100 |
| D2 | Inventory / GL | A `PHYSICAL_COUNT` adjustment moves stock with **no journal entry** — `adjustmentGlAccountsForReason` maps only `INITIAL_STOCK` | inventory off by exactly 122.00 |
| D3 | Manufacturing / GL | `completeWorkOrder` posts to 1220 / 1210 / 5110 / 5210, never GL 1200; `accountBalance` has no subtree rollup | off by exactly 80.00 |
| D13 | Fixed assets | No disposal action — the status value and the permission exist, the route and button do not | |
| D18 | Inventory reporting | A landed cost writes **no stock movement**, so `replay()` can never reproduce the snapshot it mutated | ITEM-DEMO-1 cached 146.827936 vs recomputed 140.000000, on a healthy tenant, while the field's own docstring says nonzero means "the cache is CORRUPTED" |
| D19 | Dashboard / reports | `gl.receivables` and the customer-aging report disagree by 5,486.12 | the tile sums every 11xx asset account (incl. the credit-natural provision 1190, sign-flipped); aging covers trade AR only. 47,079.28 vs 52,565.40 — a scope question, not arithmetic |

Also open by decision, not by patch: workflow `minAmount` is configurable but never
enforced (`DocumentWorkflowInput` carries no amount to compare), and email/WhatsApp
notification channels are modelled but unimplemented.

**The demo seed steers around D2 and D3** — its two physical counts net to zero and no
work order is ever completed. The demo data is therefore not evidence those paths are
sound; it is evidence they were avoided. Seed data that dodges an unproven path is
itself a finding.

## Fixed — the shapes, because they recur

Money and postings:

- **A goods receipt could be invoiced twice** — create checked the receipt's status but
  not its `invoiced` flag, posting a duplicate Dr Inventory with no stock movement.
  The flag and the error already existed; cancel used them, create did not.
- **A landed cost with several target lines overcounted its own total N times** in the
  AP sub-ledger, because `costItems` is denormalized onto every line and the
  reconciliation summed per line instead of per document — a bug inside an earlier fix.
- **A negative invoice-level discount inflated the total**: line discounts were
  validated 0–100, the invoice-level one not at all, so 950.00 became 1,140.00.
- **The dashboard's VAT tile summed both tax sides** — a figure with no accounting
  meaning — showing 24,983 due while the VAT return showed 12,072.20 refundable.
- **The comparative income statement's prior column was always zero on the route the
  UI calls**, because the GL query was bounded to the current period; it looked correct
  because it was verified on a different, unbounded route.
- **AR/AP sub-ledgers ignored returns and landed costs**, so the GL moved and the
  sub-ledger stood still, and `remainingBalance` never subtracted confirmed returns.
- **Stock movements were dated by the wall clock on confirm** but by the document date
  elsewhere, so a replay consumed stock before the receipt that funded it.

Limits and gates:

- **The same goods could be returned repeatedly** — both return routes validated the
  quantity against an `availableQty` supplied *in the request body*. 40 invoiced, two
  returns of 40, both confirmed.
- **The warehouse selector filtered nothing**, then filtered nothing *again* on the
  document-layer routes the adjustments and transfers screens actually call after the
  raw-engine routes were fixed. The branch selector had the identical hole.
- **An admin rejecting someone else's request approved it** — the admin branch never
  read `input.decision`.
- **An approved request never posted its document** — every confirm re-submitted a
  fresh request over the standing one, discarding the approval just granted.
- **A workflow gate wired to a resolver that always returned null**, and a seeded chain
  whose service was never given the gate at all: configured approvals had no effect.
- **HR reported a disbursement done while its treasury voucher sat unapproved** — the
  run went مصروف with no cash moved and no journal entry.
- **Approving leave drove the balance negative**; **a project's status was never
  guarded** (any status reached any other); **RFQs/POs/purchase invoices stamped
  `"MAIN"` / `"MAIN-WH"`**, ids that exist in no tenant this app seeds.

Silence and stale claims:

- **A misspelled Tailwind colour token emits no CSS at all** — `text-on-brand` names
  nothing, so an active tab rendered at 1.52:1 while passing typecheck, lint, build and
  2,400 tests. `pnpm lint` now checks every colour utility against the compiled
  stylesheet.
- **Server parameter-validation errors were swallowed** — an invalid date left the
  report on its placeholder — first for the 7 statements, then for the other 22.
- **A document held for approval was permanently stuck**: the gate built its request in
  memory and discarded it.
- **The ETA queue had no producer**: `enqueue` existed, nothing called it.
- **Webhook retries outlived shutdown**, waking against a closed store.
- **`GET /items/:id` served a hardcoded `onHand: "0"`** behind a comment saying real
  figures arrive "once Phase 2 lands" — Phase 2 had landed.
- **Every domain state-machine refusal reached the Arabic UI in English**, naming raw
  status codes, and the payroll exclusion embedded the literal code `"hourly"`.
- **The seeded tenant never funded its bank account**: cash read −100,524.88.
- **Two shipped import fixtures had a required column blank on every row**, so each
  rejected all of its own rows.
- Accessibility defects hid behind empty screens: 11 unnamed form fields, a page with
  no `h1`, and a note field found only once the approvals inbox had a row.

## Not a defect — measurement traps

Kept so nobody rediscovers them:

- **86 screens at contrast 1.00** — the script returned alpha 1 for any `color(...)`,
  ignoring `/ 0.22`, and compared the sidebar's brass badge text against brass. One
  parsing bug, one badge, 86 identical false findings.
- **Zebra rows all failing** — `color-mix()` resolves to `color(srgb 0.96 …)`, 0–1, not
  0–255.
- **Avatar monograms at 1.04:1** — a gradient has no single colour to measure. Skip it.
- **`/profile` 404** — it returns the *caller's* record; the probe sent a nonexistent id.
- **`/inventory/drift` 400** — it requires `itemId` and `warehouseId`.
- **Blank dashboard screenshot** — a hidden tab can paint blank while the DOM is full.
  Assert on the DOM, never the picture.
- **"Report X is missing"** — twice it was built, routed and in the nav; `STATUS.md` was
  simply wrong, and three reports stayed blocked on false claims in it. Verify the
  running app before trusting a status document, including this project's own.
