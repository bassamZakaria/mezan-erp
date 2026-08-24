# Mezan — full regression test plan

**Run this after any large change.** It exists so testing finds real defects
instead of burning hours re-confirming that empty screens are empty.

Automated business-logic tests are disabled by decision (`testing-policy.md`).
This plan is the replacement, and it is deliberately mechanical: every phase
states what is measured, what counts as a pass, and what a false result would
look like.

---

## Before anything: the two rules that make results trustworthy

**1. Never test an empty screen.** A button on a screen with no rows cannot be
proven to work — it has nothing to act on. Phase 0 exists to guarantee data, and
a screen that is still empty afterwards is itself the finding.

**2. One tester, one backend, one database, one browser tab.** Two testers
sharing a tab produce *confidently wrong* results: while A measures screen X, B
navigates to Y, and A records Y's DOM under X's name. This happened, and the
resulting 72-screen report had to be thrown away. Parallelism is allowed only
under the isolation rule in Phase 4.

---

## Phase 0 — Environment and data

```bash
pnpm typecheck && pnpm lint && pnpm build      # must be clean before testing anything
pnpm smoke                                      # boots, seeds, hits every read surface
```

Then a **fresh** database — never a reused one, since a previous run's writes
change what later phases see:

```bash
S=$(mktemp -d)
MEZAN_SEED_DEMO=1 MEZAN_DB=$S/test.db PORT=3300 pnpm exec tsx apps/server/src/index.ts &
cd apps/web && MEZAN_API_URL=http://127.0.0.1:3300 pnpm exec vite --port 5300 --host 127.0.0.1 &
```

Log in as `محمد الشهابي`, PIN `1234`.

**Gate — no list surface may be empty.** Run the coverage check:

```bash
pnpm exec tsx scripts/check-seed-coverage.ts
```

It hits every list endpoint and reports which return zero rows. **Any empty
surface is a finding**, either a seeding gap or a broken route. Fix it before
continuing — testing past this point tests nothing.

Fixtures for import screens live in `test-fixtures/` (see its README).

---

## Known open defects — do not re-report these as new

These are real, measured, and already recorded. A test run will hit them. Note
that you saw them and move on; re-filing them as fresh findings buries whatever
is actually new.

Each was found by seeding every screen — none is visible on an empty tenant.

1. **A confirmed collection voucher never moves the invoice's `amountPaid`.**
   `VCH-DEMO-1` collects **6,279.12** and credits AR in the GL, while every
   invoice still reports `amountPaid: 0`. The AR sub-ledger derives from
   `grandTotal − amountPaid`, so it overstates by the full collection. This is
   the `recordPayment`-vs-allocations split — two stores of the same fact — now
   with a reproduction.

2. **A `PHYSICAL_COUNT` adjustment moves stock with no journal entry.**
   `adjustmentGlAccountsForReason` maps only `INITIAL_STOCK`, so a count
   variance changes the sub-ledger and never the control account. Measured at
   exactly **122.00** off for a single-sided count. The demo seed nets its two
   counts to zero to work around this — which means **the demo data is not
   evidence this path is sound**.

3. **`completeWorkOrder` never touches GL 1200.** It posts to 1220 and to
   1210 / 5110 / 5210, leaving inventory off by exactly **80.00** at BOM-DEMO-1
   qty 10. No work order in the seed is completed, for this reason — so this
   path is likewise unproven by the demo data.

4. **`occurredAt` is stamped `now()` rather than the document date** on
   purchase and sales confirms, while document-dated movements carry a plain
   calendar date. The drift report replays each position in `occurred_at` order
   and therefore consumes stock before the receipt that funded it, reporting a
   gap that is not real. Verified analytically:
   `valueDiff 2400 = 120 × (160 − 140)`, the average you get when a 2026-08-12
   transfer OUT replays ahead of a 2026-07-06 purchase IN. **The WAC snapshots
   themselves are correct** — reconciliation against the GL is exact.

Consequences for a test run:

- `مطابقة الأرصدة` **will** show an AR mismatch, from (1). Inventory and AP
  should be exact; if inventory is not, that IS new — report it.
- `/reports/inventory/drift` **will** show non-empty spurious rows, from (4).
- Do not "fix" the numbers by confirming a count or completing a work order —
  (2) and (3) mean either will genuinely unbalance the books.

Remove an entry from this list the moment its defect is fixed. A stale
do-not-report list is how a real regression gets waved through.

---

## Phase 1 — Reachability and integrity (automated, ~10 min)

One pass over every screen in the nav, measuring:

| Check | Pass condition |
|---|---|
| Screen renders | exactly one non-empty `<h1>` |
| Console | no errors, no unhandled rejections |
| Network | no 4xx/5xx |
| Layout | `document.body.scrollWidth <= innerWidth` (no horizontal scroll) |
| Contrast | every text node ≥ 4.5:1, or ≥ 3:1 at ≥24px / ≥18.66px bold |
| Labels | every input, select and textarea has an accessible name |
| Placeholders | no «قريباً» outside HR |

Run in **both themes** and **both locales** (ar/RTL and en/LTR).

**Known measurement traps**, all of which have produced false results here:

- `color-mix()` resolves to `color(srgb 0.96 …)` — values are 0–1, not 0–255.
  Scale them or every zebra row reads as a contrast failure.
- **`color(srgb r g b / 0.22)` carries its alpha after a slash.** A helper that
  returns alpha 1 for anything starting `color(` treats a 22%-translucent brass
  badge as opaque brass and compares brass text against brass — reporting
  ratio 1.00 on every screen that shows the sidebar. This produced 86 identical
  false findings in one run. Parse the alpha, or skip the element.
- An element over a gradient has no single background colour. Skip it rather
  than guessing; the brass avatar monograms are fine and will otherwise report
  at 1.04:1.
- A background tab clamps `setTimeout` to ≥1s and eventually to once a minute.
  Either keep a CDP call in flight or expect a sweep to stall silently.
- A screenshot of a hidden tab can come back blank while the DOM is fully
  populated. Assert on the DOM, not the picture.

---

## Phase 2 — Every control does something (automated, ~20 min)

For each screen, activate every enabled control and record whether the app
reacted — a DOM mutation, a network call, a navigation, or a dialog.

A control that produces **none** of those is a candidate dead control.

**Expected non-reactions — not defects:**
- An already-selected toggle, tab or filter chip (`aria-pressed=true`,
  `aria-selected=true`, `aria-current`, or the active brand-filled style).
- A disabled control.

Stub `window.confirm/alert/prompt` **before** the first click. A native dialog
blocks the automation channel and ends the session.

Every candidate must then be **confirmed by hand** before being reported. The
automated signal is a shortlist, not a verdict.

---

## Phase 3 — Behaviour that matters (manual, per module)

Automation proves a control reacts. It cannot prove it did the *right* thing.
For each module, one pass:

**Filters** — apply each filter and confirm the row count actually narrows and
the remaining rows match the criterion. Clear it and confirm the count returns.
A filter that changes nothing, or that empties a list it should narrow, is a
defect.

**Search** — type a value known to match one row; confirm exactly that row
survives. Type nonsense; confirm the empty state appears rather than a blank
table.

**CRUD** — for each entity:
1. **Create** through the UI. **Reload the page** and confirm it persisted.
   Reloading is not optional — it is what catches "works until you look again".
2. **Read** — open the detail; confirm every field matches what was entered.
3. **Update** — change a field, save, reload, confirm.
4. **Delete/void** — confirm it disappears, and that a document that should be
   *voided* rather than deleted is voided, leaving its trail.

**Documents** — draft → confirm → (return/cancel). After each confirm check the
side effects the document claims: stock moved, the GL entry balances, the
allocation appears. A confirm that posts nothing is the defect this app is most
prone to.

**Money** — after any document-affecting change, the trial balance must still
balance and the inventory sub-ledger must still reconcile to its GL control
account exactly. Check both before and after.

---

## Phase 4 — When parallelism is allowed

Parallel testing is permitted **only** when each tester has its own:

- backend port **and its own database file**,
- web dev-server port,
- browser tab.

Sharing any one of those produces false passes and false failures. With full
isolation, split by module — never by screen within a module, since module state
is shared through the ledger.

If that isolation cannot be arranged, run sequentially. A slow true answer beats
a fast wrong one.

---

## Phase 5 — Report

Every finding needs: screen, control, what was expected, what happened, and the
evidence (console text, network status, the two numbers that disagree).

Explicitly list **what was not covered**, and why. A report that implies full
coverage it did not have is worse than a short one.

Re-run Phase 0's gate at the end: if the test run itself wrote data that broke
reconciliation, that is a finding too.
