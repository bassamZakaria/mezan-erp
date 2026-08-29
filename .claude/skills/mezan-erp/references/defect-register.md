# Defect register — what broke, and the shapes it broke in

`docs/ROADMAP.md §5` is the register and the authority; this page is the distilled
pattern behind it. Read its OPEN table before any test run — those defects will
appear, and re-filing a known one buries whatever is actually new. Update it in the
same commit as any fix, and never delete a fixed row: a fixed defect is how its
regression is recognised. `pnpm scenarios` asserts the fixed behaviour, so the suite and the register
agree. Two styles live in it and they mean opposite things: `cross-module` and
most suites assert the FIXED behaviour (a failure is a defect), while `seams`
historically asserted the BROKEN behaviour as documentation (a pass was the
defect). Every such inverted assertion has now been rewritten, so a green suite
means green — but if you add one, label it and flip it the moment it is fixed.

Report **measured** evidence. "Off by exactly 122.00" is a defect report;
"reconciliation looks wrong" is a feeling.

## Open (as of 2026-08-25 — re-read `docs/ROADMAP.md §5`, it is the authority)

**D1–D37 are all closed**, and `pnpm scenarios` passes with all four invariants
at exactly zero on the seeded tenant: trial balance, inventory vs GL 1200, AP vs
GL 2100, AR vs GL 1105.

**Two are open**, both found on `main` during that same sweep and neither part
of it — re-read `docs/ROADMAP.md §5` for their evidence:

- **D38** — a quote or invoice line accepts ANY `itemId` string; no route checks
  it against the item catalogue, so an invented id posts a 201.
- **D42** — a landed cost credits AP with no supplier dimension, so the payable
  exists in the ledger and on no supplier's account (2,500.00 on the seed).

Read a closed row as "found and written down and fixed", not "the product is
clean". The next defect gets found the way these did — seed, drive, and compare
two numbers that must agree.

Open by DECISION, not by patch: workflow `minAmount` is configurable but never
enforced (`DocumentWorkflowInput` carries no amount to compare), and
email/WhatsApp notification channels are modelled but unimplemented.

Settled against the live reference product: its invoice-level "Collect" requires
a treasury account and applies against invoices, i.e. it IS a receipt voucher.
Mezan's collect action now does the same, so no path records a payment the
ledger never hears about.

## What the sweep changed that you will trip over

- **The reconciliation follows the VOUCHER, not the allocation.** An allocation
  says which invoice cash belongs to; it does not move the GL a second time.
  Cheques and refunds move the control accounts too, and the sub-ledger counts
  them.
- **The stock ledger has a value-only movement.** A landed cost appends one and
  rebuilds the position; `replay()` values an issue at the cost the LEDGER
  recorded, not a recomputed average, so `cacheDrift` means cache corruption
  again rather than entry order.
- **The GL posts before the stock moves** on a purchase-invoice confirm. There
  is no transaction around it, so ordering is the only atomicity there is.
- **Every stock-adjustment reason posts.** New COA leaves: 5070 shrinkage, 5080
  inventory cost variance, 3200 opening-balance equity, 2210 withholding tax.
- **Two new locks on posting:** a filed VAT period refuses a backdated entry
  (amend the filing first, with a reason), alongside the fiscal-period gate.
- **Read routes narrow.** `.view_own` sees only your own; `view_cost` and
  `hr.employee.view_salary` omit their fields rather than nulling them.
- **`matchesSearch` is the one Arabic-forgiving matcher**, used by the server's
  `?q=` and by the screens. Do not hand-roll `toLowerCase().includes` again.

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
- **Ten of the first twelve "failures" in a new scenario suite were the suite's own
  errors** — an envelope not unwrapped (`{config:…}`, `{events:…}`), a field that does
  not exist (`lineTotal`), a journal entry looked up by the wrong id (purchase invoices
  do not reuse the document id), a float sum compared against per-line rounding, and an
  assertion that ignored the auto-reversal it had just asked for. Probe the real
  response shape with a throwaway script *before* writing assertions.
- **An assertion that passes alone and fails in the full run** is usually a claim about
  global state. "Every audit row has a null branch" held for one suite and broke once
  another suite wrote rows with real branches. Scope every claim to the rows the
  scenario itself created.
- **"Report X is missing"** — twice it was built, routed and in the nav; `STATUS.md` was
  simply wrong, and three reports stayed blocked on false claims in it. Verify the
  running app before trusting a status document, including this project's own.
