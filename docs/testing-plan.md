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

## Known open defects — read `defects.md` first

**`docs/defects.md` is the register.** Read its OPEN table before you start: those
defects will show up in this run, and re-filing one as a new finding buries
whatever is actually new. Its NOT A DEFECT table lists readings that look like
bugs and are not — including the measurement traps below.

**Update `defects.md` before you finish**, in the same commit as any fix. A
register that lags behind the code is how a real regression gets waved through
as "oh, that's the known one".

What that means for this run, from the currently-open list:

- `مطابقة الأرصدة` **will** show an AR mismatch (D1). Inventory and AP should be
  exact; if inventory is not, that IS new — report it.
- `/reports/inventory/drift` **will** show spurious rows (D4).
- Do not "fix" the numbers by confirming a physical count or completing a work
  order — D2 and D3 mean either genuinely unbalances the books.

---

## What the defects found so far actually teach

Every entry in `defects.md` was found by one of a small number of moves. These
are the moves — apply them first, because they have the highest yield per minute
spent.

**1. Never trust a number the client supplied.** The worst defect found — the
same goods returnable over and over — existed because the server validated a
quantity against a cap that arrived *in the same request body*. It sat behind a
correct-looking domain check. For any limit, ask: *who computed this number?*
If the answer is "the caller", it is not a limit.

**2. A feature can be fully built and simply not wired.** The warehouse selector
sent its header, the resolver parsed it, and no route read it. The approval gate
built its request and dropped it on the floor. The ETA queue has an `enqueue`
nothing calls. In each case every piece existed and one connection did not — so
reading the code convinces you it works. **Only driving it end to end finds
these.**

**3. Two numbers that should agree are worth more than either alone.** The
sub-ledger against its control account caught four defects. A single figure looks
plausible; a pair that must match cannot hide a discrepancy. Prefer an assertion
that cross-checks two independently-computed values.

**4. Empty screens hide everything.** The approvals note field had no accessible
name for as long as the inbox had no rows. Sweeps had passed that screen and
called it clean. This is why Phase 0 is a hard gate.

**5. When a defect is found, look for its twin.** Sales returns and purchase
returns had the identical hole; fixing one would have left the other facing
suppliers. After every fix, grep for the same shape elsewhere.

**6. A stale comment is a defect report.** `GET /items/:id` served a hardcoded
zero behind "real figures wire in once Phase 2 lands the movements ledger" —
which had landed. Comments promising future work are worth checking against the
present.

**7. Distrust your own instrument first.** A run reported 86 contrast failures;
all 86 were one alpha-parsing bug. Before filing anything that appears
everywhere, verify one instance by hand. An identical finding on every screen is
almost always the measurement, not the product.

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

## Phase 3 — Behaviour that matters

Automation proves a control reacts. It cannot prove it did the *right* thing.

**Run the executable suite first:**

```bash
pnpm scenarios
```

It boots a seeded backend in-process and drives the same HTTP routes the UI
calls, asserting what documents actually did to stock and to the ledger. Every
scenario is bracketed by the books — trial balance balances, inventory and AP
still reconcile — so a document that quietly posts nothing fails immediately.

This exists because it works and browser automation kept stalling: the API path
found and proved five real defects in one evening, including one that let the
same goods be returned repeatedly. Start here, then spend the manual time on
what it genuinely cannot see.

**What it cannot see, and stays manual:** layout, focus rings, RTL mirroring,
keyboard handling, contrast, whether a control is reachable at all. A route can
be perfect while no button calls it.

**The written scenarios** are `docs/scenarios/01..08` — 964 numbered scenarios
covering every screen, button, filter, modal and error path, with 222
`[NOT IMPLEMENTED]` markers where the build diverges from the captured catalog.
`testing-scenarios.md` holds the 29 headline lifecycles. Work the manual pass
from those.

The generic checks below apply to every list screen and are what the scenarios
assume already works.

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
