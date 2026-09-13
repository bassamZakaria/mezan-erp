# Mezan — testing: the policy, the plan and every scenario

**The single testing document.** It holds three things that used to sit in twelve files:
the standing policy on what is and is not run (§1), the mechanical regression plan to work
through after any large change (§2–§3), and **1,686 numbered scenarios** covering every
screen, control, filter, modal and error path in the product (§5 onward).

Companion: `ROADMAP.md` — what is built, what is open, which defects are known and which
decisions are still waiting on a human. Read its open-defect list before a run; update it
in the same commit as any fix.

---

## Contents

| § | Part | Scenarios | ID scheme |
|---|---|---|---|
| 1 | Policy — every layer runs, and what each one owns | — | — |
| 2 | The regression plan — phases 0 to 5 | — | — |
| 3 | What the defects found so far actually teach | — | — |
| 4 | Conventions every scenario below assumes | — | — |
| 5 | Sales | 214 | `SALES-001…` |
| 6 | Purchases | 155 | `PUR-nn`, `PUR-XXX-nn` |
| 7 | Inventory and manufacturing | 250 | `INV-001…` |
| 8 | Accounting and treasury | 262 | `ACC-001…` |
| 9 | HR and payroll | 243 | `EM-`, `PAY-`, `LR-`, … |
| 10 | CRM, projects, assets, field sales, installments | 131 | `CRM-`, `PRJ-`, `AST-`, … |
| 11 | Platform and settings | 202 | `PLT-nn`, `PLT-XXX-nn` |
| 12 | Shell, dashboard and reports | 43 | `SHL-`, `DSH-`, `RPT-` |
| 13 | Cross-module seams | 67 | `X0…X67` |
| 14 | Posting trails — end to end, one per part | 76 | `T01…T76` |
| 15 | Reference-parity pass | 43 | `PAR-011…` |

Parts 5–15 are the previous `§5..10` files, merged unchanged. Their internal
cross-references (`see SALES-042`, `X18`, `T13`) still resolve, because the IDs did not move.

---

# 1. Policy — automated test execution is required again

**Reversed 2026-08-30, at the owner's instruction.** The 2026-08-23 decision to disable
automated tests is withdrawn. Automated tests run again, locally and in CI, *in addition to*
live verification in the running app — not instead of it.

## 1.1 The rule

- **Write tests for everything.** Unit, integration (HTTP route level), UI (Testing Library),
  end-to-end (Playwright), property-based and brute-force/abuse suites.
- **Run them.** `pnpm test`, `pnpm test:coverage`, `pnpm test:e2e` are real commands again.
- **Coverage is enforced.** `vitest.config.ts` carries thresholds; the gate fails below them.
- **Live verification still stands.** `pnpm smoke`, `pnpm check:seed`, `pnpm scenarios` and a
  real browser pass on a seeded backend remain required. A green unit suite has never been
  accepted here as proof that a screen works, and still is not.

## 1.2 Why both halves are needed

The 2026-08-23 note was right about what it observed: a live click-through found five
user-facing defects — a refresh that silently logged the user out, six dead dashboard
buttons, a dead command palette, no logout anywhere, and a fabricated notification badge —
that 2,080 passing unit tests did not catch, because each test asserted its own component's
contract rather than anything a user can do.

The correct conclusion was *add the user path*, not *drop the arithmetic guard*. §1.4 of the
old policy admitted the cost itself: GL balancing, weighted-average costing, landed-cost
allocation, fiscal-period gates and permission resolution were left unguarded. So the tests
return, and the way they are written changes:

- A test asserts **what a user or a caller can observe** — the posted journal entry, the
  stock ledger row, the HTTP response, the rendered screen after a reload — never a private
  helper's return value alone.
- Every money assertion checks **two numbers that must agree** (sub-ledger against its GL
  control account), because one plausible figure hides everything.
- Every fix to a defect in `ROADMAP.md` ships with a test that fails without the fix.

## 1.3 The layers, and what each one owns

| Layer | Command | Owns |
|---|---|---|
| Unit | `pnpm test` | pure domain arithmetic — Money, allocation, costing, tax, depreciation, payroll |
| Integration | `pnpm test` (`packages/api/**`) | HTTP routes against a real SQLite DB: status, body, and what the DB holds afterwards |
| UI | `pnpm test` (`apps/web/**`, `packages/ui/**`) | rendered screens, RTL, Arabic copy, keyboard paths, error and empty states |
| Property / fuzz | `pnpm test:fuzz` | invariants over generated input — balance, non-negative stock, exact allocation sums |
| Abuse / brute force | `pnpm test` (`*.abuse.test.ts`) | PIN brute force, lockout, replay, IDOR, injection, oversized payloads |
| E2E | `pnpm test:e2e` | the browser path a named persona actually walks |
| Executable scenarios | `pnpm scenarios` | seeded end-to-end money trails over the real HTTP surface |
| Manual | `docs/MANUAL-TEST-PLAN.md` | what only a human can judge — the persona walkthroughs |

## 1.4 Coverage targets

Enforced in `vitest.config.ts`, which fails the run below **80% statements, 80% lines, 80%
functions, 70% branches**. The goal set by the owner is **100%** of backend and frontend; the
thresholds are raised toward it as gaps close, never lowered to make a run pass. The current
tree measures **94.4% statements / 85.1% branches / 86.7% functions** — comfortably above the
gate, which is exactly why the gate is allowed to stay where it is rather than at the measured
figure: a threshold pinned to today's exact number breaks on the next file added with a
legitimately-untestable branch, and the gate exists to catch a regression, not to demand a
perfect score. `pnpm test:coverage` writes `coverage/` (lcov + HTML). Anything genuinely
untestable is excluded by an explicit path in the config with a reason, not by a lowered
threshold — see the `exclude` list in `vitest.config.ts` for what that currently covers
(demo-seed fixtures, and the Electron main/preload entry points that need a real Electron
runtime rather than vitest's `node` environment).

## 1.5 What a test may never do

- Assert a fabricated fixture that no seed or API could produce (see the no-mock-data rule).
- Assert the broken behaviour of an open defect without naming the defect id — and once the
  defect is fixed, the assertion is rewritten to what now holds, never deleted.
- Pass a limit, price or cost the server should compute. A test that supplies `availableQty`
  proves nothing; that is the exact shape of the worst defect this product has had.
- Write the boundary the code enforces into its own fixture. A "returns more than was
  invoiced" test that returns exactly the invoiced quantity never crosses the boundary and
  passes whether or not the guard exists.
- Compare money with `toBeCloseTo`. Money is a `bigint` at scale 1e-6; compare `.toString()`
  or `.scaled` exactly, or the test tolerates the rounding bug it was written to catch.
- Start from a zero balance. Zero to zero survives a dropped posting, a swapped sign and a
  transposed debit and credit. Open at a non-zero figure and assert before and after.
- Stand on `toBeDefined()`, `toBeTruthy()`, `not.toThrow()` or a bare `toHaveBeenCalled()` as
  its only assertion. Each of those is satisfied by almost every bug the test could meet.
- Assert that a document exists after an operation instead of asserting the numbers on it.

## 1.6 Coverage is evidence, not the goal

A covered line is a line that ran, which is not the same as a line whose behaviour is pinned.
The suite has twice reached a high percentage while containing tests that would have passed
through a real defect, so the percentage alone is not accepted as the answer.

**Before a test is considered done, name the bug that would make it fail.** If no such bug
can be named, the assertion is decoration and comes out.

**Mutation testing is how that claim is checked.** Introduce a plausible defect in the source
— an off-by-one, a flipped comparison, a dropped branch, a recomputed value where a recorded
one was meant — run the suite, and confirm it goes red. Then revert the source exactly. A
mutation that survives is a hole in the suite, and the fix is the test, never the report.

Two rounds of this on the domain packages have already found two survivors, both of them
false coverage in tests written during this pass:

- **Numbering.** No shipped sequence sets `annualReset`, so the annual-reset branch was never
  reached; deleting the reset entirely changed no test. It is now driven through the same
  override surface the settings screen writes to, and a seeded counter row proves the period
  key stays stable across an upgrade rather than merely agreeing with itself.
- **Weighted-average costing.** Every generated OUT movement recorded a zero unit cost, so
  the branch that leaves an issue at its **recorded** cost was dead, and both mutations of it
  passed. The generator now records real issue costs, and a backdated receipt inserted behind
  an existing issue must not restate what that issue already cost.

The same discipline applies to a test that guards known-broken behaviour: title it
`LIMITATION (Dxx): <what it does today>` and pin the wrong behaviour explicitly. A defect
dressed up as a happy path is worse than no test, because it makes the fix look like the
regression.

---

# 2. The regression plan

**Work through this after any large change.** It is deliberately mechanical: every phase
states what is measured, what counts as a pass, and what a false result would look like.

## 2.1 The two rules that make results trustworthy

**1. Never test an empty screen.** A button on a screen with no rows cannot be proven to
work — it has nothing to act on. Phase 0 exists to guarantee data, and a screen that is
still empty afterwards is itself the finding.

**2. One tester, one backend, one database, one browser tab.** Two testers sharing a tab
produce *confidently wrong* results: while A measures screen X, B navigates to Y, and A
records Y's DOM under X's name. This happened, and the resulting 72-screen report had to be
thrown away. Parallelism is allowed only under the isolation rule in phase 4.

## 2.2 Phase 0 — environment and data

```bash
pnpm typecheck && pnpm lint && pnpm build      # must be clean before testing anything
pnpm smoke                                      # boots, seeds, hits every read surface
```

Then a **fresh** database — never a reused one, since a previous run's writes change what
later phases see:

```bash
S=$(mktemp -d)
MEZAN_SEED_DEMO=1 MEZAN_DB=$S/test.db PORT=3300 pnpm exec tsx apps/server/src/index.ts &
cd apps/web && MEZAN_API_URL=http://127.0.0.1:3300 pnpm exec vite --port 5300 --host 127.0.0.1 &
```

**Sign in with `admin@cyag.example`, PIN `123456`.** The login field is the **email and only
the email** — matching the display name made "who can log in" a property of a field any
admin may edit, and two people sharing a name shared an account door. Older notes naming
`محمد الشهابي` / PIN `1234` are stale; where a scenario below still says that, read it as
the email login.

`123456` is a DEVELOPMENT credential and works only in a development process. A packaged
build seeds that fallback admin with a random, unprinted PIN (`resolveSeedAdminSecrets` in
`packages/backend/src/seed.ts`) and the owner claims the install through the first-run
wizard instead — every install sharing one published admin login was S7. Set
`MEZAN_SEED_ADMIN_PIN` to a six-digit string to pin it deliberately when testing a
packaged build. **This is a testing note, not a rollout guide** — `docs/INSTALL.md` is the
one a consultant follows at a client's counter, and it documents the same knob for a
scripted install.

`POST /bootstrap/admin` now refuses a SECOND call against an already-claimed tenant with a
bare 409 and no session (S1, hardened S17) — it used to hand back the existing admin's
session, so a script written against the old contract must fall back to `POST /auth/login`
on a 409. Test both a genuinely fresh install and a retry against one already claimed.

Five wrong PINs in a row lock an account for a minute, doubling to fifteen (S6, hardened
S19–S20 — see T69 item 2 for the per-account/per-source split and the unlock route). If a
sign-in starts answering `TOO_MANY_ATTEMPTS`, that is the lockout, not a broken login —
wait out `retryAfterSeconds` or use another account.

### Demo logins

Every seeded account signs in with its **email** and PIN **`123456`** (one PIN for all of
them on purpose — a demo whose logins each need a different code is a demo nobody signs
into twice). Passwords, where a screen asks for one, are `Mezan-demo-<local-part>`.

Use `admin@cyag.example` to see everything. Use one of the others to see what a *role*
sees — which is the only way to catch a screen that opens for someone who should not have
it, and the reason none of these accounts but two are company admins.

| Email (`@cyag.example`) | الاسم | Role | Scope |
|---|---|---|---|
| `admin` | محمد الشهابي | — company admin | all |
| `nadia.shafik` | نادية شفيق | — company admin | all |
| `tarek.mansour` | طارق منصور | `FINANCE_MANAGER` المدير المالي | all |
| `omar.hilal` | عمر هلال | `SUPERVISOR` مشرف المبيعات | all |
| `mona.abdelrahman` | منى عبد الرحمن | `ACCOUNTANT` محاسب | all |
| `rania.adel` | رانيا عادل | `PURCHASING_OFFICER` مسؤول المشتريات | all |
| `youssef.badr` | يوسف بدر | `TREASURY_CASHIER` أمين الخزنة | all |
| `sayed.gamal` | سيد جمال | `WAREHOUSE_KEEPER` أمين مخزن | all warehouses |
| `magdy.rashad` | مجدي رشاد | `WAREHOUSE_KEEPER` أمين مخزن | **Giza warehouse only** |
| `karim.fouad` | كريم فؤاد | `SALES_REP` مندوب مبيعات | all |
| `salma.fouad` | سلمى فؤاد | `VAN_SALES` مندوب توزيع | **van warehouse only**, linked to `EMP-DEMO-2` |
| `sameh.fathy` | سامح فتحي | `CRM_MANAGER` مسؤول علاقات العملاء | all |
| `hossam.nabil` | حسام نبيل | `BRANCH_MANAGER` مدير الفرع | **`BR-MAIN` only** |
| `dalia.saeed` | داليا سعيد | `HR_OFFICER` مسؤول شؤون العاملين | all — **no salary visibility** |
| `amir.zaki` | أمير زكي | `PAYROLL_OFFICER` مسؤول الرواتب | all — **holds the ⚠ salary codes** |
| `laila.ibrahim` | ليلى إبراهيم | `AUDITOR` مراجع داخلي | all — **read-only everywhere** |
| `hala.mostafa` | هالة مصطفى | `SALES_REP` | **deactivated — login must be refused** |

Four pairs are there to be compared, and comparing them is the test:

- **`sayed.gamal` vs `magdy.rashad`** — same role, different warehouse scope. Measured on
  the seeded tenant: 40 stock rows against 3. Anything they see identically is the scope
  not being read (D8).
- **`dalia.saeed` vs `amir.zaki`** — HR without and with the ⚠ sensitive salary
  permissions. `GET /hr/payroll/runs` is 403 for the first and 200 for the second.
- **`karim.fouad` vs `omar.hilal`** — `sales.invoice.view_own` against `.view_all`, the two
  halves of the visibility model.
- **`laila.ibrahim` vs anyone** — every code the auditor holds is a `.view`. A write that
  succeeds for them is the finding.

`SUPERVISOR` and `FINANCE_MANAGER` exist because the seeded approval chains
(`SALES_INVOICE_CONFIRM`, `PURCHASE_INVOICE_CONFIRM`) name those role codes. Signed in as
`omar.hilal`, the pending sales approval can be decided; as `karim.fouad` the same call is
refused 403.

**Gate — no list surface may be empty:**

```bash
pnpm exec tsx scripts/check-seed-coverage.ts
```

It hits every list endpoint and reports which return zero rows. **Any empty surface is a
finding**, either a seeding gap or a broken route. Fix it before continuing — testing past
this point tests nothing.

Fixtures for the import screens live in `test-fixtures/` (see its README).

The demo profile lives in `packages/backend/src/demo-seed.ts` and runs **only** when
`createBackend({ seedDemoData: true })` is passed — `apps/server` passes it solely on
`MEZAN_SEED_DEMO=1`, and `apps/desktop` never passes it, so a real install never receives it.

## 2.3 Read the open-defect list first

**`ROADMAP.md` §5 is the defect register.** Read it before you start: anything open there
will show up in this run, and re-filing a known defect as a new finding buries whatever is
actually new. As of 2026-08-29 **one is open** — D65, which fails 20 assertions in `pnpm scenarios`
because a user now needs an Arabic name and the harness does not send one. Expect those 20;
do not re-file them. D1 through D64 are closed, and that register with its fix commits is
archived at `archive/defect-register.md`, kept because a fixed defect is how its regression
is recognised.

Two things are open *by decision* rather than by patch, and are not defects to re-file:
outbound notification channels do not deliver (in-app only), and the API-key/webhook backend
has no consumer.

**Update `ROADMAP.md` before you finish**, in the same commit as any fix. A register that
lags behind the code is how a real regression gets waved through as "oh, that's the known
one".

Two seeded paths are deliberately steered around and so are **not** evidence of soundness:
the demo tenant's physical counts net to zero, and no work order is completed. Both keep the
books exact; neither proves the path works.

## 2.4 Phase 1 — reachability and integrity (automated, ~10 min)

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

- `color-mix()` resolves to `color(srgb 0.96 …)` — values are 0–1, not 0–255. Scale them or
  every zebra row reads as a contrast failure.
- **`color(srgb r g b / 0.22)` carries its alpha after a slash.** A helper that returns
  alpha 1 for anything starting `color(` treats a 22%-translucent brass badge as opaque
  brass and compares brass text against brass — reporting ratio 1.00 on every screen that
  shows the sidebar. This produced 86 identical false findings in one run. Parse the alpha,
  or skip the element.
- An element over a gradient has no single background colour. Skip it rather than guessing;
  the brass avatar monograms are fine and will otherwise report at 1.04:1.
- A background tab clamps `setTimeout` to ≥1s and eventually to once a minute. Either keep a
  CDP call in flight or expect a sweep to stall silently.
- A screenshot of a hidden tab can come back blank while the DOM is fully populated. Assert
  on the DOM, not the picture.

## 2.5 Phase 2 — every control does something (automated, ~20 min)

For each screen, activate every enabled control and record whether the app reacted — a DOM
mutation, a network call, a navigation, or a dialog. A control that produces **none** of
those is a candidate dead control.

**Expected non-reactions — not defects:** an already-selected toggle, tab or filter chip
(`aria-pressed=true`, `aria-selected=true`, `aria-current`, or the active brand-filled
style); and a disabled control.

Stub `window.confirm/alert/prompt` **before** the first click. A native dialog blocks the
automation channel and ends the session.

Every candidate must then be **confirmed by hand** before being reported. The automated
signal is a shortlist, not a verdict.

## 2.6 Phase 3 — behaviour that matters

Automation proves a control reacts. It cannot prove it did the *right* thing.

**Run the executable suite first:**

```bash
pnpm scenarios
```

It boots a seeded backend in-process and drives the same HTTP routes the UI calls, asserting
what documents actually did to stock and to the ledger. Every scenario is bracketed by the
books — trial balance balances, inventory and AP still reconcile — so a document that
quietly posts nothing fails immediately. Last full run, 2026-08-29: **3,856 passing, 20 failing** — the 20 are D65 in `ROADMAP.md`
§5.0, a contract change the harness never followed, and they reproduce identically on
`origin/main`. The four invariants are at exactly zero (trial balance, inventory vs GL 1200,
AP vs GL 2100, AR vs GL 1105).

This exists because it works and browser automation kept stalling: the API path found and
proved five real defects in one evening, including one that let the same goods be returned
repeatedly.

**What it cannot see, and stays manual:** layout, focus rings, RTL mirroring, keyboard
handling, contrast, whether a control is reachable at all. A route can be perfect while no
button calls it. Work the manual pass from parts 5–15 below.

The generic checks that follow apply to every list screen and are what those scenarios
assume already works.

**Filters** — apply each filter and confirm the row count actually narrows and the remaining
rows match the criterion. Clear it and confirm the count returns. A filter that changes
nothing, or that empties a list it should narrow, is a defect.

**Search** — type a value known to match one row; confirm exactly that row survives. Type
nonsense; confirm the empty state appears rather than a blank table.

**CRUD** — for each entity:

1. **Create** through the UI. **Reload the page** and confirm it persisted. Reloading is not
   optional — it is what catches "works until you look again".
2. **Read** — open the detail; confirm every field matches what was entered.
3. **Update** — change a field, save, reload, confirm.
4. **Delete/void** — confirm it disappears, and that a document that should be *voided*
   rather than deleted is voided, leaving its trail.

**Documents** — draft → confirm → (return/cancel). After each confirm check the side effects
the document claims: stock moved, the GL entry balances, the allocation appears. A confirm
that posts nothing is the defect this app is most prone to.

**Money** — after any document-affecting change, the trial balance must still balance and
the inventory sub-ledger must still reconcile to its GL control account exactly. Check both
before and after.

## 2.7 Phase 4 — when parallelism is allowed

Parallel testing is permitted **only** when each tester has its own backend port **and its
own database file**, its own web dev-server port, and its own browser tab. Sharing any one
of those produces false passes and false failures. With full isolation, split by module —
never by screen within a module, since module state is shared through the ledger.

If that isolation cannot be arranged, run sequentially. A slow true answer beats a fast
wrong one.

## 2.8 Phase 5 — report

Every finding needs: screen, control, what was expected, what happened, and the evidence
(console text, network status, the two numbers that disagree).

Explicitly list **what was not covered**, and why. A report that implies full coverage it
did not have is worse than a short one.

Re-run phase 0's gate at the end: if the test run itself wrote data that broke
reconciliation, that is a finding too.

---

# 3. What the defects found so far actually teach

Every entry in the closed defect register was found by one of a small number of moves. These
are the moves — apply them first, because they have the highest yield per minute spent.

**1. Never trust a number the client supplied.** The worst defect found — the same goods
returnable over and over — existed because the server validated a quantity against a cap
that arrived *in the same request body*. It sat behind a correct-looking domain check. For
any limit, ask: *who computed this number?* If the answer is "the caller", it is not a limit.

**2. A feature can be fully built and simply not wired.** The warehouse selector sent its
header, the resolver parsed it, and no route read it. The approval gate built its request
and dropped it on the floor. The ETA queue had an `enqueue` nothing called. In each case
every piece existed and one connection did not — so reading the code convinces you it works.
**Only driving it end to end finds these.**

**3. Two numbers that should agree are worth more than either alone.** The sub-ledger
against its control account caught four defects. A single figure looks plausible; a pair
that must match cannot hide a discrepancy. Prefer an assertion that cross-checks two
independently-computed values.

**4. Empty screens hide everything.** The approvals note field had no accessible name for as
long as the inbox had no rows. Sweeps had passed that screen and called it clean. This is
why phase 0 is a hard gate.

**5. When a defect is found, look for its twin.** Sales returns and purchase returns had the
identical hole; fixing one would have left the other facing suppliers. After every fix, grep
for the same shape elsewhere.

**6. A stale comment is a defect report.** `GET /items/:id` served a hardcoded zero behind
"real figures wire in once Phase 2 lands the movements ledger" — which had landed. Comments
promising future work are worth checking against the present.

**7. Distrust your own instrument first.** A run reported 86 contrast failures; all 86 were
one alpha-parsing bug. Before filing anything that appears everywhere, verify one instance
by hand. An identical finding on every screen is almost always the measurement, not the
product.

---

# 4. Conventions every scenario below assumes

Stated once here; each part then adds only what is specific to its domain.

- **Money and Qty** are scale-6 signed integers (`packages/domain/src/money/money.ts`,
  `qty.ts`). The UI renders them as decimals; digits render Arabic-Indic in `ar` and Latin
  in `en`.
- **Language and direction.** The top-bar toggle (`packages/ui/src/shell/Topbar.tsx`) flips
  locale and RTL/LTR live, with no reload. Rather than duplicate every scenario in both
  languages, each screen section ends with one explicit "run in English/LTR" scenario.
- **"Today"** is **2026-08-24** unless a scenario says otherwise. Seeded due dates and quote
  expiries are set relative to it; a scenario needing an overdue invoice or an expired quote
  says so and creates one.
- **Navigation is hash-based.** There are no per-screen URLs in the reference sense — the
  shell routes on the hash, so a scenario names the nav path, not a URL.
- **`[NOT IMPLEMENTED]`** marks catalog behaviour this build does not have. Run it once to
  confirm the absence, note it, move on. It is not a bug to re-file every pass. There are
  **222** such markers across the parts below.
- **`[AHEAD]`** marks a place where this build does more than the reference — report export
  is the common one. Not a defect either.
- **Seed data** comes from `packages/backend/src/demo-seed.ts` and `demo-seed/*.ts`. Each
  part restates the slice it depends on, with the exact figures its assertions use.

---

# 5. Sales


### Sources

- `docs/archive/catalog/01-sales.md` — capture of the reference product's running UI (what the product is *supposed* to do).
- Actual implementation, read in full: `apps/web/src/screens/CustomersScreen.tsx`, `SalesQuotesScreen.tsx`, `SalesInvoicesScreen.tsx`, `SalesReturnsScreen.tsx`, `PriceListsScreen.tsx`, `PromotionsScreen.tsx`, `apps/web/src/screens/hubs/SalesHubScreen.tsx`, plus `apps/web/src/nav-config.ts` and `apps/web/src/App.tsx` for routing/nav wiring.
- Domain/validation: `packages/domain/src/sales-invoices/*`, `packages/domain/src/sales-returns/*`, `packages/domain/src/promotions/promotion.ts`, `packages/domain/src/money/{money,qty}.ts`.
- Seed data: `packages/backend/src/demo-seed.ts`, `demo-seed/purchasing.ts`, `demo-seed/treasury.ts`, `demo-seed/platform.ts`.
- `ROADMAP.md` §5 — the six known open defects (D1–D6).

### Conventions used throughout

- **Money and Qty** are scale-6 signed integers (`packages/domain/src/money/money.ts`, `qty.ts`). The UI renders them as decimals; digits render Arabic-Indic in `ar` locale and Latin in `en` locale.
- **Language**: the top-bar language toggle (`packages/ui/src/shell/Topbar.tsx`) flips locale and RTL/LTR live, no reload. Rather than duplicate every scenario in both languages, each screen section ends with one explicit "run in English/LTR" scenario that re-checks labels, mirroring, and digit rendering; run any other scenario in both languages if you suspect a locale-specific regression.
- **"Today"** for these scenarios is **2026-08-24**. Every seeded invoice due date and quote expiry date in the base sales seed is still in the future as of this date — scenarios that need an overdue invoice or an expired quote say so explicitly and describe how to force one; don't assume one exists in fresh seed data.
- A scenario tagged **`[NOT IMPLEMENTED]`** describes catalog behavior this build does not have. Run it once to confirm the absence, note it, and move on — it is not a bug to re-file every pass.
- A scenario that touches a known defect cites its ID (**D1–D6**) so it isn't re-filed.
- IDs are `SALES-001`, `SALES-002`, … sequential across the whole document, grouped by screen in the order a user meets them in the sidebar (`سياق` order in `nav-config.ts`: نظرة عامة → العملاء → عروض الأسعار → فواتير المبيعات → مرتجعات المبيعات → قوائم الأسعار → العروض).

### Seed data this file relies on

**Customers** — `CUST-DEMO-1` شركة الأمل للتجارة (C-0001, 30-day terms, credit limit 50,000, no price list), `CUST-DEMO-2` مؤسسة النور للمقاولات (C-0002, 45-day terms, credit limit 120,000, price list `PL-DEMO-2` wholesale), `CUST-DEMO-3` مجموعة الفجر التجارية (C-0003, 15-day terms, credit limit 25,000, price list `PL-DEMO-3` distributor). All active.

**Items** (14% VAT flat) — `ITEM-DEMO-1` أرز أبيض ٥ كجم (180/140 sale/cost), `ITEM-DEMO-2` زيت عباد الشمس ١ لتر (95/72), `ITEM-DEMO-3` سكر أبيض ١ كجم (42/31), `ITEM-DEMO-4` شاي أسود ٥٠٠ جم (260/205), `ITEM-DEMO-5`/`6` configurable tea-blend products, `ITEM-DEMO-7` لبن كامل الدسم ١ لتر (38/27, batch+expiry tracked), `ITEM-DEMO-8` زبادي طبيعي ١٠٠ جم (12/8, batch+expiry tracked).

**Sales invoices** (all confirmed):

| Invoice | Customer | Date / Due | Lines | Subtotal | Tax | Grand total |
|---|---|---|---|---|---|---|
| `INV-DEMO-1` | CUST-DEMO-1 | 2026-08-04 / 2026-09-03 | 40×ITEM-1@180, 120×ITEM-3@42 | 12,240.00 | 1,713.60 | **13,953.60** |
| `INV-DEMO-2` | CUST-DEMO-2 (no salesperson) | 2026-08-11 / 2026-09-25 | 90×ITEM-2@95 | 8,550.00 | 1,197.00 | **9,747.00** |
| `INV-DEMO-3` | CUST-DEMO-3 | 2026-08-18 / 2026-09-02 | 12×ITEM-4@260, 15×ITEM-1@180 | 5,820.00 | 814.80 | **6,634.80** |
| `INV-DEMO-4` | CUST-DEMO-1 | 2026-08-20 / 2026-09-19 | 20×ITEM-4@260 (5,200 gross) | 4,680.00 after SUMMER10 | 655.20 | **5,335.20** |
| `INV-DEMO-5` | CUST-DEMO-1 (EMP-DEMO-2) | 2026-08-20 / 2026-09-19 | 60×ITEM-7@38, 300×ITEM-8@12 | 5,880.00 | 823.20 | **6,703.20** |
| `INV-DEMO-6` | CUST-DEMO-2 | 2026-08-14 / 2026-09-28 | converted from `SQ-DEMO-1` | — | — | ≈ **10,191.60** |

`INV-DEMO-4` crosses `PROMO-DEMO-1`'s (SUMMER10) 2,000 minimum on a scoped item, so it earned an automatic 10% line discount at confirm (`requiresCoupon: false`): 5,200 → 4,680.00 taxable → +655.20 tax → 5,335.20. `INV-DEMO-1` has two confirmed returns against it (`SRT-DEMO-1`, `SRET-DEMO-1`, see below) and one Treasury collection voucher (`VCH-DEMO-1`).

**Sales quotes** — `SQ-DEMO-1` (CUST-DEMO-2, price list PL-DEMO-2, 30×ITEM-1@168 + 100×ITEM-3@39 = 8,940.00 + 1,251.60 tax = **10,191.60**, sent → accepted → converted to `INV-DEMO-6`). `SQ-DEMO-2` (CUST-DEMO-3, price list PL-DEMO-3, 25×ITEM-4@232 = 5,800.00 + 812.00 = **6,612.00**, sent → rejected, expiry 2026-08-29 — not yet expired). `SQ-DEMO-3` (CUST-DEMO-2, price list PL-DEMO-2, 80×ITEM-2@88 = 7,040.00 + 985.60 = **8,025.60**, sent, still pending, expiry 2026-09-18). `SQ-DEMO-4` (CUST-DEMO-1, no price list — retail base prices, 60×ITEM-2@95 + 10×ITEM-4@260 = 8,300.00 + 1,162.00 = **9,462.00**, left as draft, never sent, expiry 2026-09-22).

**Sales returns** — `SRT-DEMO-1` (against `INV-DEMO-1`, item ITEM-3, reason DEFECTIVE, qty 20 of the invoice's original 120, confirmed, value 840.00 + 117.60 tax = 957.60). `SRET-DEMO-1` (against `INV-DEMO-1`, item ITEM-3, reason DEFECTIVE, qty 5, confirmed, value 210.00 + 29.40 = 239.40, seeded in a separate pass before `SRT-DEMO-1`). Together they return **25 of the original 120** units of ITEM-3 on `INV-DEMO-1` — true remaining returnable is **95**, worth **1,197.00** combined. `SRT-DEMO-2` (against `INV-DEMO-3`, item ITEM-4, reason WRONG_ITEM, qty 3 of 12, left as **draft**, never confirmed).

Every confirmed return is *always* "بانتظار دفع المبلغ" by definition — `isAwaitingRefund(doc) = doc.status === "confirmed"` (`packages/domain/src/sales-returns/sales-return-document.ts:88`). There is no further "settled" state in code; the badge never clears except by cancelling. `SRT-DEMO-1` and `SRET-DEMO-1` both carry it permanently as seeded.

**Price lists** — `PL-DEMO-1` (`PL-BASE`, قائمة الأسعار الأساسية, base=true, 4 lines). `PL-DEMO-2` (`PL-WHOLESALE`, قائمة أسعار الجملة, assigned to CUST-DEMO-2). `PL-DEMO-3` (`PL-DIST`, قائمة أسعار الموزعين, assigned to CUST-DEMO-3). `PL-DEMO-4` (`PL-SUMMER25`, عرض الصيف ٢٠٢٥, deactivated via API after creation — inactive, unassigned).

**Promotions** — `PROMO-DEMO-1` (code `SUMMER10`, خصم الصيف ١٠٪, percentage 10%, min invoice value 2,000, scoped to item ITEM-4, 2026-08-19 → 2026-12-31, `requiresCoupon: false`, active). As of 2026-08-24 it is **فعال** (5 days in, >7 days remain — not "قرب الانتهاء" yet).

### Two compounding gaps behind several assertions below

1. **D1** — a confirmed Treasury collection voucher never updates a sales invoice's `amountPaid`. Only the invoice's own **المدفوعات** tab (`POST /sales-invoices/:id/payments`) updates `amountPaid` correctly; it is a separate, working code path. `VCH-DEMO-1` collected ~45% of `INV-DEMO-1`'s outstanding balance through the *voucher* path — so `INV-DEMO-1.amountPaid` reads **0** everywhere despite that collection.
2. **Unreported finding** (not in `ROADMAP.md` §5, cite exactly if you confirm it) — a sales invoice's `remainingBalance` is computed server-side as `grandTotal − amountPaid` only (`packages/api/src/sales-invoices-routes.ts:132-134`); it never subtracts confirmed returns. Combined with D1, `INV-DEMO-1`'s "الرصيد المتبقي" is expected to keep reading the full **13,953.60** everywhere in the Sales Invoices screen, ignoring both its 1,197.00 of confirmed returns and its voucher-recorded collection. If you reproduce this live, record it as a new, distinct defect — do not fold it into D1.

---

### إدارة المبيعات (Sales Hub) — `/sales/hub`

The build differs from the catalog here: in this build `sales-hub` is a normal entry in the sidebar's `sales` nav group (`apps/web/src/nav-config.ts:24`) wired to a real `<a>`/`onClick` row (`packages/ui/src/shell/Sidebar.tsx`), not the dead toggle the catalog describes. Its Arabic label is **نظرة عامة** ("Overview" in English), not "إدارة المبيعات".

**SALES-001** — Sidebar link reaches the hub.
Pre: logged in, sidebar visible, "المبيعات" group expanded.
Steps: Click "نظرة عامة" under المبيعات.
Assert: Navigates to the hub screen (URL/screen key `sales-hub`); this is a real link in this build, unlike the reference product's non-clickable toggle.

**SALES-002** — Header content.
Steps: Load the hub.
Assert: Eyebrow "Sales", title "المبيعات", description mentioning فواتير وعروض أسعار وعملاء المبيعات — من البيانات الفعلية المسجّلة (or current copy) is shown.

**SALES-003** — Quick action "فاتورة مبيعات جديدة".
Steps: Click it.
Assert: Navigates to `/sales/invoices` and opens the "فاتورة مبيعات جديدة" create panel directly (via `useScreenIntent`).

**SALES-004** — Quick action "عرض سعر جديد".
Steps: Click it.
Assert: Navigates to `/sales/quotes` and opens the "عرض سعر جديد" create panel directly.

**SALES-005 / 006 / 007** — Quick actions "قوائم الأسعار" / "العروض والترويج" / "مرتجعات المبيعات".
Steps: Click each in turn.
Assert: Each navigates to its respective list screen (`/sales/price-lists`, `/sales/promotions`, `/sales/returns`) with no panel pre-opened.

**SALES-008** `[NOT IMPLEMENTED]` — No "عميل جديد" quick action.
Steps: Look at the quick-actions row.
Assert: Only 5 buttons exist (فاتورة مبيعات جديدة / عرض سعر جديد / قوائم الأسعار / العروض والترويج / مرتجعات المبيعات); the catalog's third quick-start button, "عميل جديد", does not exist anywhere on this page.

**SALES-009** — Stat card "فواتير المبيعات".
Pre: seed loaded (6 sales invoices total, including `INV-DEMO-6`).
Assert: Card reads 6.

**SALES-010** — Stat card "مبالغ مستحقة من العملاء".
Assert: Sums `remainingBalance` across confirmed/partially_paid invoices — since D1 means no invoice ever reaches partially_paid via a voucher, and `remainingBalance` never subtracts returns (see compounding-gaps note), this figure equals the plain sum of all 6 invoices' grand totals, not a true net-outstanding figure.

**SALES-011** — Stat card "عروض أسعار قيد الإرسال".
Assert: Counts quotes with `status === "sent"` only. `SQ-DEMO-1` converted, `SQ-DEMO-2` rejected, `SQ-DEMO-4` still draft — only `SQ-DEMO-3` is currently "sent", so the card reads **1**.

**SALES-012** — Stat card "عدد العملاء".
Assert: Reads 3.

**SALES-013** — "أحدث فواتير المبيعات" recent-activity list.
Assert: Shows the 5 most recent invoices by date descending (excludes the oldest of the 6, `INV-DEMO-1`, dated 2026-08-04), each row = customer name + date + docNo + Money total. No status pill per row (gap vs catalog).

**SALES-014** `[NOT IMPLEMENTED]` — No "مناطق العمل" tile grid.
Assert: There is no per-domain tile grid with individual links (فواتير المبيعات / عروض الأسعار / العملاء / مرتجعات المبيعات / قوائم الأسعار tiles, each with its own count and "عرض" link) — replaced entirely by the flat 4-card StatCard row above.

**SALES-015** `[NOT IMPLEMENTED]` — No quotes recent-activity sub-list, no "عرض الكل" links.
Assert: The catalog's second sub-list ("آخر العروض") does not exist; neither recent-activity block has a "عرض الكل" link anywhere on the page.

**SALES-016** `[NOT IMPLEMENTED]` — No conditional overdue-invoices attention banner.
Assert: Only a generic query-error card exists ("تعذّر تحميل بيانات المبيعات."); there is no banner that counts and deep-links overdue invoices.

**SALES-017** — Load-error state.
Pre: force one of the hub's queries to fail (e.g. simulate offline/network failure).
Steps: Load the hub.
Assert: "تعذّر تحميل بيانات المبيعات." card renders in place of the failed section.

**SALES-018** — Run in English/LTR.
Steps: Toggle the language switch in the top bar while on the hub.
Assert: Layout mirrors to LTR, all labels re-render in English, digits render in Latin numerals, no layout overflow/clipping.

---

### العملاء (Customers) — `/sales/customers`

**SALES-019** — Status chip "الكل".
Pre: 3 seeded customers, all active.
Steps: Open `/sales/customers`.
Assert: "الكل" chip reads 3 and all 3 rows show.

**SALES-020** — Status chip "نشط".
Steps: Click "نشط".
Assert: Count and rows both = 3 (every seeded customer is active).

**SALES-021** — Status chip "غير نشط" on an empty match.
Steps: Click "غير نشط".
Assert: Count = 0, table renders the empty state "لا يوجد عملاء مطابقون".

**SALES-022** `[NOT IMPLEMENTED]` — No "عملاء برصيد مستحق" chip or clickable KPI-filter behavior.
Assert: Only 3 status chips exist total (الكل/نشط/غير نشط); none of the 4 stat cards are clickable filters.

**SALES-023 / 024 / 025 / 026** — KPI strip values.
Assert: "إجمالي العملاء" = 3; "نشط" = 3; "إجمالي حدود الائتمان" = 50,000.00 + 120,000.00 + 25,000.00 = **195,000.00**; "إجمالي الأرصدة الافتتاحية" = sum of seeded opening balances (0.00, since none are set in the base seed). All four are static `StatCard`s — clicking does nothing (gap vs catalog's clickable KPI strip).

**SALES-027** — Search by name.
Steps: Type "الأمل" in the search box.
Assert: Only `CUST-DEMO-1` (شركة الأمل للتجارة) shows.

**SALES-028** — Search by code.
Steps: Type "C-0002".
Assert: Only `CUST-DEMO-2` shows (case-insensitive code match).

**SALES-029** — Search by phone.
Steps: Type "01223334455" (CUST-DEMO-3's phone).
Assert: Only `CUST-DEMO-3` shows.

**SALES-030** — Search with no match.
Steps: Type nonsense, e.g. "زذخيوب".
Assert: Empty state "لا يوجد عملاء مطابقون" shows.

**SALES-031** `[NOT IMPLEMENTED]` — No "تصفية النتائج" filter panel.
Assert: No phone / credit-limit-range / balance-range filter fields exist anywhere on this screen.

**SALES-032** — Column sort.
Steps: Click any column header (اسم العميل, الحد الائتماني, etc.).
Assert: Nothing happens — no column on this screen is sortable (the shared `sortable` flag is set on none of the 7 columns), unlike the catalog's implied sortable columns.

**SALES-033** — Pagination summary.
Steps: Observe the footer with all 3 customers loaded.
Assert: Reads "عرض 3 من 3 عميل" — not the catalog's "عرض 1 - N من N" range format — and there is no page-size selector; `page`/`pageCount` are hardcoded to 1/1 so the pager UI never renders even if more customers existed.

**SALES-034** — Row click opens detail.
Steps: Click the `CUST-DEMO-1` row.
Assert: Screen swaps in-place to the detail view (no separate URL/route change observed), header title "شركة الأمل للتجارة · C-0001", status pill "نشط".

**SALES-035** `[NOT IMPLEMENTED]` — No row action menu.
Assert: No per-row ⋮ menu or quick action exists on any row; only the whole row is clickable.

**SALES-036** — Open "إضافة عميل" dialog and check defaults.
Steps: Click the list's create button.
Assert: Dialog opens with الكود placeholder "تلقائي إذا فارغ", شروط الدفع (أيام) = 30, العملة = "EGP", الحد الائتماني = 0, نوع المشتري (ETA) = "تلقائي (منشأة إذا وُجد رقم ضريبي، وإلا فرد)"; إعفاء ضريبي off.

**SALES-037** — Required-field rejection.
Steps: Leave اسم العميل blank, click إضافة عميل.
Assert: Blocked; inline error "الاسم بالعربية مطلوب" shows; dialog stays open. This is the *only* client-validated required field on the whole form.

**SALES-038** — Auto-generated code, persists on reload.
Steps: Fill only اسم العميل ("عميل اختبار ١"), leave الكود blank, save.
Assert: New customer created with an auto-generated code following the pattern `C` + zero-padded sequential count (e.g. `C000004` as the 4th customer). Reload the list — the new customer and its generated code both persist.

**SALES-039 / 040** — Negative numeric fields rejected.
Steps: In the create dialog, try to set شروط الدفع (أيام) and separately الحد الائتماني to a negative value.
Assert: Both `NumberField`s carry `min={0}` — a negative value cannot be entered/committed in either.

**SALES-041** — Very large credit limit accepted.
Steps: Set الحد الائتماني to 999,999,999, save.
Assert: Saves successfully (no max); reload — the value persists exactly.

**SALES-042** — Phone accepts free text (no validation).
Steps: Enter non-numeric text in الهاتف (e.g. "abc-not-a-phone"), save.
Assert: Saves without error — no format/regex validation exists, and there is no country-code selector at all (gap vs catalog's +20-default phone control).

**SALES-043** — Email accepts an invalid string.
Steps: Enter "not-an-email" in البريد الإلكتروني, save.
Assert: Only the browser's native `type=email` hint applies (not app-enforced) — the app itself does not block save on a malformed address.

**SALES-044** `[NOT IMPLEMENTED]` — التصنيف is free text, not a dropdown with quick-add.
Steps: Inspect the التصنيف field.
Assert: It is a plain `TextField`, not the catalog's dropdown + inline "تصنيف جديد" quick-add.

**SALES-045** `[NOT IMPLEMENTED]` — قائمة الأسعار is a raw free-text ID field, not a search/select.
Steps: Inspect the قائمة الأسعار field; type an arbitrary string like "not-a-real-id".
Assert: Field accepts any text with no lookup/validation against real price lists — a typo here would silently fail to resolve pricing later with no warning at save time.

**SALES-046** `[NOT IMPLEMENTED]` — No logo upload, no "خيارات متقدمة" section.
Assert: There is no الشعار upload control anywhere; every "advanced" field from the catalog (phone, email, tax number, ETA buyer type, national ID, tax exempt, contact person, notes) is flat and always visible — no collapsible section exists.

**SALES-047** — Tax-exempt toggle persists.
Steps: In create, toggle إعفاء ضريبي on, save, reload, open the new customer's نظرة عامة tab.
Assert: إعفاء ضريبي reads "نعم" after reload.

**SALES-048** — Cancel discards.
Steps: Fill several fields, click إلغاء.
Assert: Dialog closes, no customer created, list unchanged, count of customers unchanged from before the dialog opened.

**SALES-049** — Code is locked on edit.
Steps: Open `CUST-DEMO-1` → تعديل, try to change الكود.
Assert: The field is disabled — the code cannot be changed once a customer exists.

**SALES-050** — Only way to deactivate a customer.
Steps: Edit `CUST-DEMO-1`, toggle نشط off, save, reload.
Assert: Status pill flips to "غير نشط"; the customer now counts under the "غير نشط" chip. This toggle in the edit dialog is the *only* deactivation path — there is no "المزيد" menu with a standalone "تعطيل" action anywhere (gap vs catalog). Toggle it back on afterward to avoid polluting later scenarios.

**SALES-051** — Edit persists after reload.
Steps: Edit `CUST-DEMO-2`, change شروط الدفع from 45 to 60, save, reload the detail page.
Assert: شروط الدفع summary card reads "60 يوم".

**SALES-052** `[NOT IMPLEMENTED]` — Detail header actions.
Steps: Open any customer's detail page.
Assert: Header shows only تعديل and رجوع لقائمة العملاء buttons. There is no إنشاء فاتورة button and no "المزيد" menu (so no نظرة 360°, تعطيل-via-menu, or دمج مع عميل آخر anywhere).

**SALES-053** — Summary cards, CUST-DEMO-2.
Steps: Open `CUST-DEMO-2`.
Assert: 6 cards show: التصنيف (بدون تصنيف), شروط الدفع (45 يوم), الحد الائتماني (120,000.00), الرصيد الافتتاحي, متبقي من الحد (= creditLimit − openingBalance, danger tone only if negative), نوع المشتري (ETA).

**SALES-054** `[NOT IMPLEMENTED]` — No quick-actions row.
Assert: The catalog's إنشاء فاتورة / تحصيل دفعة / عرض سعر جديد / كشف حساب quick-action button row does not exist; كشف حساب is reachable only via its own tab.

**SALES-055** — نظرة عامة tab.
Steps: Open the نظرة عامة tab on `CUST-DEMO-3`.
Assert: Read-only 2-column grid: الهاتف, البريد الإلكتروني, جهة الاتصال, الرقم الضريبي, الرقم القومي, العملة, إعفاء ضريبي (لا), قائمة الأسعار (شows "قائمة أسعار الموزعين"). Any empty field falls back to "لا يوجد".

**SALES-056** — الفواتير tab shows D1's effect.
Pre: `CUST-DEMO-1` has invoices `INV-DEMO-1`, `INV-DEMO-4`, `INV-DEMO-5`.
Steps: Open `CUST-DEMO-1` → الفواتير tab.
Assert: All 3 invoices list with رقم الفاتورة/التاريخ/الاستحقاق/الحالة/الإجمالي/المحصّل/المتبقي. `INV-DEMO-1`'s المحصّل reads **0** despite `VCH-DEMO-1` having collected against it via a Treasury voucher — this is D1.

**SALES-057** `[NOT IMPLEMENTED]` — الفواتير tab has no strikethrough/actions.
Assert: No strikethrough original-vs-remaining display, and no per-row تحصيل button or menu exists in this tab (gap vs catalog).

**SALES-058** — كشف حساب tab reconciles.
Steps: Open `CUST-DEMO-1` → كشف حساب.
Assert: Shows an opening-balance row plus a running ledger (التاريخ/الحركة/المرجع/مدين/دائن/الرصيد) that includes `INV-DEMO-1`'s original charge and both its confirmed returns (`SRT-DEMO-1`, `SRET-DEMO-1`) as credit lines. The reconciliation pill reads "مطابق لتقرير أعمار الديون" (matches `/reports/aging/customers`) — this tab, unlike the invoice's own remainingBalance field, does account for returns.

**SALES-059** — الفواتير tab empty state.
Pre: create a brand-new customer with zero invoices.
Steps: Open its الفواتير tab.
Assert: "لا توجد فواتير مبيعات مسجّلة لهذا العميل" + explanatory body text ("أول فاتورة تُصدر لهذا العميل من شاشة «فواتير المبيعات» ستظهر هنا فور حفظها.").

**SALES-060** `[NOT IMPLEMENTED]` — Missing tabs.
Assert: Only 3 tabs exist (نظرة عامة / الفواتير / كشف حساب). الأقساط, المرتجعات, نقاط الولاء, المرفقات, سجل المراجعة from the catalog do not exist — the code explicitly comments that there is no attachments tab because there is no file-storage subsystem at all.

**SALES-061** `[NOT IMPLEMENTED]` — No customer categories dialog.
Assert: Nothing on the list screen manages التصنيف as a first-class entity (no "تصنيفات العملاء" dialog, no category CRUD, no empty state for it) — التصنيف is purely a free-text field per customer.

**SALES-062** — List load error + retry.
Steps: Force the customers query to fail (e.g. offline), reload the screen.
Assert: "تعذّر تحميل العملاء." card + "إعادة المحاولة" button; clicking retry re-issues the query.

**SALES-063** — Run in English/LTR.
Steps: Toggle language while on the list, the add dialog, and a customer's detail page.
Assert: Labels flip to English, layout mirrors LTR, numeric values render in Latin digits, no clipped/overflowing controls.

---

### فواتير المبيعات (Sales Invoices) — `/sales/invoices`

**SALES-064** — Status chip "الكل".
Pre: 6 confirmed sales invoices seeded.
Assert: Count = 6, all 6 rows list.

**SALES-065 / 066 / 067 / 068** — Remaining status chips.
Assert: "مسودة" = 0 (nothing seeded as draft); "مؤكد" = 6 (every seeded invoice is confirmed and, per D1, none can reach partially_paid via the voucher path); "مدفوع جزئياً" = 0; "مدفوع" = 0; "ملغي" = 0.

**SALES-069** `[NOT IMPLEMENTED]` — No "مفتوح" or "متأخر" status chips.
Assert: Only 6 chips exist (الكل/مسودة/مؤكد/مدفوع جزئياً/مدفوع/ملغي); the catalog's مفتوح and متأخر chips are absent.

**SALES-070** — KPI "إجمالي الفواتير".
Assert: Reads 6, matching the list's total row count.

**SALES-071** — KPI "إجمالي المبيعات".
Assert: Equals the sum of all 6 grand totals: 13,953.60 + 9,747.00 + 6,634.80 + 5,335.20 + 6,703.20 + ≈10,191.60 ≈ **52,565.40**.

**SALES-072** — KPI "إجمالي المحصل" exposes D1.
Assert: Reads **0.00** — sums `amountPaid` across invoices, and D1 means `VCH-DEMO-1`'s collection against `INV-DEMO-1` never lands in that field.

**SALES-073** — KPI "إجمالي المتبقي".
Assert: Danger tone (>0); equals the same figure as SALES-071 (≈52,565.40), since `amountPaid` reads 0 everywhere — cross-check the two KPI values match exactly.

**SALES-074** `[NOT IMPLEMENTED]` — No إجمالي المرتجع or دفعات غير مخصصة KPI cards.
Assert: Only 4 KPI cards exist total (إجمالي الفواتير/إجمالي المبيعات/إجمالي المحصل/إجمالي المتبقي).

**SALES-075** `[NOT IMPLEMENTED]` — No import action, no overdue-follow-up banner.
Assert: Header shows only "فاتورة جديدة"; there is no "استيراد فواتير سابقة" button and no "تحتاج متابعة" banner anywhere on the list.

**SALES-076** — List columns.
Steps: Inspect a row, e.g. `INV-DEMO-3`.
Assert: رقم الفاتورة column shows docNo with customer name + date as subtext; تاريخ الاستحقاق shows the raw date only (no overdue badge yet, since no seeded invoice is currently overdue); الرصيد المتبقي column has a footer total row summing all visible rows; الحالة shows a StatusPill. No "بواسطة" column exists (gap).

**SALES-077** — Search by docNo.
Steps: Type "INV-DEMO-2" in the search box.
Assert: Exactly one row, case-insensitive match on docNo.

**SALES-078** — Search by customer name.
Steps: Type "الأمل".
Assert: Returns `INV-DEMO-1`, `INV-DEMO-4`, `INV-DEMO-5` (all CUST-DEMO-1's invoices) — note the match on customer name is case-sensitive substring (Arabic has no case, but confirm a partial word like "الأم" still matches, since it's `.includes`, not full-word).

**SALES-079** — Search with no match.
Steps: Type "zzz-nonexistent".
Assert: No rows / empty state.

**SALES-080** `[NOT IMPLEMENTED]` — No filters panel.
Assert: No تصفية بالعميل, من/إلى تاريخ, المستودع, or مصدر الفاتورة filter exists anywhere on this screen.

**SALES-081** — Dead sort affordance.
Steps: Click the رقم الفاتورة column header (it shows a ⇅ sort icon).
Assert: Nothing happens — no rows reorder. The icon implies sortability but `sort`/`onSortChange` are never wired; this is a more misleading gap than "no sort exists at all" since the UI visually promises it.

**SALES-082** — Pagination.
Steps: Observe the footer with all 6 invoices loaded.
Assert: All 6 show on a single page; no page-size selector; `page`/`pageCount` are hardcoded 1/1.

**SALES-083** — Row click opens full detail, no quick-view panel.
Steps: Click the `INV-DEMO-1` row.
Assert: The whole screen swaps in-place to the invoice detail view — there is no slide-out quick-view side panel and therefore no "فتح في صفحة كاملة" link (gap vs catalog, which describes a two-step reveal).

**SALES-084** `[NOT IMPLEMENTED]` — No row-level quick actions.
Assert: No تحصيل quick button and no ⋮ row menu exists on any row.

**SALES-085** — Create form is a panel, not a routed page.
Steps: Click "فاتورة جديدة".
Assert: Opens a SidePanel titled "فاتورة مبيعات جديدة" in place — there is no `/sales/invoices/new` URL/route change.

**SALES-086** `[NOT IMPLEMENTED]` — No manual-vs-from-quote toggle.
Assert: This form has no "طريقة الإنشاء" toggle; converting a quote into an invoice happens entirely from the quote's own detail panel (see the Quotes section), not from here.

**SALES-087** — Required customer field.
Steps: Leave العميل unselected, click تأكيد الفاتورة (or حفظ كمسودة).
Assert: Blocked, banner "العميل مطلوب."

**SALES-088** — Create, confirm, and reload — full persistence check.
Steps: Select العميل = CUST-DEMO-3, keep defaults for التاريخ/تاريخ الاستحقاق/المستودع, add one line (item `ITEM-DEMO-1`, qty 5, price auto-fills 180), click تأكيد الفاتورة.
Assert: A new confirmed invoice appears in the list. Reload the page and reopen it fresh from the list — customer, date, line item, qty, price, and computed totals (subtotal 900.00, tax 126.00, grand total 1,026.00) all match exactly what was entered.

**SALES-089** — المستودع is not client-gated despite being required.
Pre: at least one warehouse exists (normal seed state).
Steps: Open the create form; note المستودع has no asterisk in its label though the domain requires it.
Assert: `canSubmit` does not include `warehouseId` in its gate — if the warehouses list were ever empty, both buttons would stay enabled and clicking تأكيد would surface a server-side error banner ("المستودع مطلوب.") instead of being blocked client-side like العميل is.

**SALES-090** `[NOT IMPLEMENTED]` — No الفرع field.
Steps: Inspect the create form for a branch selector.
Assert: None exists — branch is hardcoded to `"MAIN"` in code; the catalog's required الفرع field is entirely absent from the UI.

**SALES-091** — مندوب المبيعات is optional and not in the catalog.
Steps: Leave مندوب المبيعات unselected, save.
Assert: Saves fine (optional field); this field itself is extra vs. the catalog, which describes no salesperson field on the new-invoice form.

**SALES-092** — Item line auto-fills price.
Steps: Add a line, pick item `ITEM-DEMO-4` via the picker.
Assert: سعر الوحدة auto-fills to 260 (the item's `salePrice`) — no manual entry needed, though it remains editable.

**SALES-093** — Qty rejects negative (client-clamped).
Steps: In a line's الكمية field, try to type a negative number, then blur the field.
Assert: `QtyInput` clamps negative values to 0 on blur — negative quantities cannot persist in the field.

**SALES-094** — Unit price accepts negative (client) but is rejected server-side.
Steps: In a line's سعر الوحدة field, type a negative value (e.g. -50), attempt to save.
Assert: The `MoneyInput` has no client-side minimum — the negative value IS typeable and submittable. The save then fails with a server-side error banner: "السعر لا يقبل قيمة سالبة." This is a real negative-path gap: invalid input surfaces as a banner after a round trip, not blocked at the field like قty is.

**SALES-095** — Cannot delete the last line.
Steps: With only one line remaining, try to delete it.
Assert: The row's delete (✕) button is disabled when exactly one line remains.

**SALES-096** — Confirming with zero valid lines is blocked (client).
Steps: Remove all meaningful content so no line has both a valid item and a positive qty/price yielding a grand total > 0 (e.g. a single line at qty 0).
Assert: Both حفظ كمسودة and تأكيد الفاتورة stay disabled — `canSubmit` requires at least one valid line AND `grandTotal > 0`.

**SALES-097** — Confirming with zero lines is also blocked server-side.
Pre: hypothetically bypass the client gate (e.g. via direct API call) with an empty `lines` array.
Assert: Server throws `InvalidSalesInvoiceError` — "الفاتورة تتطلب بنداً واحداً على الأقل." — a defense-in-depth check behind the disabled buttons.

**SALES-098** — Invoice-level discount, percent type capped.
Steps: Set نوع الخصم = نسبة %, try to enter a value above 100.
Assert: `max={100}` on the field for percent type — cannot exceed 100.

**SALES-099** — Invoice-level discount, amount type uncapped.
Steps: Set نوع الخصم = مبلغ, enter an amount larger than the invoice's subtotal.
Assert: No client-side ceiling exists for amount-type discounts (only `min={0}`) — the field accepts a discount larger than the subtotal; verify what the resulting total does (whether it floors at zero or goes negative) and record any unexpected total as a new finding.

**SALES-100** — Coupon code has no preview/apply step.
Steps: Type a coupon code (real or fake) in كود الكوبون.
Assert: There is no "تطبيق الكوبون" button (gap vs catalog) — the code is only evaluated server-side at confirm time; no discount preview appears before confirming.

**SALES-101** `[NOT IMPLEMENTED]` — No ملاحظات / ملاحظات داخلية fields.
Steps: Inspect the create form for notes fields.
Assert: Neither exists in the UI, even though the domain model supports both — `handleSave` never sends them.

**SALES-102** `[NOT IMPLEMENTED]` — No attachments uploader, no price-list selector.
Assert: Neither المرفقات nor قائمة الأسعار exists on this form; item sale price is pulled straight from the item record with no price-list resolution UI.

**SALES-103** `[NOT IMPLEMENTED]` — No "unsaved changes" pill.
Assert: The catalog's "التغييرات غير المحفوظة" status indicator does not exist anywhere in this panel.

**SALES-104** — Form silently resets on a background refetch.
Pre: open the create panel and start filling it in (customer, lines) without saving.
Steps: Trigger a warehouses refetch in the background (e.g. focus/blur the browser tab, or wait for any automatic refetch window) while the panel stays open.
Assert: `resetForm()` re-runs on every change to the warehouses query's data reference (`useEffect` dep `[open, warehouses]`), which is a new array on every refetch — the entire in-progress form (customer, lines, discount) can silently clear. This is a genuine regression-worthy edge case: reproduce it and note whether data was actually lost.

**SALES-105** — Detail header, no المزيد menu.
Steps: Open `INV-DEMO-2`'s detail.
Assert: Header shows only a "رجوع" action — no مشاركة, no header-level تحصيل دفعة button, and no "المزيد" menu at all (so no print, ETA export, installment-plan creation, or create-return shortcut from here).

**SALES-106** — No way to cancel a saved invoice.
Steps: Look for any cancel action on any confirmed invoice's detail page.
Assert: None exists in the UI. (The domain's `cancel()` only applies to draft/pending invoices anyway — confirmed invoices are only ever correctable through a return — but even for a draft, there is no UI trigger to cancel it once you've navigated away from the create panel.)

**SALES-107** — Effects explainer exists (simplified).
Steps: Open any confirmed invoice's detail.
Assert: A "تأثيرات هذه الفاتورة" block with 2 bullet lines is present — a static draft-vs-posted effects note plus "الرصيد المتبقي على العميل: {value}" — simpler than the catalog's itemized breakdown but present.

**SALES-108** — بنود الفاتورة tab, missing columns.
Steps: Open `INV-DEMO-1`'s بنود الفاتورة tab.
Assert: 6 columns only (الصنف, الكمية, السعر, الخصم %, الضريبة, الإجمالي) — no التكلفة or الربح columns, and the footer shows only "الإجمالي الكلي" — none of المجموع الفرعي / الخصم / إجمالي التكلفة / الربح / هامش الربح % / خصم المرتجعات المؤكدة / الصافي بعد المرتجعات from the catalog.

**SALES-109** — القيود المحاسبية tab.
Steps: Open any confirmed invoice's GL tab.
Assert: Shows the posted journal entry number and an account/مدين/دائن table.

**SALES-110** — المدفوعات tab records a payment correctly (unaffected by D1).
Pre: `INV-DEMO-2` (grand total 9,747.00, `amountPaid` 0).
Steps: Open المدفوعات tab, enter a partial payment (e.g. 3,000.00), submit.
Assert: `amountPaid` updates to 3,000.00, remaining balance drops to 6,747.00, status flips to "مدفوع جزئياً" — reload the invoice and confirm all three persist. This path is genuinely unaffected by D1 (it's the invoice's own `recordPayment`, distinct from the Treasury-voucher path D1 breaks).

**SALES-111** — Payment amount validation.
Steps: In the payments tab, try to submit 0 or a negative amount.
Assert: Client error "قيمة الدفعة يجب أن تكون أكبر من صفر."; try an amount larger than the remaining balance — domain rejects with "الدفعة تتجاوز الرصيد المتبقي للفاتورة."

**SALES-112** — Payments tab blocked state.
Pre: a draft invoice, if one can be created (client gate normally blocks saving drafts with 0 total, but a draft with a valid line can exist — check by saving as draft rather than confirming).
Steps: Open its المدفوعات tab.
Assert: "لا يمكن تسجيل دفعة في حالة الفاتورة الحالية." message shows instead of the payment form.

**SALES-113** `[NOT IMPLEMENTED]` — Missing detail tabs.
Assert: Only 3 tabs exist (بنود الفاتورة / القيود المحاسبية / المدفوعات). المرتجعات, الأقساط, الفاتورة الإلكترونية (ETA), المرفقات, سجل المراجعة from the catalog are all absent.

**SALES-114** `[NOT IMPLEMENTED]` — No tax-exempt banner.
Pre: mark a customer إعفاء ضريبي = true (e.g. via the Customers edit dialog), then create an invoice for them.
Steps: Open the resulting invoice's create form and detail.
Assert: Lines silently get `taxRatePercent = 0` (verify tax total is 0), but no "معفى من الضريبة" banner appears anywhere — the exemption is invisible in the UI aside from the tax column reading 0%.

**SALES-115** — D1 and the remaining-balance compounding gap, precisely.
Pre: `INV-DEMO-1` — grand total 13,953.60, two confirmed returns worth 1,197.00, one Treasury voucher (`VCH-DEMO-1`) collecting ~45% of its true outstanding balance.
Steps: Open `INV-DEMO-1`'s detail page and read "الرصيد المتبقي".
Assert: Per `remainingBalance = grandTotal − amountPaid` (`packages/api/src/sales-invoices-routes.ts:132-134`) and D1 (`amountPaid` stuck at 0 via the voucher path), expect the field to still read the full **13,953.60** — reflecting neither the 1,197.00 of confirmed returns nor the voucher's collection. If reproduced, log this precisely as a new defect separate from D1 (cite this file/line), not a duplicate.

**SALES-116** — Status pill for a manually forced-overdue invoice.
Pre: create a new invoice with تاريخ الاستحقاق set to a past date (e.g. 2026-08-01), confirm it.
Steps: Return to the list.
Assert: The list's متأخر flag appears as a plain danger "متأخر" pill next to the due date with **no day count** (gap vs catalog's "متأخر N يوم" badge); the invoice does not show under any "متأخر" chip since none exists (see SALES-069).

**SALES-117** — Discount and coupon interplay on a real seeded example.
Pre: `INV-DEMO-4` — grand total 5,335.20, earned SUMMER10's 10% discount automatically at confirm (no coupon needed, `requiresCoupon: false`).
Steps: Open `INV-DEMO-4`'s detail.
Assert: تفاصيل line/footer reflect the discounted total; confirm the applied-promotion summary field (شown conditionally per the code) displays "العرض المطبَّق" and "خصم العرض" for this invoice.

**SALES-118** — Run in English/LTR.
Steps: Toggle language on the list, create form, and an invoice detail page.
Assert: Labels flip, RTL→LTR mirrors correctly (line-item table column order, totals alignment), digits render Latin.

---

### عروض الأسعار (Sales Quotes) — `/sales/quotes`

Everything on this screen is inline panels on the list — there is no `/sales/quotes/new` or `/sales/quotes/{id}` route; row click opens a quick-view SidePanel that also hosts every status-transition action.

**SALES-119** — Status chip "الكل".
Pre: 4 seeded quotes.
Assert: Count = 4, all list.

**SALES-120 / 121 / 122 / 123** — Remaining chips.
Assert: "مسودة" = 1 (`SQ-DEMO-4`); "مرسل" = 1 (`SQ-DEMO-3`); "مقبول" = 0 (`SQ-DEMO-1` already converted past "accepted"); "مرفوض" = 1 (`SQ-DEMO-2`); "محول" = 1 (`SQ-DEMO-1`).

**SALES-124** `[NOT IMPLEMENTED]` — No "ملغي" chip.
Assert: Though `cancelled` is a valid status value in code (`STATUS_LABEL`/`STATUS_TONE`), no chip for it exists and no button anywhere can reach it — dead status in this screen.

**SALES-125** — KPI cards are counts, not values.
Assert: "إجمالي العروض" = 4, "مقبولة" = 0 (matches السالس-122's count, not a money value), "محولة" = 1 — all three are plain counts, contradicting the catalog's money-valued KPI cards (إجمالي قيمة العروض, قيمة المقبولة, قيمة المحولة).

**SALES-126** — Header action.
Steps: Click "عرض سعر جديد".
Assert: Opens the create SidePanel titled "عرض سعر جديد" in place (no route change).

**SALES-127** — List columns.
Steps: Inspect the `SQ-DEMO-3` row.
Assert: رقم العرض shows docNo + customer name subtext; تاريخ الانتهاء shows the plain expiry date with **no** "انتهت منذ N يوم" badge (gap — expiry is never flagged at all in this screen, even for an actually-expired quote); الإجمالي shows the MoneyDisplay grand total (8,025.60); الحالة shows the status pill. No بواسطة column, no row action button/menu.

**SALES-128** `[NOT IMPLEMENTED]` — No filters, no search.
Assert: No تصفية بالعميل or تصفية بالتاريخ (من/إلى) fields exist anywhere; there is also no search box at all on this screen (unlike Customers/Invoices, which at least have one).

**SALES-129** — No sort, fake pagination.
Assert: No column is sortable; `page`/`pageCount` hardcoded 1/1, all rows show at once.

**SALES-130** — Required customer on create.
Steps: In "عرض سعر جديد", leave العميل on the blank "اختر عميلاً" option, click حفظ كمسودة.
Assert: Blocked, error "اختر عميلاً."

**SALES-131** — Cannot save with zero valid lines.
Steps: Clear the single default line's اسم الصنف (leave blank) or set الكمية to 0, click حفظ كمسودة.
Assert: Blocked, error "أضف بنداً واحداً على الأقل باسم صنف وكمية أكبر من صفر."

**SALES-132** — Item field is free text, not a real item picker — persistence check.
Steps: Create a quote for CUST-DEMO-3, type "صنف تجريبي" as اسم الصنف (not a real catalog item name), qty 2, unit price 100, save.
Assert: Saves successfully — this screen never resolves a real inventory item; the line's `itemId` is a locally-generated placeholder (`ITEM-{seq}`), not a real catalog item ID like `ITEM-DEMO-1`. Reload the quotes list and reopen the new quote — the typed name/qty/price persist even though they reference no real item. This is a meaningful gap: quotes created through this UI are not tied to real inventory the way invoices are (invoices use a real `EntityPicker`).

**SALES-133** `[NOT IMPLEMENTED]` — Missing fields on the create form.
Assert: No الفرع selector (hardcoded `branchId: "BR1"`), no العملة field, no discount-type dropdown, no ملاحظات/ملاحظات داخلية, no قائمة الأسعار, no attachments uploader — all present in the catalog, none in this build.

**SALES-134** — Negative/zero qty and price on lines.
Steps: Try to set الكمية or سعر الوحدة to a negative number on a line.
Assert: Both `NumberField`s carry `min={0}` — negative values cannot be entered.

**SALES-135** — Cannot delete the last line.
Steps: With one line, click حذف.
Assert: Disabled when `lines.length === 1`.

**SALES-136** — Create only ever saves as draft.
Steps: Fill a valid quote, look for a "send" or "confirm" action in the create panel.
Assert: Only إلغاء and حفظ كمسودة exist — there is no combined save-and-send action; every new quote starts as مسودة regardless.

**SALES-137** — Detail quick-view panel, missing catalog features.
Steps: Click the `SQ-DEMO-3` row.
Assert: Opens a SidePanel with status pill, customer name, expiry date, a flat list of line items (name, qty × unit price), and grand total. No status-explainer banner text, no 4-step visual progress stepper, no "ما الذي سيحدث؟" explainer block, and no tabs (تفاصيل العرض / المرفقات / السجل) exist — all gaps vs catalog.

**SALES-138** — draft → send transition.
Pre: `SQ-DEMO-4` is draft.
Steps: Open it, click "إرسال للعميل".
Assert: Status flips to "مرسل"; reload the list — the quote now shows under the "مرسل" chip and its count increments.

**SALES-139** — sent → accept transition.
Pre: after SALES-138, `SQ-DEMO-4` is now sent (or use `SQ-DEMO-3`, already sent).
Steps: Open it, click "قبول العميل".
Assert: Status flips to "مقبول"; the convert-to-invoice sub-form appears in its place.

**SALES-140** — sent → reject transition.
Pre: create/use a sent quote you don't need for later scenarios.
Steps: Click "رفض".
Assert: Status flips to "مرفوض"; reopen the panel — no action buttons render at all for a rejected quote (falls through every conditional), matching the catalog's terminal state but with no explanatory text.

**SALES-141** — Convert requires a warehouse.
Pre: an accepted quote (from SALES-139).
Steps: In the convert sub-form, leave المستودع * blank, click "إنشاء الفاتورة".
Assert: Blocked, error "أدخل المستودع." — this field is a plain free-text TextField (placeholder "WH1"), not a warehouse picker (gap).

**SALES-142** — Convert succeeds and creates a real invoice.
Pre: same accepted quote.
Steps: Enter a real warehouse ID, click "إنشاء الفاتورة".
Assert: Status flips to "محول"; a success banner "تم تحويل هذا العرض إلى فاتورة مبيعات." replaces the convert form; navigate to `/sales/invoices` and confirm a new confirmed invoice now exists referencing this quote's lines.

**SALES-143** — Converting twice is blocked by UI absence, not an error message.
Pre: the now-converted quote from SALES-142.
Steps: Reopen it.
Assert: Only the static success banner shows — no convert form, no button of any kind — so a second conversion is simply unreachable through the UI (no explicit "already converted" error is ever shown, because the action never becomes available again).

**SALES-144** — Using the real seeded example, `SQ-DEMO-1`.
Pre: `SQ-DEMO-1` — sent → accepted → converted to `INV-DEMO-6`, grand total 10,191.60.
Steps: Open `SQ-DEMO-1`.
Assert: Status "محول", success banner shown, line items still visible (30×ITEM-1, 100×ITEM-3), no action buttons.

**SALES-145** — Rejected quote, `SQ-DEMO-2`, no path forward.
Pre: `SQ-DEMO-2` — sent → rejected.
Steps: Open it.
Assert: Status pill "مرفوض", line items and total visible, but no button/message of any kind below them (matches SALES-140's finding).

**SALES-146** `[NOT IMPLEMENTED]` — No "المزيد" menu.
Assert: No print or delete action exists anywhere on this screen, despite the catalog describing both under a "المزيد" menu.

**SALES-147** — Draft quote, `SQ-DEMO-4`, before any transition.
Pre: fresh seed, `SQ-DEMO-4` still draft (do this scenario before SALES-138 consumes it, or create a new draft quote instead).
Steps: Open it.
Assert: Status "مسودة", only "إرسال للعميل" button shown.

**SALES-148** — Expiry is never flagged, even for a genuinely expired quote.
Pre: create a quote with تاريخ الانتهاء set to a past date (e.g. 2026-08-01), leave it as draft or send it.
Steps: Observe the list row and the detail panel.
Assert: Neither shows any "expired"/"منتهي" indicator — the catalog's "انتهت منذ N يوم" badge and 4th status ("منتهي") do not exist in code at all; an expired quote looks identical to a non-expired one everywhere in this UI.

**SALES-149** — `useScreenIntent` deep-link opens the create panel directly.
Pre: navigate via a quick-start shortcut elsewhere (e.g. the Sales Hub's "عرض سعر جديد" button, SALES-004).
Steps: Land on `/sales/quotes`.
Assert: The create panel is already open on arrival, with the form freshly reset (not showing stale data from a previous visit).

**SALES-150** — Cancel discards a new quote.
Steps: Fill several fields in the create panel, click إلغاء.
Assert: Panel closes, no quote created, quote count unchanged.

**SALES-151** — Reload persistence for a status transition.
Pre: a sent quote.
Steps: Accept it, then reload the whole page (not just the panel).
Assert: Reopening the same quote shows status "مقبول" and the convert sub-form — the transition survived a full reload, confirming it's server-persisted and not just local state.

**SALES-152** — `SQ-DEMO-3`'s exact totals.
Pre: `SQ-DEMO-3` — 80×ITEM-DEMO-2 at wholesale price 88 = 7,040.00 + 985.60 tax.
Steps: Open its detail panel.
Assert: الإجمالي الكلي reads **8,025.60**.

**SALES-153** — Run in English/LTR.
Steps: Toggle language on the list, create panel, and a quote's detail panel.
Assert: Labels flip, layout mirrors, digits render Latin.

---

### مرتجعات المبيعات (Sales Returns) — `/sales/returns`

Same architecture as Quotes: list + two SidePanels, no separate routes for create/detail.

**SALES-154** — Status chip "الكل".
Pre: 3 seeded returns (`SRT-DEMO-1`, `SRET-DEMO-1` confirmed; `SRT-DEMO-2` draft).
Assert: Count = 3.

**SALES-155 / 156 / 157** — Remaining chips.
Assert: "مسودة" = 1 (`SRT-DEMO-2`); "مؤكد" = 2 (`SRT-DEMO-1`, `SRET-DEMO-1`); "ملغي" = 0.

**SALES-158** `[NOT IMPLEMENTED]` — No "بانتظار دفع المبلغ" chip.
Assert: `awaitingRefund` is only ever shown as a secondary badge and a KPI count — it is not one of the 4 filterable status chips (الكل/مسودة/مؤكد/ملغي only), even though both confirmed seeded returns always carry that badge (`isAwaitingRefund = status === "confirmed"`).

**SALES-159** — KPI cards are counts.
Assert: "إجمالي المرتجعات" = 3, "مؤكدة" = 2, "بانتظار دفع المبلغ" = 2 (both confirmed returns, by definition) — all counts, not the catalog's money-valued "قيمة المرتجعات المؤكدة".

**SALES-160** — Header action + panel subtitle.
Steps: Click "مرتجع جديد".
Assert: Opens a SidePanel titled "مرتجع مبيعات جديد" with description "مرتجع لا يعني استرداد المبلغ تلقائياً" — this doubles as the catalog's "doesn't auto-refund cash" banner, rendered as the panel's subtitle rather than a distinct visual block.

**SALES-161** — List columns.
Steps: Inspect the `SRT-DEMO-1` row.
Assert: رقم المرتجع shows docNo + source-invoice-number subtext (NOT the return reason, unlike the catalog's claim); العميل resolves via a lookup map; قيمة المرتجع shows one combined MoneyDisplay total (no separate original-vs-returned breakdown, unlike catalog); الحالة shows the status pill plus a secondary "بانتظار دفع المبلغ" warning pill for confirmed returns.

**SALES-162** `[NOT IMPLEMENTED]` — No filters, no بواسطة/reason column, no row menu.
Assert: No العميل or من/إلى تاريخ filter panel; no سبب column visible in the list itself; no per-row menu (all actions live in the detail panel).

**SALES-163** — Source-invoice picker is a plain dropdown, not a typeahead.
Steps: Open "مرتجع جديد", inspect فاتورة المصدر *.
Assert: It's a `SelectField` populated from confirmed/non-draft/non-cancelled invoices (label = `docNo — customerName`) — not the catalog's searchable typeahead combobox.

**SALES-164** `[NOT IMPLEMENTED]` — No read-only invoice-summary block after selecting a source.
Steps: Select a source invoice.
Assert: None of رقم الفاتورة/العميل/التاريخ/المستودع/الفرع/إجمالي الفاتورة/الحالة render as a read-only summary — the only extra control shown is an independent, editable المستودع * selector (defaults to the first warehouse, not necessarily the invoice's own warehouse).

**SALES-165** — Reason dropdown, exact options.
Steps: Open سبب الإرجاع *.
Assert: Exactly 5 options — معيب (DEFECTIVE, default), صنف خاطئ (WRONG_ITEM), كمية زائدة (EXCESS_QTY), تغيير رأي العميل (CHANGED_MIND), أخرى (OTHER) — matches the catalog exactly.

**SALES-166** — Line item table is missing most catalog columns.
Steps: Select `INV-DEMO-1` as the source invoice, inspect the بنود المرتجع table.
Assert: Only 2 fields per row exist — الصنف (a `SelectField` of the invoice's stock lines) and الكمية (a `NumberField`, `min=0`, no max). سعر الوحدة, الكمية الأصلية, مرتجع سابق, المتاح للإرجاع, and إجمالي السطر from the catalog are **not rendered at all** — the tester has no visibility into original/already-returned/available quantities while filling the form.

**SALES-167** — "Available to return" ignores prior returns — the over-return gap.
Pre: `INV-DEMO-1`'s ITEM-DEMO-3 line originally invoiced 120 units; 25 are already confirmed-returned (`SRT-DEMO-1` qty 20 + `SRET-DEMO-1` qty 5), so the true remaining returnable is **95**.
Steps: Open "مرتجع جديد", select `INV-DEMO-1` as the source, pick ITEM-DEMO-3, enter الكمية = 100 (more than the true 95 remaining, but less than the original 120), save & confirm.
Assert: Per code, `returnableLines` (`SalesReturnsScreen.tsx:118-121`) filters the invoice's *original* stock lines with no subtraction of already-returned qty, and `availableQty` sent to the server is the original invoice-line qty (120), not (120 − 25 = 95). The domain's own guard (`sales-return-document.ts:114-118`, "كمية الإرجاع تتجاوز المتاح للإرجاع") only compares against whatever `availableQty` the *client* supplied — so it is neutered by the inflated value the UI sends. **Expected-if-correct**: the return should be rejected (100 > 95 truly available). **Verify what actually happens** — if the return commits, this is exactly the "returning more than was invoiced" defect the task description points at; log it precisely (qty entered, true available, qty accepted) as a new, distinctly-cited finding — it is not one of D1–D6.

**SALES-168** — Genuine over-original-qty rejection (sanity check).
Steps: On the same form, try entering a quantity larger than the invoice's *original* line qty (e.g. 200 for a 120-unit line).
Assert: Since `availableQty` is set to the original 120 regardless of prior returns, a qty of 200 should still be rejected server-side ("...(200) تتجاوز المتاح للإرجاع (120)") — confirming the guard works correctly against the *original* qty, just not against the *true remaining* qty (see SALES-167).

**SALES-169** — Cannot save with all lines at zero.
Steps: Set every line's الكمية to 0, click حفظ كمسودة.
Assert: Blocked, error "أضف بنداً واحداً على الأقل بكمية أكبر من صفر."

**SALES-170** — Empty returnable-lines state.
Pre: pick a source invoice whose lines are entirely non-stock or already fully consumed by the `isStock && unitCost !== null` filter (uncommon in seed data — may require a purpose-built invoice with a non-stock line only).
Steps: Select such an invoice.
Assert: "لا توجد أصناف مخزنية قابلة للإرجاع في هذه الفاتورة" shows; the "إضافة بند" button is disabled.

**SALES-171** — Two save modes: draft-only vs. save-and-confirm.
Steps: Fill a valid return against `INV-DEMO-2`, and separately test both buttons: "حفظ كمسودة" and "حفظ وتأكيد".
Assert: حفظ كمسودة creates a draft (status مسودة, no restock/GL effect expected); حفظ وتأكيد creates AND immediately confirms in one action — this combined action is extra vs. the catalog, which only describes حفظ كمسودة on this form.

**SALES-172** — Cannot delete the last line.
Steps: With one line, click حذف.
Assert: Disabled when `lines.length === 1`.

**SALES-173** — draft → confirm transition, `SRT-DEMO-2`.
Pre: `SRT-DEMO-2` is draft (against `INV-DEMO-3`, item ITEM-4, qty 3).
Steps: Open it, click "تأكيد المرتجع".
Assert: Status flips to "مؤكد"; a "بانتظار دفع المبلغ" badge now shows permanently alongside it; reload — both persist.

**SALES-174** — draft → cancel transition.
Pre: create a fresh draft return (don't reuse `SRT-DEMO-2` if SALES-173 already confirmed it).
Steps: Open it, click "إلغاء" (the draft-state cancel button).
Assert: Status flips to "ملغي"; it now counts under the "ملغي" chip.

**SALES-175** — confirmed → cancel transition.
Pre: `SRT-DEMO-1` (confirmed).
Steps: Open it, click "إلغاء المرتجع" (the confirmed-state cancel button — a different label from the draft-state one).
Assert: Status flips to "ملغي"; verify whether the "بانتظار دفع المبلغ" badge correctly disappears (it should, since `isAwaitingRefund` requires `status === "confirmed"`). **Caution**: this mutates seed data other scenarios depend on (SALES-058, SALES-167 reference `SRT-DEMO-1`) — run this against a fresh return created for the purpose instead if you need those other scenarios to stay reproducible.

**SALES-176** `[NOT IMPLEMENTED]` — No effects explainer on confirm.
Steps: Confirm a draft return.
Assert: No "what will happen" / restock-and-AR-reduction explainer block appears anywhere (unlike invoices' "تأثيرات هذه الفاتورة") — the confirm action just runs silently and the list/detail refresh via query invalidation.

**SALES-177** `[NOT IMPLEMENTED]` — No refund/treasury-voucher UI.
Pre: a confirmed, awaiting-refund return (e.g. `SRT-DEMO-1`).
Steps: Look for any way to record the cash refund from this screen.
Assert: None exists — no button, no link to `/treasury/vouchers`, no explanation of how "بانتظار دفع المبلغ" ever clears. (It structurally never clears on its own — see the seed-data note above.) A tester who needs to actually refund a customer must navigate to Treasury manually and create a disbursement voucher themselves, entirely outside this screen's guidance.

**SALES-178** — `held` field from the confirm response is dead data.
Pre: confirm any draft return.
Steps: Inspect the network response of the confirm call (`useConfirmSalesReturn`).
Assert: The response includes a `held: boolean` field that is never read or surfaced anywhere in the UI — confirm this is genuinely unused by grepping the screen file, and note it as dead API surface (informational, not a user-facing defect on its own).

**SALES-179** — Multi-invoice-line guard is unreachable via UI (defensive only).
Steps: Try to build a return whose lines reference two different source invoices.
Assert: Impossible through this UI — `changeInvoice()` always resets `lines` to items from the newly selected invoice only, so the domain's "كل بنود المرتجع يجب أن تنتمي لنفس الفاتورة." guard can never actually fire from this screen; it only protects a direct API caller.

**SALES-180** — Exact seeded values, `SRT-DEMO-1`.
Pre: `SRT-DEMO-1` — 20×ITEM-3@42 = 840.00 + 117.60 tax.
Steps: Open its detail panel.
Assert: Line reads "٢٠ × ٤٢٫٠٠" (or Latin equivalent in EN mode); confirm the list's قيمة المرتجع column for this row totals **957.60**.

**SALES-181** — Exact seeded values, `SRET-DEMO-1`.
Pre: `SRET-DEMO-1` — 5×ITEM-3@42 = 210.00 + 29.40 tax = 239.40.
Steps: Open its detail panel.
Assert: قيمة المرتجع reads **239.40**.

**SALES-182** — Combined effect on `INV-DEMO-1`, cross-referenced.
Pre: both `SRT-DEMO-1` (957.60) and `SRET-DEMO-1` (239.40) are confirmed against `INV-DEMO-1`.
Steps: Sum their values.
Assert: Combined returned value = **1,197.00** against `INV-DEMO-1`'s original grand total of 13,953.60 — cross-reference this exact figure against SALES-115's finding that the invoice's own "الرصيد المتبقي" does *not* reflect it.

**SALES-183** — List load error + retry.
Steps: Force the returns query to fail, reload.
Assert: "تعذّر تحميل مرتجعات المبيعات." card + "إعادة المحاولة" button (this screen, unlike Quotes, does have a dedicated error/retry card).

**SALES-184** — Cancel discards a new return.
Steps: Fill the create form, click nothing that saves, close the panel (or reuse إلغاء if present at the field level — confirm via the panel's own close control).
Assert: No return created, counts unchanged.

**SALES-185** — Empty-list state (hypothetical, requires a clean tenant).
Pre: on a tenant with zero returns (not the standard demo seed).
Steps: Load the list.
Assert: "لا توجد مرتجعات — أنشئ مرتجعاً جديداً".

**SALES-186** — Reload persistence for a full create-and-confirm cycle.
Steps: Create a new return against `INV-DEMO-5` (item ITEM-DEMO-7, qty 10 of 60), حفظ وتأكيد, then reload the whole page.
Assert: The new return persists with status مؤكد and "بانتظار دفع المبلغ", and its line/qty/value are exactly as entered.

**SALES-187** — "إنشاء مرتجع مبيعات" from an invoice's context.
Steps: Look for a shortcut to pre-fill a return's source invoice from an invoice's own detail page (per the catalog's "المزيد" menu claim).
Assert: `[NOT IMPLEMENTED]` — Sales Invoices has no "المزيد" menu at all (SALES-105), so this pre-filled shortcut does not exist; every return must be started from `/sales/returns` and the source invoice picked manually from the dropdown.

**SALES-188** — Run in English/LTR.
Steps: Toggle language on the list, create panel, and a return's detail panel.
Assert: Labels flip, layout mirrors, digits render Latin, the combined "قيمة المرتجع" total still computes correctly in the new locale.

---

### قوائم الأسعار (Price Lists) — `/sales/price-lists`

Unlike the reference product's empty tenant, this build's seed has 4 real price lists — letting several catalog claims be checked directly against real rows for the first time.

**SALES-189** — List columns with real data.
Pre: 4 seeded price lists.
Steps: Open `/sales/price-lists`.
Assert: 4 rows show. Columns: الاسم (bold, with الكود in mono/muted underneath), الوصف, عدد الأصناف (line count — `PL-DEMO-1`/`PL-BASE` reads 4), الحالة (a StatusPill "نشطة"/"غير نشطة", **plus** a second "قائمة أساسية" info pill when `isBase` — `PL-DEMO-1` shows both pills; `PL-DEMO-4` shows only "غير نشطة").

**SALES-190** — Stat cards.
Assert: "إجمالي القوائم" = 4, "النشطة" = 3 (all except deactivated `PL-DEMO-4`).

**SALES-191** `[NOT IMPLEMENTED]` — No filter chips, no search.
Assert: Neither exists on this screen at all, despite 4 real rows now available to filter/search against.

**SALES-192** `[NOT IMPLEMENTED]` — Rows are not clickable; create-only surface.
Steps: Click the `PL-DEMO-1` row.
Assert: Nothing happens — `onRowClick` is never passed, so there is no detail/edit view and no per-item price-line grid reachable from the UI at all, even though `PL-DEMO-1` genuinely has 4 priced lines behind it (visible only via its "عدد الأصناف" count, never their actual contents).

**SALES-193** — Create dialog, required fields.
Steps: Open "قائمة أسعار جديدة", leave الاسم blank, click حفظ.
Assert: Submit button stays disabled while `!code.trim() || !nameAr.trim()` — both الاسم and الكود are required to enable save (stricter than the catalog, which only marks both with `*` but doesn't specify a disabled-vs-error UX).

**SALES-194** — Create dialog, defaults and persistence.
Steps: Fill الاسم "قائمة اختبار", الكود "PL-TEST-1", leave الوصف blank, leave قائمة أساسية off, save, reload the list.
Assert: New row appears with "غير نشطة"... actually check: new price lists likely default active — confirm the status pill reads "نشطة" (not "غير نشطة") and no "قائمة أساسية" pill, since the toggle was left off. Reload confirms persistence.

**SALES-195** — Duplicate code rejection.
Steps: Create a new price list using الكود "PL-BASE" (already used by `PL-DEMO-1`).
Assert: Server rejects with a 409 `DuplicatePriceListError`; the message renders in the create dialog's red banner (exact text depends on the domain error, not client-validated).

**SALES-196** — قائمة أساسية toggle and its hint.
Steps: Open the create dialog, inspect the قائمة أساسية toggle.
Assert: Hint text reads "القائمة الأساسية تُطبّق افتراضياً على العملاء بلا قائمة أسعار محددة."; toggling it on and saving creates a second "base" list alongside `PL-DEMO-1` — confirm the domain either allows multiple base lists or rejects a second one (verify and record whichever behavior you observe, since the UI gives no warning either way).

**SALES-197** `[NOT IMPLEMENTED]` — No per-item price-line field in the create dialog.
Assert: Despite the backend accepting a `lines` array on `POST /price-lists` (and `PL-DEMO-1..4` all being seeded with real priced lines through that same endpoint), the create dialog never exposes any per-item pricing UI — a price list created through this screen always has zero lines.

**SALES-198** `[NOT IMPLEMENTED]` — No edit capability at all.
Steps: Look for any way to rename, redescribe, or otherwise modify an existing price list (e.g. `PL-DEMO-2`).
Assert: None exists — no `useUpdatePriceList` hook is wired anywhere in the frontend, even though the backend fully supports `PATCH /price-lists/:id`.

**SALES-199** `[NOT IMPLEMENTED]` — No deactivate/reactivate UI.
Pre: `PL-DEMO-4` is already deactivated (seeded via a direct API call).
Steps: Look for any button to reactivate `PL-DEMO-4`, or to deactivate an active one like `PL-DEMO-3`.
Assert: None exists anywhere on this screen — the "غير نشطة" pill on `PL-DEMO-4` is permanently read-only from the UI's perspective, even though the backend exposes both `POST /price-lists/:id/activate` and `/deactivate`.

**SALES-200** — Cancel discards.
Steps: Fill the create dialog, click إلغاء.
Assert: Dialog closes, no price list created.

**SALES-201** — Empty state text differs slightly from the catalog.
Pre: hypothetically, a tenant with zero price lists.
Assert: "لا توجد قوائم أسعار — أنشئ قائمة جديدة" (this build appends a CTA clause the reference product's plain "لا توجد قوائم أسعار" didn't have).

**SALES-202** — Load error state (currently silent).
Steps: Force the price-lists query to fail.
Assert: **No visible error card renders** — `query.isError` is never checked in the JSX, so a failed load looks identical to "still loading" or an empty list with no explanation. This is itself worth flagging: unlike Customers/Invoices/Returns, this screen has no load-failure UI at all.

**SALES-203** — Run in English/LTR.
Steps: Toggle language on the list and the create dialog.
Assert: Labels flip, digits render Latin, the two-pill status cell (نشطة + قائمة أساسية) still renders both pills correctly side by side in LTR.

---

### العروض (Promotions) — `/sales/promotions`, and its inline report

The catalog describes a 2-tab create dialog and a separate `/sales/promotions/report` route; this build has neither — the create dialog is a single flat panel missing most fields, and the report is an inline card at the bottom of the same list screen.

**SALES-204** — Header actions.
Steps: Open `/sales/promotions`.
Assert: Only "إضافة عرض" exists — there is no "تقرير العروض" header link/button (the report is inlined below instead, see SALES-221+).

**SALES-205** — KPI cards, real seeded value.
Pre: `PROMO-DEMO-1` (SUMMER10) — active as of 2026-08-24 (5 days into its window, ends December).
Assert: "الإجمالي" = 1, "فعال" = 1, "مجدول" = 0, "قرب الانتهاء" = 0 (more than 7 days remain until 2026-12-31).

**SALES-206** — Status chips, more than the catalog claims.
Assert: 4 chips exist — الكل / فعال / مجدول / قرب الانتهاء (catalog only described الكل/فعال) — but there is still **no** "منتهي" (ended) chip even though the client-side `deriveState()` computes an `ended` bucket internally; it's simply never surfaced as a chip.

**SALES-207** `[NOT IMPLEMENTED]` — No search box.
Assert: `searchValue`/`onSearchChange` props are unused — no search field renders on this screen.

**SALES-208** — List columns.
Steps: Inspect the `PROMO-DEMO-1` row.
Assert: 5 columns — الرمز (code + nameAr stacked), النوع ("نسبة خصم"), الفترة ("2026-08-19 → 2026-12-31"), الأولوية, الحالة (derived StatusPill "فعال"). No row-menu column exists at all (gap — no per-row action of any kind).

**SALES-209** — Create dialog is single-tab, not two.
Steps: Open "إضافة عرض".
Assert: One flat panel, not the catalog's البيانات الأساسية / النطاق tabs.

**SALES-210** — Required fields.
Steps: Leave الرمز or الاسم blank, try to save.
Assert: Submit stays disabled while `!code.trim() || !nameAr.trim()`.

**SALES-211** — قيمة الخصم % only renders for percentage type.
Steps: Set النوع = "نسبة خصم" (default).
Assert: قيمة الخصم % field appears (`min=0 max=100`, default 10). Now switch النوع to "خصم مبلغ", "سعر خاص", "اشتر واحصل على", or "حزمة".
Assert: `[NOT IMPLEMENTED]` — no equivalent field appears for any of these 4 other types (no amount-value field for fixed_amount/special_price, no buy/get quantity fields, no bundle-component picker) — selecting any type other than percentage leaves the form with literally no way to supply that type's required data, yet the type can still be selected and (attempted to be) saved.

**SALES-212** — Percent-range is not enforced at submit (only via the native input attribute).
Steps: With type = percentage, try to type 150 into قيمة الخصم % directly (bypassing the spinner arrows, e.g. via keyboard).
Assert: The field carries `min={0} max={100}` as HTML attributes but the form never calls `reportValidity()`/native constraint validation on submit — a value like 150 can be typed and the create button clicked. Verify what happens: expect a server-side 422 rejection ("نسبة الخصم يجب أن تكون بين 0 و 100.", `packages/domain/src/promotions/promotion.ts:91-137`) surfacing in the red banner, not a client-side block.

**SALES-213** — Date range default and order validation.
Steps: Open the create dialog fresh.
Assert: Both تاريخ البداية * and تاريخ الانتهاء * default to **today** (not "end blank" as the catalog implies) — so a naive save with only the dates left at default creates a same-day promotion. Now set تاريخ الانتهاء before تاريخ البداية, try to save.
Assert: Server rejects with "تاريخ البداية يجب ألا يتجاوز تاريخ النهاية." (client never checks this itself).

**SALES-214** — يتطلب كوبون toggle.
Steps: Toggle it on.
Assert: Hint text updates/confirms: "بدون تفعيل، يُطبّق العرض تلقائياً على الفواتير المطابقة." — matches `PROMO-DEMO-1`'s own `requiresCoupon: false` behavior (it auto-applies, as seen on `INV-DEMO-4`).

**SALES-215** `[NOT IMPLEMENTED]` — Missing fields vs. catalog.
Assert: None of the following exist on the create form: حد أدنى لقيمة الفاتورة, اشتر (كمية)/احصل على (كمية), الوصف, مكونات الحزمة, تقييد الأيام والساعات toggle, or any النطاق UI at all — every new promotion is silently created with `scope: { type: "all", ids: [] }` hardcoded, so **a user can never scope a promotion to a specific item or category through this UI**, unlike `PROMO-DEMO-1` itself (seeded via direct API, scoped to `ITEM-DEMO-4`).

**SALES-216** — Create, save, and reload — persistence check.
Steps: Create a promotion "TESTPROMO" / "عرض اختبار", type نسبة خصم, قيمة الخصم % = 15, leave dates at default, save.
Assert: New row appears in the list with status "فعال" (dates default to today→today, so it may immediately show as ending today/expiring — verify actual derived status); reload the list — the new promotion persists with its exact code/name/percent.

**SALES-217** `[NOT IMPLEMENTED]` — No row menu, no edit, no deactivate, no delete.
Steps: Look for any per-row action on any promotion, including `PROMO-DEMO-1`.
Assert: None exists anywhere — no edit dialog (`useUpdatePromotion` isn't wired despite `PATCH /promotions/:id` existing server-side), no deactivate button (despite `POST /promotions/:id/deactivate` existing), no delete.

**SALES-218** — Status derivation matches the domain formula.
Pre: `PROMO-DEMO-1` — start 2026-08-19, end 2026-12-31, today 2026-08-24.
Assert: `deriveState()` computes: scheduled if today < start (false here), ended if today > end (false), expiring if daysLeft ≤ 7 (false — >7 remain), else active → "فعال", matching SALES-205's KPI reading.

**SALES-219** — Cancel discards.
Steps: Fill the create dialog, click إلغاء.
Assert: No promotion created.

**SALES-220** — Empty-state and error strings.
Pre: hypothetically, an empty promotions tenant.
Assert: "لا توجد عروض" (matches catalog); a forced load failure shows **no visible error card** either (same silent-failure gap as Price Lists — `query.isError` unrendered in JSX).

**SALES-221** — Promotions report is inline, not a route.
Steps: Scroll to the bottom of `/sales/promotions`.
Assert: A "تقرير العروض" section renders inline on the same page (`PromotionUsageReport` component) — navigating directly to `/sales/promotions/report` does **not** exist as a route (`grep` for `PromotionsReport`/`promotions-report` in `App.tsx`'s `ROUTABLE_SCREENS` returns nothing).

**SALES-222** — Report columns, fewer than catalog.
Steps: Inspect the inline report table.
Assert: 5 columns — العرض (code+nameAr stacked), مرات الاستخدام, الخصم الممنوح, المعكوس بالمرتجعات, الصافي. Missing vs. catalog's 7: no separate الرمز/الاسم split, and critically **no النوع column at all**.

**SALES-223** `[NOT IMPLEMENTED]` — No KPI cards on the report.
Assert: None of عروض مستخدمة / عدد مرات الاستخدام / إجمالي الخصم الممنوح / صافي الخصم render anywhere near the inline report.

**SALES-224** `[NOT IMPLEMENTED]` — No period or branch filters; the report is unfilterable.
Steps: Look for هذا الشهر/الشهر الماضي/هذا الربع/هذه السنة chips, a من/إلى تاريخ picker, or a فرع filter near the report.
Assert: None exist. The underlying hook calls `GET /promotions/report` with **no query string at all**, even though the API route accepts `dateFrom`/`dateTo` — the frontend simply never sends them, so the report always covers the whole dataset with no way to narrow it.

**SALES-225** — Report reflects `INV-DEMO-4`'s real discount.
Pre: `INV-DEMO-4` earned SUMMER10's 10% discount at confirm (520.00 off the 5,200 gross line).
Steps: Read the SUMMER10 row in the inline report.
Assert: مرات الاستخدام ≥ 1, الخصم الممنوح includes the 520.00 from `INV-DEMO-4`, المعكوس بالمرتجعات reflects any of that discount reversed by a confirmed return against `INV-DEMO-4` (none seeded, so expect 0 here), الصافي = الخصم الممنوح − المعكوس بالمرتجعات.

**SALES-226** — Report empty state.
Pre: a date range or tenant with no promotion usage (not directly reachable given the report has no filters — this may only be observable on a genuinely fresh tenant).
Assert: "لا توجد عروض في الفترة."

**SALES-227** — Report load error (also silent).
Steps: Force the report's query to fail.
Assert: No visible error card renders — same unrendered-`isError` pattern as the rest of this screen (the "تعذّر تحميل تقرير استخدام العروض." string exists in code as a fallback but is never actually displayed in the JSX; confirm this precisely if you can force the failure).

**SALES-228** — Run in English/LTR.
Steps: Toggle language on the promotions list, the create dialog, and the inline report.
Assert: Labels flip, layout mirrors, digits render Latin; the 4 promotion-type labels in the النوع dropdown re-render in English.

---

### Out of scope

- **رحلات المندوبين (Van/Rep Trips)** — `/field/van-trips` — belongs to the separate Field Sales module, reachable from the Sales nav dropdown but not owned by it; not covered here per task scope.
- **POS** (`/pos/sales`, `/pos/refunds`) — explicitly out of scope per the task brief.
- **Installments** (`/installments/plans`, `/installments/follow-ups`) — its own module; only referenced here where a Sales screen links into it (and every such link, per the audits above, turned out not to exist in this build).
- **Reports module** (`/reports/sales/...`) — a separate top-level nav section; not audited here except where Customers' كشف حساب tab cross-references `/reports/aging/customers` for its reconciliation pill (SALES-058).

---

# 6. Purchases


Sources: `docs/archive/catalog/02-purchases.md` (captured from the running reference
product) cross-checked against the actual build — `apps/web/src/screens/{SuppliersScreen,RfqsScreen,PurchaseOrdersScreen,GoodsReceiptsScreen,PurchaseInvoicesScreen,PurchaseReturnsScreen,LandedCostsScreen}.tsx`,
`apps/web/src/screens/hubs/PurchasesHubScreen.tsx`, `apps/web/src/nav-config.ts`,
and the seed generator `packages/backend/src/demo-seed/purchasing.ts` (plus the
core `packages/backend/src/demo-seed.ts`). Every discrepancy between what the
catalog describes and what the code actually renders is marked
**`[NOT IMPLEMENTED]`** at the point it matters, with the file it was checked
against.

Login: `admin@cyag.example` / PIN `123456`. Reports (`/reports/purchases/*`,
`/reports/aging/suppliers`) and POS are out of scope — see §1 above
for how to run the app and cross-check the API directly.

### Seed data this file relies on

| Entity | Records |
|---|---|
| Suppliers | `SUPP-DEMO-1` مصنع الوادي الأخضر (S-0001, 30-day terms), `SUPP-DEMO-2` شركة سياج للصناعات (S-0002, 60-day terms) |
| Items | `ITEM-DEMO-1..8` — أرز أبيض٥كجم, زيت عباد الشمس١لتر, سكر أبيض١كجم, شاي أسود٥٠٠جم, خليط شاي بالسكر, خليط شاي بالنعناع, لبن كامل الدسم (batched/expiry), زبادي طبيعي (batched/expiry) |
| RFQs | `RFQ-DEMO-1` مغلق (2 quotes, converted → `PO-DEMO-3`), `RFQ-DEMO-2` مرسل (1 quote, not converted), `RFQ-DEMO-3` مسودة (no quotes) |
| Purchase Orders | `PO-DEMO-1` مسودة, `PO-DEMO-2` مستلم بالكامل (→ `GRN-DEMO-1` → `PI-DEMO-6`), `PO-DEMO-3` مستلم جزئياً (→ `GRN-DEMO-2` → `PI-DEMO-7`), `PO-DEMO-4` مرسل (receipt `GRN-DEMO-3` left as draft) |
| Goods Receipts | `GRN-DEMO-1` confirmed+invoiced, `GRN-DEMO-2` confirmed+invoiced (partial), `GRN-DEMO-3` **draft**, uninvoiced |
| Purchase Invoices | `PI-DEMO-1..5` confirmed, manual entry, no receipt link (`PI-DEMO-1` has a 60%-allocated supplier-payment voucher `VCH-DEMO-3` against it); `PI-DEMO-6`, `PI-DEMO-7` confirmed, created "from receipt" |
| Purchase Returns | `PRT-DEMO-1` confirmed (qty 20 of `ITEM-DEMO-2`, reason QUALITY_ISSUE, against `PI-DEMO-7`), `PRT-DEMO-2` **draft** (qty 12, same invoice/item, reason DEFECTIVE) |
| Landed Costs | `LC-DEMO-1` confirmed, BY_VALUE, SHIPPING 1800 + CLEARANCE 700 = 2500, over `ITEM-DEMO-1`/`ITEM-DEMO-3` from `GRN-DEMO-1`; `LC-DEMO-2` **draft**, BY_QUANTITY, INSURANCE 300 + CUSTOMS 450 = 750, single target `ITEM-DEMO-2` from `GRN-DEMO-2` |

### Cross-cutting findings (apply across every screen below — stated once)

- **No advanced filter panel anywhere in Purchases.** The catalog describes a
  collapsible "تصفية النتائج" panel (warehouse/supplier/date-range/amount-range)
  on every list. The shared `DocumentList` primitive
  (`packages/ui/src/primitives/DocumentList.tsx`) has no `filters`/`filterPanel`
  prop at all, and none of the seven Purchases screens builds one itself.
  **`[NOT IMPLEMENTED]`** on every list screen in this module.
- **No working column sorting anywhere in Purchases.** `DocumentList` supports
  a `sortable` column flag plus `sort`/`onSortChange`, but no Purchases screen
  passes them — every column header is inert. **`[NOT IMPLEMENTED]`**.
- **No real pagination anywhere in Purchases.** Every list passes
  `page={1} pageCount={1}` with no `onPageChange` handler — the entire result
  set always renders as one page, regardless of row count or a rows-per-page
  selector. **`[NOT IMPLEMENTED]`**.
- **Branch/warehouse are hardcoded to IDs that don't exist in this tenant.**
  `RfqsScreen.tsx`, `PurchaseOrdersScreen.tsx`, and `PurchaseInvoicesScreen.tsx`
  (both the manual and from-receipt save paths) all send
  `branchId: "MAIN", warehouseId: "MAIN-WH"` when creating a document — literal
  strings, with no picker in the UI to change them. The tenant's real IDs
  (`packages/backend/src/demo-seed/shared.ts`) are `BR-MAIN` / `WH-MAIN`. This
  is a code-level finding distinct from `ROADMAP.md` §5's D1–D6 — flagged
  where it matters below as **the branch/warehouse mismatch**.
- **Suppliers' "المستحق للمورد" is a static field, not a live balance.** The
  list column, its KPI total, and the detail-page summary card all render
  `supplier.openingBalance` directly — a number only ever set on the
  add/edit form — not a computed balance from confirmed invoices and voucher
  allocations. The detail page labels it honestly ("المستحق للمورد (الرصيد
  الافتتاحي)"); the list column and KPI tile do not carry that qualifier and
  read as a live payable. The *real* AP balance is only computed correctly on
  the supplier detail's كشف حساب المورد tab. Flagged where it matters below.

---

### الموردون (Suppliers)

#### List — `apps/web/src/screens/SuppliersScreen.tsx`

**PUR-01 — Search by name**
- Pre: on `/purchases/suppliers` (nav: المشتريات → الموردون).
- Steps: type "الوادي" into "ابحث باسم المورد أو الكود أو الهاتف…".
- Assert: only `SUPP-DEMO-1` (مصنع الوادي الأخضر) remains; `pageSummary` reads "عرض 1 من 2 مورد".

**PUR-02 — Search by code**
- Steps: clear search, type "S-0002".
- Assert: only `SUPP-DEMO-2` (شركة سياج للصناعات) remains.

**PUR-03 — Search by phone**
- Steps: type "01098765432".
- Assert: only `SUPP-DEMO-1` remains (matches the seeded phone exactly).

**PUR-04 — Search, no match**
- Steps: type "xyz-no-such-supplier".
- Assert: table renders the empty state "لا يوجد موردون مطابقون"; KPI tiles above stay unchanged (they reflect the whole set, not the filtered one).

**PUR-05 — Status tab نشط / غير نشط / الكل**
- Pre: both seed suppliers are `active: true`.
- Steps: click "غير نشط".
- Assert: chip count is 0 and the table is empty; click "نشط" → both suppliers show with count 2; click "الكل" → same 2, count matches "إجمالي الموردين" KPI.

**PUR-06 — No filter panel**
- Steps: look for a "تصفية النتائج" toggle near the search box.
- Assert: `[NOT IMPLEMENTED]` — none exists; the catalog's phone/balance-range filter fields are unreachable.

**PUR-07 — No column sorting**
- Steps: click the "المستحق للمورد" or "شروط الدفع" column header.
- Assert: `[NOT IMPLEMENTED]` — no sort indicator, no re-order; row order stays insertion order.

**PUR-08 — No real pagination**
- Steps: note `page=1, pageCount=1` is hardcoded regardless of row count.
- Assert: `[NOT IMPLEMENTED]` — with only 2 seed suppliers this is invisible, but the control simply doesn't exist; there is no rows-per-page selector either.

**PUR-09 — KPI "المستحق للموردين" does not match reality**
- Pre: neither seed supplier has an `openingBalance` set (defaults to 0), yet both have real confirmed purchase invoices with outstanding balances (e.g. `PI-DEMO-1` is only 60%-paid via `VCH-DEMO-3`).
- Steps: read the "المستحق للموردين" KPI tile on the list.
- Assert: it reads **٠٫٠٠** (sum of `openingBalance` across suppliers). Open `SUPP-DEMO-1` → كشف حساب المورد tab and read "الرصيد الختامي (مستحق للمورد)" — it is **non-zero**. The list KPI and the real AP balance disagree; this is a genuine, freshly observed defect (not in `ROADMAP.md` §5's D1–D6) — the list surfaces a static field labeled like a live balance.

**PUR-10 — Header actions**
- Steps: read the two header buttons.
- Assert: "إضافة مورد" opens the create panel. "تصنيفات الموردين" **`[NOT IMPLEMENTED]`** — no such button exists; see the Supplier Categories section below.

**PUR-11 — Add supplier: name required**
- Steps: open "إضافة مورد" → leave "اسم المورد *" blank → click "إضافة مورد".
- Assert: inline error "الاسم بالعربية مطلوب" appears (`role="alert"`); panel stays open; no request is sent.

**PUR-12 — Add supplier: code auto-generates when blank**
- Steps: fill only the name → save.
- Assert: with 2 existing suppliers the code is generated as `S000003` (`S${(count+1).padStart(6,"0")}`); reload the list — the new supplier persists with that code.

**PUR-13 — Add supplier: negative "شروط الدفع (أيام)" is not blocked**
- Steps: fill name, set شروط الدفع to `-5` (the number input's `min={0}` is a display attribute, not an enforced guard — `NumberField` passes `valueAsNumber` straight through).
- Assert: `[NOT IMPLEMENTED validation]` — no client-side rejection; the value is sent as-is on save. Note whatever the server does (accept or 400) — either way there is no field-level message.

**PUR-14 — Add supplier: negative "الرصيد الافتتاحي" is not blocked**
- Steps: fill name, set الرصيد الافتتاحي to `-100`.
- Assert: same as PUR-13 — no client guard; value passes through unchanged.

**PUR-15 — Add supplier: full field set, save persists and survives reload**
- Steps: fill اسم المورد, الهاتف, شروط الدفع, العملة, التصنيف, الرصيد الافتتاحي, الاسم بالإنجليزي, البريد الإلكتروني, الرقم الضريبي, جهة الاتصال, المدينة/الحي/الشارع, ملاحظات → "إضافة مورد".
- Assert: panel closes, new row appears in the list with the entered name/phone/terms/category; reload the page — same supplier, same field values on its detail page's "نظرة عامة" tab.

**PUR-16 — Add supplier: no logo upload, no Arabic-name/advanced-options split**
- Steps: inspect the create panel's field list against the catalog.
- Assert: `[NOT IMPLEMENTED]` — no "شعار" (logo) upload field. `[NOT IMPLEMENTED]` — no "خيارات متقدمة" expandable section; every field (email, tax number, contact, address, notes) is always visible, flat. `[NOT IMPLEMENTED]` — no country-code combobox on الهاتف; it is a plain `tel` text input with no +20 default.

**PUR-17 — Add supplier: cancel discards**
- Steps: open create panel, type a name, click "إلغاء".
- Assert: panel closes, no row is added, no request fires.

**PUR-18 — Edit supplier: code field is disabled**
- Steps: open `SUPP-DEMO-1` → تعديل.
- Assert: "الكود" input is disabled/read-only, pre-filled `S-0001`.

**PUR-19 — Edit supplier: deactivate via the نشط toggle**
- Steps: on the edit panel (only visible when editing, not on create), turn off "نشط" → حفظ التعديلات.
- Assert: list status tab "غير نشط" now shows this supplier; its status badge changes to "غير نشط" (tone neutral) on the detail page. There is no dedicated one-click "تعطيل" action anywhere — `[NOT IMPLEMENTED]` vs. the catalog's "المزيد → تعطيل" menu item.
- Reload and confirm the inactive state persisted.

**PUR-20 — Edit supplier: category is free text, not a picker**
- Steps: on the edit panel, type an arbitrary string into "التصنيف", e.g. "فئة تجريبية غير موجودة".
- Assert: it saves without validation against any category list — because there is no category list. See Supplier Categories below.

#### Supplier detail — `SuppliersScreen.tsx` (`SupplierDetail`)

**PUR-21 — Header actions**
- Pre: open `SUPP-DEMO-1`.
- Assert: only two actions exist — "تعديل" and "رجوع لقائمة الموردين". `[NOT IMPLEMENTED]` vs. catalog: no "إنشاء فاتورة مشتريات" header shortcut, no "المزيد" menu, no "نظرة 360°".

**PUR-22 — Quick-action row is entirely absent**
- Assert: `[NOT IMPLEMENTED]` — no إنشاء فاتورة مشتريات / صرف دفعة / إنشاء أمر شراء / عرض كشف الحساب quick-action row below the summary strip, as the catalog describes.

**PUR-23 — Tab: نظرة عامة**
- Assert: shows البريد الإلكتروني, جهة الاتصال, الرقم الضريبي, العنوان (joined "شارع، حي، مدينة"), and ملاحظات only if non-empty.

**PUR-24 — Tab: فواتير المشتريات matches real invoices**
- Pre: `SUPP-DEMO-1` has `PI-DEMO-1`, `PI-DEMO-3`, `PI-DEMO-4`, `PI-DEMO-6` (4 confirmed invoices, no drafts).
- Steps: open the tab.
- Assert: exactly those 4 rows appear, sorted by date desc (newest first — most recent `PI-DEMO-6` 2026-08-12 on top); "عدد الفواتير"=4, "فواتير مؤكدة"=4, "إجمالي المؤكد" equals the sum of their `total` fields, "آخر فاتورة" shows `PI-DEMO-6`'s date.

**PUR-25 — Tab: فواتير المشتريات empty state**
- Pre: pick a supplier with zero invoices (create one via PUR-15 without ever invoicing it).
- Assert: "لا توجد فواتير مشتريات مسجّلة لهذا المورد" with the hint text about the فواتير المشتريات screen.

**PUR-26 — Tab: كشف حساب المورد reconciles**
- Pre: `SUPP-DEMO-1`; `VCH-DEMO-3` (confirmed supplier_payment, 60% of `PI-DEMO-1`'s outstanding) is allocated.
- Steps: open كشف حساب المورد.
- Assert: rows include "رصيد افتتاحي", one "فاتورة مشتريات" credit row per confirmed invoice, and a "سند صرف للمورد" debit row for `VCH-DEMO-3` noting "مخصص على الفاتورة PI-DEMO-1" (or its display number); the reconciliation pill reads "مطابق لدفتر الفواتير المفتوحة" (compares against `GET /open-invoices?kind=purchase`) and, if the aging report responds, "مطابق لتقرير أعمار الديون" — if either pill instead reads "يختلف عن …", record the measured mismatch amount as a new finding, not a re-file of D1 (D1 is specifically about AR/customer collections not moving `amountPaid`; this tab uses the allocation sub-ledger directly and should not exhibit D1).
- Confirm no raw i18n key (`customers.openingBalance`) leaks anywhere on this tab — the catalog's reference-product bug does **not** reproduce here; the label reads "رصيد افتتاحي" correctly.

**PUR-27 — Tab: كشف حساب المورد aging table**
- Assert: the "أعمار فواتير هذا المورد" table renders جاري / 31-60 / 61-90 / 91-120 / أكثر من 120 / الإجمالي buckets, sourced from `/reports/aging/suppliers`, and its total is cross-checked against the closing balance via the "مطابق/يختلف عن تقرير أعمار الديون" pill.

**PUR-28 — Missing tabs**
- Assert: `[NOT IMPLEMENTED]` — no أوامر الشراء tab, no مرتجعات المشتريات tab, no المرفقات tab (the code explicitly notes "this build has no file-storage subsystem of any kind"), no سجل المراجعة (audit log) tab. Catalog lists all four.

#### تصنيفات الموردين (Supplier Categories)

**PUR-29 — Entire feature is not implemented**
- Steps: look for any way to reach a categories list/modal from Suppliers.
- Assert: `[NOT IMPLEMENTED]` — confirmed by reading `SuppliersScreen.tsx` in full: there is no "تصنيفات الموردين" button, no modal, no dedicated categories API call. "التصنيف" on the supplier form is a plain free-text field with no typeahead, no backing list, and no validation against prior values (PUR-20). The catalog's entire "تصنيفات الموردين" screen — its empty state, its "إضافة تصنيف" inline panel, its `اسم التصنيف *`/`الاسم بالعربية` fields — has no equivalent anywhere in the build.

---

### طلبات عروض الأسعار (RFQs)

#### List — `apps/web/src/screens/RfqsScreen.tsx`

**PUR-30 — Search by number**
- Pre: on `/purchases/rfqs`.
- Steps: type the number of `RFQ-DEMO-1` (read it off the list first, e.g. `RFQ-000001`) into "ابحث برقم الطلب…".
- Assert: only that row remains.

**PUR-31 — Status tabs with counts**
- Assert: chips الكل=3 / مسودة=1 (`RFQ-DEMO-3`) / مرسل=1 (`RFQ-DEMO-2`) / مغلق=1 (`RFQ-DEMO-1`) / ملغي=0. Click مغلق → only `RFQ-DEMO-1` shows.

**PUR-32 — No ملغي RFQ exists in seed data**
- Steps: click ملغي.
- Assert: empty result (count 0) — cancelling an RFQ can only be exercised live (see PUR-40); the seed never produces one.

**PUR-33 — No filter panel / no sorting / no real pagination**
- Assert: `[NOT IMPLEMENTED]` — same cross-cutting gaps; the catalog's من/إلى تاريخ, البنود range, العروض range, and أمر الشراء filter are all unreachable.

**PUR-34 — KPI strip**
- Assert: "إجمالي الطلبات"=3, "مرسلة"=1, "مغلقة (محوّلة)"=1, "مسودة"=1 — matches the status counts above exactly (no separate KPI query, computed client-side from the same list).

**PUR-35 — Empty state**
- Pre: filter to a status/search combination with zero matches, e.g. search "zzz".
- Assert: "لا توجد طلبات عروض أسعار — أنشئ طلب عرض سعر لمقارنة أسعار الموردين قبل إصدار أمر الشراء" (same copy is also the true empty-tenant state).

**PUR-36 — Create RFQ: required fields**
- Steps: open "طلب عرض سعر جديد" with all lines empty (default one blank line with no item picked) → try to save.
- Assert: "حفظ" is disabled (`canSave` requires at least one line with an item and qty>0) — no inline error is ever shown because submission is blocked at the button, not after an attempt.

**PUR-37 — Create RFQ: add/remove lines**
- Steps: add a second line via "إضافة بند"; remove the first via "حذف البند" (only enabled when >1 line exists — the sole remaining line has no delete button).
- Assert: line list updates correctly; the delete button is absent on a single-line form.

**PUR-38 — Create RFQ: negative quantity is silently dropped, not rejected**
- Steps: pick an item, set الكمية to `-3`.
- Assert: `[NOT IMPLEMENTED validation]` — no error message; on save, `usable = lines.filter(l => l.itemId !== "" && l.qty > 0)` silently excludes that line. If it was the only line, "حفظ" stays disabled with no explanation of why.

**PUR-39 — Create RFQ: no branch/warehouse picker — the hardcoded-ID bug**
- Steps: create an RFQ with one valid line (e.g. `ITEM-DEMO-2`, qty 50) → حفظ.
- Assert: no branch or warehouse field exists anywhere on this form. The request is sent with `branchId: "MAIN", warehouseId: "MAIN-WH"` (see cross-cutting note) — neither ID exists in this tenant (real ones are `BR-MAIN`/`WH-MAIN`). Confirm whether the save succeeds anyway or the panel shows a generic failure banner; either result is worth recording precisely, since it is the first place in the app a user can hit this mismatch through ordinary use.

**PUR-40 — Create RFQ: save persists and survives reload; cancel discards**
- Steps: save a valid RFQ → reload the page → find it in the list. Separately, open create, type into a field, click "إلغاء".
- Assert: saved RFQ appears with مسودة status and the entered lines after reload. Cancelled attempt adds nothing.

#### RFQ detail — `RfqsScreen.tsx` (`RfqDetail`)

**PUR-41 — مسودة detail: RFQ-DEMO-3**
- Steps: open `RFQ-DEMO-3`.
- Assert: actions are "إرسال" and "إلغاء الطلب" (plus رجوع); effects panel reads the 3-line explainer ("لا يؤثر... مستند تحضيري فقط" / "بعد الإرسال يمكن تسجيل عروض..." / "تحويل عرض مختار..."); tabs البنود(1)/العروض(0)/مقارنة العروض; العروض tab shows "لا توجد عروض أسعار مسجلة بعد" and — since status isn't "sent" — **no** quote-entry form (it only appears once sent); مقارنة العروض shows "سجّل عرضاً واحداً على الأقل لعرض المقارنة".

**PUR-42 — Send RFQ-DEMO-3**
- Steps: click "إرسال".
- Assert: status pill flips to مرسل (tone info); actions now show "إغلاق بدون تحويل" and "إلغاء الطلب" instead of "إرسال"; العروض tab now shows the quote-entry form (المورد picker + one price field per line + ملاحظات + "حفظ العرض").
- Reload and confirm the status persisted.

**PUR-43 — مرسل detail: RFQ-DEMO-2, register a second quote**
- Pre: `RFQ-DEMO-2` already has one quote (`RFQQ-DEMO-3`, from `SUPP-DEMO-1`).
- Steps: open it → العروض tab → the supplier picker in "تسجيل عرض سعر جديد" — check its options.
- Assert: `SUPP-DEMO-1` is excluded from the picker (`alreadyQuotedSupplierIds`), leaving only `SUPP-DEMO-2` selectable — a supplier cannot quote twice on the same RFQ via this form. Fill a price for each line (leave one at 0) → "حفظ العرض" is enabled once at least one line has price>0 (`priced.length===0` blocks it, but the button's `disabled` only checks `!quoteSupplier`, not `priced.length` — try submitting with **all** prices at 0 and confirm nothing happens, since `submitQuote()` returns early with no error message: `[NOT IMPLEMENTED validation]`, a silent no-op rather than a disabled button or an inline error).

**PUR-44 — مقارنة العروض with two quotes**
- Pre: after PUR-43, `RFQ-DEMO-2` has quotes from both suppliers.
- Assert: comparison table has one row per line item and one column per supplier that quoted; the cheaper price per row is bold/success-colored (`cheapestSupplierId`); a footer row totals each supplier's "سلة كاملة" — if a supplier didn't price every line, their total cell reads "غير مكتمل" instead of a number; since status is "sent", a "تحويل إلى أمر شراء" button appears under whichever supplier(s) have a complete total.

**PUR-45 — Convert RFQ-DEMO-2's cheaper quote to a PO**
- Steps: click "تحويل إلى أمر شراء" under the cheaper supplier.
- Assert: a new PO is created (draft-confirmed automatically per the `/rfqs/:id/convert` contract used by the seed for `RFQ-DEMO-1`→`PO-DEMO-3`) linked to this RFQ; the RFQ's status becomes مغلق and its "أمر الشراء المرتبط" summary field now shows the new PO's id; back on the RFQs list, the أمر الشراء column for this row is populated; go to Purchase Orders and confirm the new PO exists with lines matching the winning quote's prices and the RFQ's requested quantities.
- Watch: while converting, `pendingConvertSupplierId` disables *all* convert buttons — click-spamming or double-clicking the button must not create two POs; confirm only one PO results.

**PUR-46 — مغلق detail: RFQ-DEMO-1, read-only history**
- Steps: open `RFQ-DEMO-1`.
- Assert: no send/close/cancel actions remain (status is terminal); "أمر الشراء المرتبط" reads `PO-DEMO-3`; العروض tab lists both `RFQQ-DEMO-1` (السعر شامل النقل... note) and `RFQQ-DEMO-2`; مقارنة العروض highlights `SUPP-DEMO-2` (سياج) as cheapest on the total row (26,880 vs 26,980, matching the seed comment) even though سياج's شاي price (208) is individually the pricier one on that line — confirm the *per-line* cheapest highlight for شاي correctly shows `SUPP-DEMO-1` (203) in success color while the *total* column still favors سياج.

**PUR-47 — إغلاق بدون تحويل**
- Pre: any مرسل RFQ with at least one quote that you do not intend to convert (use a freshly created test RFQ, not `RFQ-DEMO-2` which PUR-45 already converts).
- Steps: send it, add one quote, click "إغلاق بدون تحويل".
- Assert: status becomes مغلق with **no** "أمر الشراء المرتبط" (stays "—") — a closed-without-converting RFQ is distinguishable from a closed-by-conversion one only by that field, since both show مغلق. Confirm the RFQs list الحالة column can't tell them apart either — worth noting as a minor UX gap, not a hard defect.

**PUR-48 — إلغاء الطلب**
- Pre: a fresh مسودة or مرسل RFQ.
- Steps: click "إلغاء الطلب".
- Assert: status becomes ملغي (tone danger); no further actions are available; reload and confirm it persisted, and that it now appears under the ملغي status chip on the list (finally giving that chip a non-zero count).

---

### أوامر الشراء (Purchase Orders)

#### List — `apps/web/src/screens/PurchaseOrdersScreen.tsx`

**PUR-49 — Search by number or supplier name**
- Steps: search the number of `PO-DEMO-2`; clear and search "سياج" instead.
- Assert: number search returns exactly `PO-DEMO-2`; supplier-name search returns `PO-DEMO-1` and `PO-DEMO-3` (both against `SUPP-DEMO-2`, Siyaj).

**PUR-50 — Status tabs, all 5 states populated**
- Assert: الكل=4, مسودة=1 (`PO-DEMO-1`), مرسل=1 (`PO-DEMO-4`), مستلم جزئياً=1 (`PO-DEMO-3`), مستلم بالكامل=1 (`PO-DEMO-2`), ملغي=0. This is the one Purchases list where every non-cancelled status has a seeded example — use it to visually confirm each `StatusPill` tone (neutral/info/warning/success).

**PUR-51 — KPI strip**
- Assert: "إجمالي الأوامر"=4, "طلبات مرسلة"=1 (only counts literal `status==="sent"`, i.e. `PO-DEMO-4` — **not** partially/fully received ones, even though those are also "sent" in spirit), "إجمالي القيمة"=sum of all 4 subtotals, "مستلم بالكامل"=1.

**PUR-52 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting; catalog's المستودع/تصفية حسب المورد/من-إلى تاريخ filters are unreachable, and the "1" active-filter badge the catalog shows never appears since there is no filter state to badge.

**PUR-53 — Empty state**
- Steps: search for a non-existent order number.
- Assert: "لا توجد أوامر شراء مطابقة".

**PUR-54 — Create PO: supplier required**
- Steps: open "أمر شراء جديد" without picking a supplier.
- Assert: "حفظ مسودة" stays disabled (`canSave` requires `supplier !== null`); no inline message is shown.

**PUR-55 — Create PO: item pick auto-fills unit price from item cost**
- Steps: pick `ITEM-DEMO-1` on a line.
- Assert: سعر الوحدة auto-fills to 140 (the item's `costPrice`); it remains editable afterward.

**PUR-56 — Create PO: negative quantity silently dropped; negative price passed through**
- Steps: line A: qty `-2`, valid item. Line B: qty 5, سعر الوحدة `-10`.
- Assert: on save, line A is excluded from the payload entirely (filter is `qty > 0`, same silent-drop behavior as PUR-38); line B **is** sent with a negative unit price since there's no client guard on price — watch for either a server 400 (generic error banner, no field-level message) or a silently-accepted negative-total PO. Either result is a finding worth recording precisely.

**PUR-57 — Create PO: no branch/warehouse/currency/expected-delivery fields — the hardcoded-ID bug again**
- Steps: inspect the full field list of the create panel against the catalog's described "بيانات أمر الشراء" section (المورد / التاريخ / تاريخ التسليم المتوقع / الفرع / المستودع / العملة).
- Assert: `[NOT IMPLEMENTED]` — only المورد, التاريخ, and ملاحظات exist. تاريخ التسليم المتوقع, الفرع, المستودع, and العملة have no UI field at all. The create call sends the same hardcoded `branchId: "MAIN", warehouseId: "MAIN-WH"` as PUR-39 (see cross-cutting note) with no `expectedDeliveryDate` in the payload whatsoever — a PO created through this screen can never have an expected-delivery date, even though the PO detail page has a summary row for it (shows "—" for every UI-created order).

**PUR-58 — Create PO: no variant picker, no inline item creation**
- Assert: `[NOT IMPLEMENTED]` — catalog describes "اختيار متغير" (pick variant) and an inline "إضافة صنف" (create new item without leaving the form) inside the item picker itself. The actual item `EntityPicker` only selects from existing items; "إضافة صنف" in this build is just the button that appends another blank order line.

**PUR-59 — Create PO: no attachments widget**
- Assert: `[NOT IMPLEMENTED]` — no "المرفقات" sidebar section on the create form.

**PUR-60 — Create PO: save is always a draft — no combined "confirm and send" at creation**
- Steps: fill supplier + one line → observe the single save button.
- Assert: it reads "حفظ مسودة" only — there is no second "تأكيد وإرسال" action available during creation (unlike the catalog's description of two duplicated header/sidebar buttons). Confirming only becomes possible afterward, from the detail page of the resulting draft (PUR-63).

**PUR-61 — Create PO: save persists and survives reload; cancel discards**
- Steps: save a valid PO with 2 lines → reload → open it from the list.
- Assert: lines, supplier, subtotal all match what was entered. Separately: open create, fill a field, click "إلغاء" — nothing is added.

#### PO detail — `PurchaseOrdersScreen.tsx` (`OrderDetail`)

**PUR-62 — "المستودع" shows a raw ID, not a name**
- Steps: open any PO (e.g. `PO-DEMO-2`) → read the "المستودع" summary row.
- Assert: it renders `order.warehouseId` directly (e.g. the literal string stored for this record) rather than a resolved warehouse name — the screen never looks up `useWarehouses()` to translate the ID. This is a small but concrete, easily-observed presentation defect distinct from the branch/warehouse *creation* bug above.

**PUR-63 — مسودة detail: PO-DEMO-1**
- Steps: open `PO-DEMO-1`.
- Assert: action "تأكيد وإرسال" is present (plus رجوع); effects panel: 3-line explainer ("لا يؤثر أمر الشراء... يسجّل التزاماً... فقط" / "عند تأكيد إيصال الاستلام..." / "عند تأكيد فاتورة المشتريات..."); البنود tab shows both lines with مستلم=0 and المتبقي=qty for each (nothing received yet, correctly, since it's still a draft — it can't even be received against, see PUR-71).

**PUR-64 — Confirm PO-DEMO-1**
- Steps: click "تأكيد وإرسال".
- Assert: status flips مسودة→مرسل (tone info); the action disappears (no further status-changing actions exist on this screen for a sent order — see PUR-68); reload and confirm it persisted; on the list, "طلبات مرسلة" KPI increments by 1.

**PUR-65 — مستلم بالكامل detail: PO-DEMO-2**
- Steps: open `PO-DEMO-2`.
- Assert: no action buttons besides رجوع (already fully received, nothing left to confirm); البنود shows both lines with مستلم==الكمية and المتبقي=0 (rice 100/100, sugar 300/300).

**PUR-66 — مستلم جزئياً detail: PO-DEMO-3**
- Steps: open `PO-DEMO-3`.
- Assert: oil line reads مستلم=120, المتبقي=80 (of 200 ordered); tea line reads مستلم=0, المتبقي=60 (of 60 ordered, nothing received at all) — the partial-receipt state is visible per-line, not just at the header status.

**PUR-67 — مرسل detail: PO-DEMO-4 (receipt still draft)**
- Steps: open `PO-DEMO-4`.
- Assert: sugar line reads مستلم=0, المتبقي=250 — status stays مرسل (not مستلم جزئياً) because `GRN-DEMO-3` was deliberately never confirmed. This is the seed's intentional no-GL-entry setup case; see the end-to-end section below for the reconciliation check.

**PUR-68 — No cancel path for a Purchase Order, anywhere**
- Assert: `[NOT IMPLEMENTED]` — `ملغي` is a valid `PurchaseOrderStatusDTO` value (rendered correctly in the status label/tone maps if it ever occurred) but no button on the list or detail ever transitions a PO to it. A PO, once created, can only progress forward through مرسل→مستلم جزئياً/بالكامل — it can never be cancelled through the UI.

---

### استلام البضائع (Goods Receipts)

#### List — `apps/web/src/screens/GoodsReceiptsScreen.tsx`

**PUR-69 — Search by number or supplier**
- Steps: search `GRN-DEMO-2`'s displayed number; clear and search "الوادي" (Green Valley's Arabic name substring).
- Assert: number search isolates that one receipt; supplier search returns the receipts against `SUPP-DEMO-1` (`GRN-DEMO-1`).

**PUR-70 — Status tabs — "غير مفوترة" is a KPI/column, not a filterable tab**
- Assert: chips are only الكل(3)/مسودة(1, `GRN-DEMO-3`)/مؤكد(2)/ملغي(0). `[NOT IMPLEMENTED]` vs. catalog's 4th tab "غير مفوترة" — the uninvoiced concept exists (see the حالة الفاتورة column and the "غير مفوترة" KPI tile) but there is no way to click-filter the list down to it.

**PUR-71 — KPI strip**
- Assert: "إجمالي الإيصالات"=3, "مؤكدة"=2, "إجمالي القيمة"=sum of all 3 `totalCost` (including the draft one — confirm this is deliberate: the KPI sums every receipt regardless of status, not just confirmed ones), "غير مفوترة"=1 (`GRN-DEMO-3`, the only confirmed-or-draft receipt with `invoiced:false` among... actually recompute: this counts **all** receipts with `!invoiced`, so it should be `GRN-DEMO-3` only, since `GRN-DEMO-1`/`GRN-DEMO-2` are both invoiced — confirm the tile reads 1, not 3).

**PUR-72 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting; catalog's المستودع/المورد/تاريخ/تكلفة filters unreachable.

**PUR-73 — Empty state**
- Steps: search a non-existent number.
- Assert: "لا توجد إيصالات استلام مطابقة".

#### Create receipt

**PUR-74 — PO picker excludes non-receivable orders**
- Steps: open "إيصال استلام جديد" → check "أمر الشراء *" options.
- Assert: only `PO-DEMO-3` (مستلم جزئياً) and `PO-DEMO-4` (مرسل) appear — `PO-DEMO-1` (مسودة) and `PO-DEMO-2` (مستلم بالكامل) are excluded (`receivableOrders` filters to `status === "sent" || "partially_received"`). This is the gate enforced client-side: **you cannot even attempt to receive against a draft or already-fully-received PO** through this screen — you'd have to know the PO id and call the API directly.

**PUR-75 — No editable line quantities — full-outstanding-qty auto-fill only**
- Steps: pick `PO-DEMO-4` in the picker.
- Assert: a read-only preview table appears ("البنود (معبأة تلقائياً من أمر الشراء)") pre-filled with the item's full outstanding quantity (250 sugar) and unit cost — there is **no** input to reduce or increase that quantity. `[NOT IMPLEMENTED]` — the API demonstrably supports partial per-line quantities (the seed posts `GRN-DEMO-2` with an explicit `lines: [{itemId, qty:"120", unitCost:"72"}]` directly against the API, receiving only 120 of the 200 oil ordered and 0 of the 60 tea), but **no UI control exists to do a partial receipt, and none exists to over-receive** — both the "receive less than ordered" and "receive more than ordered" boundary tests from this file's brief can only be exercised via direct API call, not through any button in this build.

**PUR-76 — Draft-note banner text**
- Assert: the info banner reads exactly "إيصال مسودة — أكّده لاحقاً ليثبت البضاعة في المخزون. الضريبة تُسجّل عند فاتورة المشتريات المطابقة."

**PUR-77 — Save persists and survives reload; cancel discards**
- Steps: create a receipt against `PO-DEMO-4` (the only order with a full remaining line still worth testing, since `PO-DEMO-3`'s tea line is also outstanding) → "حفظ مسودة" → reload → find it in the list as a second draft receipt against `PO-DEMO-4`.
- Assert: persists with مسودة status, invoiced=false. Separately: open create, pick a PO, click "إلغاء" — nothing added.
- Note: this creates a **second** open receipt against `PO-DEMO-4` alongside the seeded `GRN-DEMO-3` — both draw from the same outstanding line; confirming one does not check whether the other's preview quantity updates live (it won't, since the preview reads from the PO's stale `receivedQty` in the already-fetched list) — worth a follow-up scenario if pursued further, not asserted here.

#### Receipt detail — `GoodsReceiptsScreen.tsx` (`ReceiptDetail`)

**PUR-78 — مسودة detail: GRN-DEMO-3**
- Steps: open `GRN-DEMO-3`.
- Assert: action "تأكيد الاستلام" present; effects panel (draft variant): "إيصال مسودة — أكّده ليثبت البضاعة في المخزون." / "الضريبة والمستحق للمورد يُسجّلان لاحقاً عند فاتورة المشتريات المطابقة."; حالة الفوترة reads "غير مفوتر".

**PUR-79 — Confirm GRN-DEMO-3 — the documented no-GL-entry state**
- Pre: note GL 1200 (inventory) and the inventory sub-ledger balance before confirming (via `/reconciliation` or the accounting reports, per §1 above's curl instructions).
- Steps: click "تأكيد الاستلام".
- Assert: status flips to مؤكد; effects panel switches to the confirmed variant ("تمت زيادة كمية المخزون..." / "لم تُسجّل الضريبة أو المستحق للمورد بعد..." / "تم تحديث حالة أمر الشراء..."); `PO-DEMO-4`'s status becomes مستلم بالكامل (sugar line was its only line, now fully received) — reload the PO to confirm.
- **This is the documented case**: stock rises by the received quantity with **no GL entry** — the inventory sub-ledger is now ahead of GL 1200 by exactly this receipt's `totalCost`, until an invoice against it is confirmed. This is by design, not a defect — do not re-file it. Measure the exact gap (it should equal `GRN-DEMO-3`'s totalCost) and leave the receipt confirmed-but-uninvoiced to prove the gap is real, or proceed to invoice it (PUR-97) to close it.

**PUR-80 — مؤكد + مفوتر detail: GRN-DEMO-1**
- Steps: open `GRN-DEMO-1`.
- Assert: no action buttons besides رجوع; حالة الفوترة reads "مفوتر" (tone success); البنود shows rice(100@140) and sugar(300@31) with computed line totals.

**PUR-81 — مؤكد + مفوتر, partial: GRN-DEMO-2**
- Steps: open `GRN-DEMO-2`.
- Assert: single line, oil 120@72=8,640; حالة الفوترة "مفوتر"; confirm this receipt's total does **not** include the 60 tea units that were never received (they were on the PO but never appear on this receipt at all — the receipt only ever recorded what was actually received).

**PUR-82 — No cancel path for a Goods Receipt**
- Assert: `[NOT IMPLEMENTED]` — same pattern as POs; ملغي exists as a status value with a defined tone but is unreachable from any button.

---

### فواتير المشتريات (Purchase Invoices)

#### List — `apps/web/src/screens/PurchaseInvoicesScreen.tsx`

**PUR-83 — Search by number or supplier**
- Steps: search `PI-DEMO-6`'s displayed number; then search "سياج".
- Assert: number search isolates it; supplier search returns every invoice against `SUPP-DEMO-2` (`PI-DEMO-2`, `PI-DEMO-5`, `PI-DEMO-7`).

**PUR-84 — Status tabs — no payment-lifecycle states at all**
- Assert: chips are only الكل(7)/مسودة(0)/مؤكد(7)/ملغي(0). `[NOT IMPLEMENTED]` — the catalog's متأخر (overdue), مستحقة قريباً (due soon), مدفوع جزئياً, مدفوع states do not exist anywhere in this screen's status enum (`PurchaseInvoiceStatusDTO` is just draft/confirmed/cancelled). Every invoice, however partially or fully paid, always shows مؤكد.

**PUR-85 — Columns — no remaining-balance or "بواسطة" column**
- Assert: `[NOT IMPLEMENTED]` — columns are رقم الفاتورة / المورد / التاريخ / الإجمالي / الحالة. The catalog's تاريخ الاستحقاق and المبلغ المتبقي columns are missing entirely (replaced by plain التاريخ and الإجمالي), and there is no "بواسطة" (created-by) column.

**PUR-86 — KPI strip**
- Assert: "إجمالي الفواتير"=7, "مؤكدة"=7, "إجمالي المشتريات"=sum of all 7 totals, "مسودة"=0.

**PUR-87 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting.

**PUR-88 — Header actions — no historical import**
- Assert: only "فاتورة مشتريات جديدة" exists. `[NOT IMPLEMENTED]` — no "استيراد فواتير سابقة" button, no import modal, no template-download link, anywhere in the code. The entire historical-import feature the catalog describes (fully-paid-vs-remaining-balance handling, per-line Excel upload, "استيراد N فاتورة" counter) is absent.

**PUR-89 — Empty state**
- Steps: search a non-existent number.
- Assert: "لا توجد فواتير مطابقة".

#### Create invoice

**PUR-90 — طريقة الإنشاء toggle**
- Steps: open "فاتورة مشتريات جديدة" → observe the two chips.
- Assert: "إنشاء فاتورة جديدة" (manual, default active) and "من إيصال استلام" (from-receipt); switching changes the whole form below.

**PUR-91 — Manual mode: supplier required**
- Steps: leave المورد unset with a valid line.
- Assert: "حفظ مسودة" stays disabled (`canSave` requires `supplier !== null`).

**PUR-92 — Manual mode: line kind toggle مخزني / مصروف شحن**
- Steps: on a line, switch to "مصروف شحن".
- Assert: the item `EntityPicker` is replaced by a "وصف المصروف" text field (placeholder "شحن / جمارك…"); ضريبة % resets to 0 automatically when switching to expense (`taxRatePercent: 0` on toggle) but remains editable afterward; switch back to "مخزني" and confirm the item picker returns.

**PUR-93 — Manual mode: item pick auto-fills cost and tax rate**
- Steps: pick `ITEM-DEMO-4` on an inventory-kind line.
- Assert: التكلفة auto-fills to 205 (item's costPrice); ضريبة % auto-fills to 14 (item's taxRatePercent) — both remain editable.

**PUR-94 — Manual mode: negative quantity dropped, negative cost passed through**
- Same pattern as PUR-38/PUR-56: a qty<0 line vanishes from the save payload silently (`l.qty > 0` filter); a qty>0 line with a negative التكلفة is sent as-is (no client guard) — record whatever the server does.

**PUR-95 — Manual mode: no branch/warehouse fields — hardcoded-ID bug (3rd occurrence)**
- Assert: same as PUR-39/PUR-57 — `branchId: "MAIN", warehouseId: "MAIN-WH"` hardcoded, no picker, mismatched against the tenant's real `BR-MAIN`/`WH-MAIN`.

**PUR-96 — From-receipt mode: only confirmed, uninvoiced receipts are selectable**
- Pre: at seed state, `GRN-DEMO-1` and `GRN-DEMO-2` are already invoiced; `GRN-DEMO-3` is still draft.
- Steps: switch to "من إيصال استلام" → check "إيصال الاستلام *" options **before** doing PUR-79.
- Assert: the picker is **empty** and shows "لا توجد إيصالات غير مفوترة" — this is a genuinely testable empty state that only appears in this exact seed configuration. Confirm no supplier field appears in this mode (it's inferred from the picked receipt).

**PUR-97 — From-receipt mode: invoice GRN-DEMO-3 after confirming it**
- Pre: complete PUR-79 (confirm `GRN-DEMO-3`) first.
- Steps: reopen create → من إيصال استلام → pick the now-eligible `GRN-DEMO-3` receipt.
- Assert: a read-only preview populates from the receipt's lines (sugar 250@31); رقم فاتورة المورد optional; "حفظ مسودة" enabled; save → status مسودة; confirm (PUR-101 pattern) → AP rises by this invoice's total and the sub-ledger/GL 1200 gap opened by PUR-79 closes. Verify with `/reconciliation` that the gap measured in PUR-79 is now zero.

**PUR-98 — Save persists and survives reload; cancel discards**
- Steps: create a manual invoice against `SUPP-DEMO-1` with one inventory line and one expense line → حفظ مسودة → reload → open it.
- Assert: both lines persist with correct kind/qty/cost/tax; subtotal/tax/total recompute correctly on reload, not just client-side. Separately: cancel discards.

#### Invoice detail — `PurchaseInvoicesScreen.tsx` (`InvoiceDetail`)

**PUR-99 — Manual invoice detail: PI-DEMO-1**
- Steps: open `PI-DEMO-1`.
- Assert: "المصدر" reads "إدخال يدوي"; effects panel (no-receipt variant): "تُضاف الأصناف المخزنية إلى المخزون..." / "يزيد المستحق للمورد..." / "لا يوجد دفع تلقائي..."; البنود tab lists rice(200@140) and sugar(500@31), footer shows subtotal/tax/total stacked in the last cell.

**PUR-100 — From-receipt invoice detail: PI-DEMO-6**
- Steps: open `PI-DEMO-6`.
- Assert: "المصدر" reads "من إيصال استلام"; effects panel (receipt variant, dedup wording): "تمّت إضافة الأصناف للمخزون سابقاً عند إيصال الاستلام — لا تُضاف مرة أخرى (تجنّب الازدواج)."; رقم فاتورة المورد shows "GV-2026-0817"; تاريخ الاستحقاق shows 2026-09-11.

**PUR-101 — Confirm a draft invoice**
- Steps: on a freshly created draft (e.g. from PUR-98), click "تأكيد الفاتورة".
- Assert: status flips مسودة→مؤكد; AP (GL 2100 / the supplier's balance) rises by exactly the invoice total; for the inventory line, stock/valuation rises by qty×unitCost; trial balance still balances afterward.

**PUR-102 — No المزيد menu — no Share/Print/Create-return/Cancel-invoice**
- Assert: `[NOT IMPLEMENTED]` — only "تأكيد الفاتورة" (draft only) and "رجوع" ever appear in the header. Catalog's "مشاركة", "طباعة", "إنشاء مرتجع" shortcut, and "إلغاء الفاتورة" all have no equivalent — a return must be started from the Purchase Returns screen itself (PUR-108+), with no deep link from here.

**PUR-103 — Only one tab — البنود**
- Assert: `[NOT IMPLEMENTED]` — catalog lists 7 tabs (البنود/المدفوعات/المرتجعات/التكاليف الإضافية/القيود المحاسبية/المرفقات/سجل المراجعة); only البنود exists. There is no way to see this invoice's payments, its returns, its landed-cost allocations, its journal entries, or an audit trail from this screen at all.

**PUR-104 — No consumed/received tracking column**
- Assert: `[NOT IMPLEMENTED]` — catalog's المستهلك/المستلم columns (sold-tracking) on البنود do not exist; the actual columns are الصنف/النوع/الكمية/تكلفة الوحدة/ضريبة %/الإجمالي.

**PUR-105 — "تسجيل دفعة" does not exist anywhere on this screen**
- Assert: `[NOT IMPLEMENTED]` — neither the list row actions nor the detail header expose a record-payment control, contrary to the catalog. The **only** way to record a supplier payment in this build is Treasury → Vouchers, creating a `supplier_payment` voucher and allocating it to the invoice manually (exactly how the seed produces `VCH-DEMO-3`'s 60%-of-`PI-DEMO-1` allocation) — a materially more manual flow than the catalog's inline button. Confirm that after such a voucher is confirmed and allocated, `PI-DEMO-1`'s status **still reads مؤكد** on this screen (PUR-84 already established there is no partial-paid state to move to) — the true remaining balance is only visible via Suppliers → `SUPP-DEMO-1` → كشف حساب المورد (PUR-26).

**PUR-106 — No historical import modal reachable from anywhere**
- Cross-reference to PUR-88 — restated here since it's the single largest missing feature on this screen.

---

### مرتجعات المشتريات (Purchase Returns)

#### List — `apps/web/src/screens/PurchaseReturnsScreen.tsx`

**PUR-107 — No search box at all**
- Steps: look for a search input near the header.
- Assert: `[NOT IMPLEMENTED]` — `DocumentList` is invoked here without `searchValue`/`onSearchChange`/`searchPlaceholder`; there is no way to search Purchase Returns by number or supplier, contrary to the catalog's "بحث برقم المرتجع أو اسم المورد…".

**PUR-108 — Status tabs — no بانتظار استلام المبلغ state**
- Assert: chips are الكل(2)/مسودة(1, `PRT-DEMO-2`)/مؤكد(1, `PRT-DEMO-1`)/ملغي(0). `[NOT IMPLEMENTED]` — the catalog's "بانتظار استلام المبلغ" (awaiting refund) status/tab does not exist; a confirmed return has no further sub-state to reach.

**PUR-109 — KPI strip is missing two of four catalog tiles**
- Assert: only "إجمالي المرتجعات"=2 and "مؤكدة"=1 render. `[NOT IMPLEMENTED]` — "إجمالي قيمة المرتجعات" and "مسودة" count tiles from the catalog are absent.

**PUR-110 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting.

**PUR-111 — No استيراد مرتجعات سابقة header action**
- Assert: `[NOT IMPLEMENTED]` — only "مرتجع جديد" exists.

**PUR-112 — Table columns and row detail**
- Assert: رقم المرتجع column shows "مسودة" as the number for `PRT-DEMO-2` (no doc number assigned until confirmed) with its source-invoice number as subtext; المورد resolves from the first line's `supplierId`; قيمة المرتجع sums `unitCost×qty + taxAmount` per line; row click opens a SidePanel (not a full page) — confirm this differs from the RFQ/PO/Receipt/Invoice pattern, which all navigate to a full `DocumentDetail` page.

**PUR-113 — Empty state**
- Pre: filter to a status with zero rows isn't directly possible without search — use the status chips (e.g. there's no combination producing zero here with only 2 seed rows and 3 chips covering both). Skip, or create+cancel a return first to leave a status with 0 rows, then confirm "لا توجد مرتجعات — أنشئ مرتجعاً جديداً" renders.

#### Create return

**PUR-114 — Invoice picker defaults to the first confirmed invoice, not empty**
- Steps: open "مرتجع جديد".
- Assert: الفاتورة الأصلية is pre-populated (native `<select>`, no blank option — the two `useEffect`s auto-pick the first confirmed invoice and first warehouse the moment the queries resolve) — this differs from the catalog's typeahead-with-no-default behavior. Option labels read plainly "`{number} — {supplierName}`" — `[NOT IMPLEMENTED]` vs. catalog's richer "PI-000002 — جاري · 10.00 ج.م | 20/08/2026" format (no amount, no date shown in the dropdown).

**PUR-115 — No original-invoice info panel**
- Assert: `[NOT IMPLEMENTED]` — after picking an invoice, the catalog describes a read-only summary panel (رقم الفاتورة/المورد/تاريخ الفاتورة/إجمالي الفاتورة/الحالة). No such panel exists; the only visible trace of the selected invoice is its appearance in the dropdown label and in the line-item source.

**PUR-116 — Reason dropdown — all 5 catalog options present**
- Assert: بضاعة معيبة / صنف خاطئ / كمية زائدة / مشكلة جودة / أخرى — matches the catalog exactly (`REASON_LABEL` keys DEFECTIVE/WRONG_ITEM/EXCESS_QTY/QUALITY_ISSUE/OTHER).

**PUR-117 — No notes/memo field**
- Assert: `[NOT IMPLEMENTED]` — `memo: ""` is hardcoded on every created return; there is no ملاحظات field in the create panel at all, contrary to the catalog.

**PUR-118 — Line items: no available-qty display, no client-side cap — the over-return gate**
- Pre: pick `PI-DEMO-7` (السياج، oil originally invoiced qty 120). It already has `PRT-DEMO-1` confirmed for 20, leaving 100 truly available, and `PRT-DEMO-2` draft for 12 more.
- Steps: on the create form, pick `ITEM-DEMO-2` (the only inventory line on this invoice) and set الكمية to `150` — more than both the 100 actually remaining **and** more than the invoice's original 120.
- Assert: `[NOT IMPLEMENTED]` — no "الكمية المتاحة" is ever displayed to the user, and there is no `max` cap on the quantity field. The client sends `availableQty: source?.qty ?? String(l.qty)` — i.e. it reports the **original invoiced quantity (120)**, not the true remaining-after-prior-returns figure — as `availableQty` on every submitted line, regardless of how much has already been returned. Record whether the server: (a) rejects the over-return with a specific error, (b) rejects it with a generic one, or (c) accepts it, breaking the invoice's real returnable balance. Any of (b) or (c) is a new, previously unrecorded defect — cite the exact qty typed and the exact server response.

**PUR-119 — Two save actions: حفظ كمسودة / حفظ وتأكيد**
- Steps: fill a valid return, save via each button on two separate attempts.
- Assert: "حفظ كمسودة" creates status مسودة (no docNo yet); "حفظ وتأكيد" creates it and immediately confirms it in one round trip (status مؤكد, docNo assigned) — confirm stock and AP move only for the second one.

**PUR-120 — Required-field guard produces an inline message here (unlike most other Purchases forms)**
- Steps: attempt to submit with `warehouseId` cleared (if reachable) or with zero valid lines.
- Assert: unlike RFQ/PO/GRN/Invoice (which just disable the button), this screen shows an actual `error` string: "اختر الفاتورة الأصلية والمستودع." or "أضف بنداً واحداً على الأقل بكمية أكبر من صفر." — confirm the exact text and that the button stays enabled/clickable (the guard fires on click, not via `disabled`).

#### Return detail (SidePanel)

**PUR-121 — مسودة detail: PRT-DEMO-2**
- Steps: click the row.
- Assert: SidePanel shows status pill مسودة, "الفاتورة الأصلية: {PI-DEMO-7's number}", one line (oil, 12 × 72), actions "تأكيد المرتجع" and "إلغاء".

**PUR-122 — مؤكد detail: PRT-DEMO-1, and confirmed returns can still be cancelled**
- Steps: open `PRT-DEMO-1`.
- Assert: status مؤكد; single action "إلغاء المرتجع" is present — **unlike every other Purchases document type in this build** (POs, receipts, invoices, and the create-time draft state of RFQs/returns/landed-costs all lose their cancel option once confirmed), a **confirmed** Purchase Return can still be cancelled from its detail panel. Note this asymmetry; it's worth deliberately exercising once to see whether cancelling a confirmed return correctly reverses the stock decrease and AP credit it posted, or leaves a dangling reversal gap (out of this file's scope to assert the ledger math precisely — record what you observe).

---

### التكاليف الإضافية (Landed Costs)

#### List — `apps/web/src/screens/LandedCostsScreen.tsx`

**PUR-123 — No search box**
- Assert: `[NOT IMPLEMENTED]` — same as Returns; no `searchValue` prop passed.

**PUR-124 — Status chips omit ملغي despite it being reachable**
- Assert: chips are only الكل(2)/مسودة(1, `LC-DEMO-2`)/مؤكد(1, `LC-DEMO-1`). `[NOT IMPLEMENTED]` — even though a confirmed or draft landed cost **can** be cancelled from its detail panel (see PUR-133), there is no ملغي chip to filter down to one once it exists. The catalog's "بانتظار التسوية" status also has no equivalent anywhere.

**PUR-125 — KPI strip is missing 2 of the catalog's tiles**
- Assert: only "إجمالي المستندات"=2 and "مؤكدة"=1 render. `[NOT IMPLEMENTED]` — no cost-sum KPI ("التكلفة المؤكدة"), no cancelled-count expansion.

**PUR-126 — Table columns miss التاريخ / المستودع / الفواتير المرتبطة**
- Assert: `[NOT IMPLEMENTED]` — actual columns are رقم المستند / طريقة التوزيع / إجمالي التكلفة / الحالة only.

**PUR-127 — No filter panel / sorting / pagination**
- Assert: `[NOT IMPLEMENTED]` — cross-cutting.

**PUR-128 — Empty state**
- Assert: "أنشئ مستند تكلفة لتوزيع التكاليف الإضافية على المشتريات" (only reachable on a fresh tenant — not directly triggerable here without deleting seed data).

#### Create landed cost

**PUR-129 — Warehouse picker does not gate the invoice picker**
- Steps: open "مستند تكلفة جديد" → change المستودع.
- Assert: `[NOT IMPLEMENTED]` vs. catalog's "اختر المستودع أولاً لعرض الفواتير" gating placeholder — the invoice `<select>` here lists **all** confirmed invoices regardless of which warehouse is selected; changing warehouse has no effect on which invoices are selectable.

**PUR-130 — Only one linked invoice, not a multi-select**
- Assert: `[NOT IMPLEMENTED]` — catalog describes "الفواتير المرتبطة" as multiple; the actual field is a single `<select>` (`invoiceId`), one invoice per document.

**PUR-131 — Distribution method options**
- Assert: حسب القيمة (default) / حسب الكمية — matches the catalog exactly.

**PUR-132 — No date, no description/memo fields**
- Assert: `[NOT IMPLEMENTED]` — `date` is hardcoded to today and `memo` to `""` on every created document; neither field appears anywhere in the create panel, contrary to the catalog's "التاريخ *" / "الوصف" / "ملاحظات".

**PUR-133 — Cost items: type/description/amount, add/remove**
- Steps: add a second cost line (default costType شحن) → change it to جمارك → set amount.
- Assert: COST_TYPE_LABEL options exactly شحن/جمارك/تأمين/تخليص/أخرى, matching the catalog; footer "إجمالي التكلفة" updates live as amounts change.

**PUR-134 — Target items: item/qty/unitCost all freely editable, no source cap**
- Steps: pick a target item from the invoice's stock lines, then manually change الكمية and التكلفة الحالية to values that don't match the invoice's actual line (e.g. type a qty larger than what was ever invoiced on that line).
- Assert: no validation blocks this — the target qty/unitCost are plain editable `NumberField`s seeded from the invoice line but not locked to it. Confirm what the live preview and, if you confirm the document, the actual persisted allocation do with a mismatched qty — this is the landed-cost analogue of PUR-118's over-qty gate and is worth recording precisely if it changes the allocation math unexpectedly.

**PUR-135 — Live allocation preview: BY_VALUE math on LC-DEMO-1's numbers**
- Steps: reproduce `LC-DEMO-1`'s exact setup in a **new** document (since it's already confirmed): warehouse = the seed warehouse, invoice = a confirmed invoice with `ITEM-DEMO-1` (qty 100 @ 140) and `ITEM-DEMO-3` (qty 300 @ 31) lines (e.g. `PI-DEMO-1`, which has the same two items at those exact quantities/costs), method حسب القيمة, cost items SHIPPING 1800 + CLEARANCE 700.
- Assert: "معاينة التوزيع" shows two rows; each allocated amount is proportional to line value (100×140=14,000 vs 300×31=9,300, total value 23,300) — rice gets ≈1,502.15 of the 2,500, sugar gets ≈997.85; **the two allocated amounts sum to exactly 2,500.00 with no rounding leak** (verify this arithmetically, to the smallest money unit — this is the assertion the task brief calls out explicitly); each row's "تكلفة جديدة" equals the original unit cost plus (allocated amount ÷ qty).

**PUR-136 — Live allocation preview: BY_QUANTITY math on LC-DEMO-2's numbers**
- Pre: `LC-DEMO-2` itself is still draft — open it directly instead of re-creating it.
- Steps: open `LC-DEMO-2`'s detail panel (read-only) or reconstruct it in create mode.
- Assert: single target (`ITEM-DEMO-2`, qty 120) with a single cost total (300+450=750) under BY_QUANTITY trivially allocates 100% of 750 to that one line — confirm the preview/allocated amount is exactly 750.00, and the new unit cost is 72 + 750/120 = 78.25.

**PUR-137 — Two save actions: حفظ / حفظ وتأكيد التوزيع**
- Assert: same pattern as Returns (PUR-119) — plain save leaves it مسودة with no allocation posted yet (unit costs unchanged); save-and-confirm posts the allocation and bumps unit costs immediately.

**PUR-138 — Confirm LC-DEMO-2, then verify unit-cost and inventory-valuation effects**
- Pre: `LC-DEMO-2` is draft.
- Steps: open it → "تأكيد التوزيع".
- Assert: `ITEM-DEMO-2`'s weighted-average unit cost in the affected warehouse rises by 750/120 = 6.25 per unit (from 72 to 78.25) for that cost layer; inventory valuation rises by exactly 750.00; AP is **not** affected by this action (landed costs don't touch a supplier balance the way an invoice does — confirm no AP movement occurs); trial balance still balances afterward.

#### Landed cost detail (SidePanel)

**PUR-139 — مسودة detail: LC-DEMO-2**
- Assert: shows each target line as "+{allocatedAmount} → تكلفة جديدة {newUnitCost}"; actions "تأكيد التوزيع" and "إلغاء" (both present since it's draft).

**PUR-140 — مؤكد detail: LC-DEMO-1, and confirmed documents can still be cancelled**
- Steps: open `LC-DEMO-1`.
- Assert: status مؤكد; single action "إلغاء المستند" — same asymmetry noted in PUR-122: a **confirmed** landed cost can still be cancelled here, unlike POs/receipts/invoices. If you exercise it, record whether the unit-cost bump it posted is actually reversed or left in place (this file does not assert the answer — only that it's worth checking, since an un-reversed cost bump after "cancelling" a landed cost would silently misstate inventory valuation going forward).

---

### إدارة المشتريات (Purchases Hub)

**PUR-141 — Route is reachable from the sidebar in this build (unlike the reference product)**
- Pre: `nav-config.ts` lists `"purchases-hub"` as the first item inside the `purchases` nav group.
- Steps: click المشتريات in the sidebar to expand the group → click its first sub-item.
- Assert: lands on `/purchases/hub` (or equivalent) — **note this is a positive discrepancy vs. the catalog**, which documented the hub as a real-but-unlinked route in the reference product; here it is an ordinary, discoverable nav entry.

**PUR-142 — Quick actions: 5 buttons, only 3 auto-open their create panel**
- Steps: click each of the 5 quick-action buttons in turn, returning to the hub between clicks.
- Assert: "أمر شراء جديد", "استلام بضاعة", "فاتورة مشتريات جديدة" each navigate to their screen **and** immediately open its create SidePanel (via `useScreenIntent`). "طلب عرض سعر" and "مرتجعات المشتريات" navigate to their screens but land on the plain list — `[NOT IMPLEMENTED / inconsistency]` — `RfqsScreen` and `PurchaseReturnsScreen` never call `useScreenIntent`, so these two quick actions behave differently from the other three despite looking identical on the hub.

**PUR-143 — No "مورد جديد" quick action**
- Assert: `[NOT IMPLEMENTED]` vs. catalog's 4-item quick-create row (which includes "مورد جديد") — the actual build's quick-action row has 5 buttons and none of them creates a supplier.

**PUR-144 — StatCards replace the catalog's tile grid and stepper entirely**
- Assert: `[NOT IMPLEMENTED]` — the catalog describes a "مسار الشراء" mini-stepper (أوامر الشراء → استلام البضائع → فواتير الموردين with hint text) and a "مناطق العمل" tile grid with per-domain counts and "عرض" deep links (including a ديت-linked "تصنيفات الموردين" and separate tiles for مرتجعات المشتريات / التكاليف الإضافية). None of that exists. The actual build has exactly 4 `StatCard`s: "أوامر شراء مفتوحة" (sent+partially_received count = 2, i.e. `PO-DEMO-3`+`PO-DEMO-4`), "استلامات غير مفوترة" (confirmed & !invoiced = 1, `GRN-DEMO-3` once confirmed, else 0 before PUR-79), "فواتير المشتريات" (=7), "عدد الموردين" (=2). No per-tile "عرض" link, no returns/landed-cost counts, no supplier-categories shortcut (consistent with PUR-29).

**PUR-145 — Recent invoices list is not clickable**
- Assert: `[NOT IMPLEMENTED]` — "أحدث فواتير المشتريات" lists up to 5 invoices sorted by date desc (confirm `PI-DEMO-7`, dated 2026-08-20, appears among the top 5 alongside `PI-DEMO-6`), but each `<li>` has no `onClick`/link — clicking a row does nothing; there is no way to jump straight to an invoice's detail page from the hub.

**PUR-146 — Empty-tenant copy**
- Assert: "لا توجد فواتير مشتريات بعد — ستظهر هنا فور إنشاء أول فاتورة." — not directly triggerable against the seeded tenant (7 invoices always exist); note the copy for completeness.

---

### End-to-end procurement chain, and trying to skip a gate

The whole point of this module is the three-gate chain RFQ → PO → Goods Receipt →
Purchase Invoice, with Returns and Landed Costs hanging off a confirmed invoice
or receipt. These scenarios exercise it start to finish and then try to jump
each gate.

**PUR-147 — Full chain from a fresh RFQ to a confirmed invoice**
- Pre: none of the seed RFQs are left mid-chain and untouched except `RFQ-DEMO-2` (already partly exercised by PUR-43/44/45 if you ran those — otherwise use it fresh, or create a brand-new RFQ if you want a completely clean run).
- Steps: create RFQ → send → record two suppliers' quotes → compare → convert the cheaper one to a PO → confirm the PO → create a receipt against it (full amount, since partial isn't possible through the UI — PUR-75) → confirm the receipt → create an invoice "from receipt" against it → confirm the invoice.
- Assert at each step: RFQ reaches مغلق and links to the new PO; the PO's status moves مسودة→مرسل then straight to مستلم بالكامل on the one full receipt (partial isn't reachable via UI); stock rises by exactly the received quantity **at receipt-confirm time**, with **no GL movement yet** (measure GL 1200 immediately before and after this step — it must not move); AP and GL 1200 both rise together only at **invoice-confirm time**, by exactly the invoice total; trial balance balances before and after every step.

**PUR-148 — Manual invoice with no receipt at all is a supported path, not a skipped gate**
- Steps: create a purchase invoice manually (طريقة الإنشاء = إنشاء فاتورة جديدة) for a supplier with no PO or receipt involved at all.
- Assert: this succeeds — by design, the manual-entry path exists precisely for suppliers/purchases with no PO/receipt chain (e.g. small ad-hoc buys). This is **not** "invoicing without a receipt" in the sense of bypassing a lock — the real gate only applies to the **from-receipt** path, which restricts its picker to confirmed-and-uninvoiced receipts only (PUR-96). Don't mistake this for a defect; it's the documented alternate entry point the catalog itself describes ("طريقة الإنشاء" toggle).

**PUR-149 — Receiving against a draft PO is blocked at the picker**
- Steps: open Goods Receipts → create → check whether `PO-DEMO-1` (مسودة) appears in the أمر الشراء picker.
- Assert: it does not (PUR-74) — the gate is enforced by excluding it from the option list entirely, not by accepting the selection and then rejecting on save. There is no way through the UI to even attempt this.

**PUR-150 — Receiving against an already fully-received PO is blocked the same way**
- Steps: check whether `PO-DEMO-2` (مستلم بالكامل) appears in the same picker.
- Assert: excluded, same as PUR-149 (its status doesn't match `sent`/`partially_received`).

**PUR-151 — Invoicing from an ineligible receipt is blocked at the picker**
- Steps: in Purchase Invoices → create → من إيصال استلام, check whether a draft receipt (`GRN-DEMO-3`, before confirming it) or an already-invoiced one (`GRN-DEMO-1`, `GRN-DEMO-2`) appears.
- Assert: none do (PUR-96) — same client-side exclusion pattern as receipts.

**PUR-152 — Receiving more than ordered cannot be attempted through the UI**
- Assert: cross-reference PUR-75 — this is a genuine scope gap in the build, not just an edge case the UI happens to handle correctly. Since there is no editable received-quantity field anywhere in Goods Receipts, the "receive more than ordered" boundary test this file's brief asks for **cannot be exercised as a UI test** at all in the current build; it can only be attempted via a direct `POST /purchases/receipts` call with an inflated `qty`, which is outside this file's UI-only scope. Record this as a build limitation, not a pass/fail result.

**PUR-153 — Returning more than received/available is not blocked in the UI — the real gate test**
- Cross-reference PUR-118 — this is the one over-limit scenario in the whole module that **is** reachable purely through clicking: the return-quantity field has no cap and no visible "available" figure. Run PUR-118 to completion (submit the over-limit qty) and record the server's actual response as the finding for this scenario.

**PUR-154 — Leaving a receipt confirmed-but-uninvoiced is a documented, correct state — not a bug**
- Cross-reference PUR-79. Confirming `GRN-DEMO-3` (or any receipt) and then **not** invoicing it immediately is exactly the scenario `ROADMAP.md` §5's context note warns about: the inventory sub-ledger sits ahead of GL 1200 by that receipt's value, with zero GL entries posted, because there is no goods-received-not-invoiced accrual account in this chart of accounts. If you see this gap after confirming a receipt and before invoicing it, that is this — say so in your notes, don't file it as a new defect.

**PUR-155 — Landed cost allocation targets are not capped to the invoice's real line quantities**
- Cross-reference PUR-134 — the second "skip a gate" style test this brief calls for outside the RFQ→PO→GR→PI chain proper: a landed cost's target quantity can be set to something that doesn't match what the linked invoice actually recorded for that item, with no validation stopping it, potentially misallocating cost onto a quantity that was never really purchased through that document.

---

# 7. Inventory and manufacturing


Exhaustive UI test scenarios for the Inventory and Manufacturing screens, built against
**this build** (`apps/web/src/screens/*`, `apps/web/src/nav-config.ts`) and checked line
by line against the captured reference product (`docs/archive/catalog/03-inventory.md` and the
manufacturing half of `docs/archive/catalog/07-mfg-projects-assets.md`). Every screen listed in
the task brief is covered: Items, Item Specifications, Product Templates, Configurable
Products, Stock Balance, Stock Transfers, Stock Adjustments, Physical Counts, Label
Printing, Inventory Write-downs, Work Orders, Bills of Materials, Custom Manufacturing
(Config Instances), Production Dashboard.

Where the catalog describes something this build does not have, the scenario is written
anyway and marked **`[NOT IMPLEMENTED]`** — with the exact code fact that proves it's
missing, not a guess.

### Conventions

- **ID** — `INV-001`… sequential across the whole file.
- **Pre** — state required before the first step (seed data, existing records, filters).
- **Steps** — the Arabic click path exactly as the UI renders it (button/label text is
  quoted verbatim from source, not paraphrased).
- **Assert** — what must be true afterward. A step with no assertion is a click, not a
  test. Money and Qty are scaled integers; assert on the persisted value, not just the
  toast.
- **"reload"** means a hard browser reload (F5 / re-navigate from a fresh app boot), not
  just leaving and re-entering the SPA screen — it is the only way to prove a save
  reached the API instead of living in local component state.
- Every screen in this build is a flat, unpaginated client-side list (`page=1,
  pageCount=1` hardcoded) **except Items**, which page real API-shaped data at
  `PAGE_SIZE = 5`. Where a screen has no server pagination, "pagination" scenarios are
  replaced with "all rows render at once" assertions instead.
- None of these 14 screens has a row-level kebab/"more" menu unless explicitly said so
  below — the reference catalog documents kebab menus (عرض/تعديل/تعطيل/حذف/تكرار…) on
  almost every list; this build's row click opens that row's own detail directly, and
  secondary actions live as buttons on the detail page. Actions the catalog describes
  that have **no button anywhere** in this build are marked `[NOT IMPLEMENTED]`.

### Seed data used throughout (from `packages/backend/src/demo-seed.ts` and
`packages/backend/src/demo-seed/inventory-ops.ts`)

| | |
|---|---|
| Items | ITEM-DEMO-1…4 (`IT-0001`…`IT-0004`, plain: rice/oil/sugar/tea), ITEM-DEMO-5/6 (`IT-0005`/`IT-0006`, manufacturable — BOM-DEMO-1/2 build them), ITEM-DEMO-7/8 (`IT-0007`/`IT-0008`, batch+expiry tracked: milk/yoghurt) |
| Warehouses | `WH-MAIN` (main), `WH-GIZA` (مستودع فرع الجيزة), `WH-TRANSIT` (مخزون بالطريق), `WH-VAN` (عربة توزيع رقم ١) |
| Adjustments | `ADJ-DEMO-1` INITIAL_STOCK (posts GL: Dr 1200 / Cr 3100), `ADJ-DEMO-2` DAMAGE, `ADJ-DEMO-3` OTHER, `ADJ-DEMO-4` EXPIRY, `ADJ-DEMO-5`/`ADJ-DEMO-6` PHYSICAL_COUNT (generated from counts) — 6 documents, 5 distinct reasons |
| Transfers | `TRF-DEMO-1` (confirmed, → الجيزة), `TRF-DEMO-2` (confirmed, → بالطريق), `TRF-DEMO-3` (**draft**, seeded through a backend-only endpoint the UI never exposes — see INV-078) |
| Physical counts | `PC-DEMO-1` (main, completed, generated `ADJ-DEMO-5`), `PC-DEMO-2` (الجيزة, completed, generated `ADJ-DEMO-6`, cancels PC-DEMO-1's variance to zero), `PC-DEMO-3` (main, **blind**, still `IN_PROGRESS`, one line uncounted) |
| Work orders | `WO-DEMO-1` (BOM-DEMO-1, planned, not started), `WO-DEMO-2` (BOM-DEMO-2, started — materials not yet issued), `WO-DEMO-3` (BOM-DEMO-1, cancelled) |
| BOMs | `BOM-DEMO-1` → ITEM-DEMO-5 (4×ITEM-DEMO-4 + 6×ITEM-DEMO-3, labor 50, overhead 30), `BOM-DEMO-2` → ITEM-DEMO-6 (5×ITEM-DEMO-4 + 5×ITEM-DEMO-3, labor 40, overhead 20) |
| Product templates | `TPL-TEA` (SIZE×PACK, 3 variants generated), `TPL-RICE` (SIZE×ORIGIN, 2 variants generated) |
| Item specifications | `SIZE`, `PACK`, `ORIGIN` (select), `NET-WEIGHT` (number, unit جم), `STORAGE` (text) |
| Write-down runs | one, period `2026-08`, already posted, against ITEM-DEMO-6 (aged past 180 days from its 2026-02-15 opening) |

### Defects this run **will** hit — reference `ROADMAP.md` §5, do not re-file

- **D2** — a `PHYSICAL_COUNT` adjustment posts **no journal entry**
  (`adjustmentGlAccountsForReason` in `packages/backend/src/create-backend.ts` maps GL
  accounts for `INITIAL_STOCK` only). Verified directly in code: **every reason except
  `INITIAL_STOCK`** — `DAMAGE`, `THEFT`, `EXPIRY`, `SHORTAGE`, `SUPPLIER_RETURN`,
  `PHYSICAL_COUNT`, `OTHER` — posts no GL entry, so `ADJ-DEMO-2` through `ADJ-DEMO-6`'s
  "المحاسبة" tab all hit the same "لا يوجد قيد محاسبي" branch as D2's `PHYSICAL_COUNT`
  case. The seed's two physical counts (`PC-DEMO-1`/`PC-DEMO-2`) are engineered to net to
  zero across warehouses — that is *evidence the gap is avoided*, not evidence it is
  safe.
- **D3** — `completeWorkOrder` never posts to GL 1200. This build's own work-order detail
  page *claims otherwise* — its effects copy reads "وعند الإكمال تُرحَّل قيود رسملة
  الإنتاج تحت التشغيل تلقائياً" (on completion, WIP-capitalisation entries post
  automatically) — which is false per D3. **Completing a work order will unbalance the
  books.** No work order in the seed is completed. Run INV-206 only on a throwaway
  database, and never before a scenario that asserts reconciliation.
- **D4** — the drift report is out of this file's scope (it lives under Reports, not in
  the 14 screens assigned here); noted only so a tester doesn't mistake a
  timestamp-ordering artifact for a real gap if they cross-reference it.

### Scope boundary

This file's 14 screens do not include a Chart-of-Accounts/GL-balance screen or the
Inventory Valuation/Drift reports (`/reports/inventory/*`), so a scenario cannot show
"GL 1200's live balance" on-screen — only the per-document journal entry inside a Stock
Adjustment's "المحاسبة" tab. Reconciliation scenarios below check what these 14 screens
can show: the Stock Balance rollup total, and adjustment-by-adjustment GL presence, per
D2's exact mechanism.

---

### 1. الأصناف (Items)

#### List

##### INV-001 — Header stats on load
- **Pre:** none.
- **Steps:** افتح المخزون ← الأصناف.
- **Assert:** "إجمالي الأصناف" = 8، "نشط" = 8، "أصناف مخزون" = 8، "أصناف خدمية" = 0 (كل الأصناف المزروعة `type: "stock"`، لا يوجد صنف خدمي).

##### INV-002 — Status chip "نشط"
- **Pre:** في شاشة الأصناف.
- **Steps:** اضغط شريحة "نشط".
- **Assert:** كل الصفوف الظاهرة تحمل شارة "نشط"؛ العدد = 8.

##### INV-003 — Status chip "غير نشط" (empty state via filter)
- **Steps:** اضغط شريحة "غير نشط".
- **Assert:** لا صفوف؛ نص الحالة الفارغة "لا توجد أصناف مطابقة".

##### INV-004 — Type chip "منتج مخزون"
- **Steps:** اضغط شريحة "منتج مخزون".
- **Assert:** 8 صفوف (كل الأصناف).

##### INV-005 — Type chip "خدمة"
- **Steps:** اضغط شريحة "خدمة".
- **Assert:** لا صفوف؛ حالة فارغة.

##### INV-006 — Category filter dropdown
- **Steps:** افتح القائمة المنسدلة "تصفية حسب التصنيف" (aria-label).
- **Assert:** لا توجد تصنيفات مزروعة لهذا التينانت — القائمة تعرض فقط "كل التصنيفات"؛ اختيارها لا يغيّر النتائج.

##### INV-007 — Unit filter dropdown
- **Steps:** افتح القائمة المنسدلة "تصفية حسب الوحدة"، اختر "قطعة (PCS)".
- **Assert:** تبقى كل الأصناف الثمانية ظاهرة (كلها بوحدة PCS).

##### INV-008 — Search by Arabic name substring
- **Steps:** اكتب "أرز" في "بحث بالاسم أو الكود...".
- **Assert:** صف واحد فقط: "أرز أبيض ٥ كجم" (ITEM-DEMO-1).

##### INV-009 — Search by code
- **Steps:** اكتب "IT-0005".
- **Assert:** صف واحد: "خليط شاي بالسكر ١ كجم".

##### INV-010 — Search no match
- **Steps:** اكتب "xyz-none".
- **Assert:** حالة فارغة "لا توجد أصناف مطابقة".

##### INV-011 — Sort by "اسم الصنف"
- **Steps:** اضغط رأس العمود "اسم الصنف" مرتين.
- **Assert:** الاتجاه الأول تصاعدي أبجدياً (عربي)، الثاني تنازلي.

##### INV-012 — Sort by "سعر البيع"
- **Steps:** اضغط رأس العمود "سعر البيع".
- **Assert:** الترتيب تصاعدي حسب القيمة الرقمية للسعر، ليس نصياً (12 قبل 260).

##### INV-013 — Sort by "سعر التكلفة"
- **Steps:** اضغط رأس العمود "سعر التكلفة".
- **Assert:** نفس السلوك الرقمي.

##### INV-014 — Pagination (real, `PAGE_SIZE = 5`)
- **Pre:** لا فلاتر مفعّلة (8 صفوف).
- **Steps:** لاحظ تذييل الصفحة "عرض 1–5 من 8 صنف"؛ اضغط "التالي".
- **Assert:** الصفحة الثانية تعرض "عرض 6–8 من 8 صنف" والصفوف الثلاثة المتبقية.

##### INV-015 — Row edit icon vs. row click
- **Steps:** اضغط زر التعديل (أيقونة القلم، aria-label "تعديل <اسم الصنف>") على أي صف.
- **Assert:** تفتح لوحة "تعديل صنف" جانبياً معبأة ببيانات الصنف — النقر على الأيقونة لا يفتح صفحة التفاصيل (event.stopPropagation).

##### INV-016 — Header action "إضافة صنف"
- **Steps:** اضغط "إضافة صنف".
- **Assert:** تفتح لوحة "إضافة صنف"؛ حقل "كود الصنف" معطّل ومعبأ تلقائياً بكود مولّد (`ITM-000009` مع 8 أصناف موجودة) — لاحظ أنه بصيغة مختلفة عن أكواد البيانات المزروعة (`IT-000x`)، وهذا سلوك متوقع لا خطأ.

##### INV-017 — List load error + retry
- **Pre:** حاكِ فشل `GET /items`.
- **Steps:** افتح شاشة الأصناف.
- **Assert:** بطاقة خطأ "تعذّر تحميل الأصناف." مع زر "إعادة المحاولة"؛ الضغط عليه يعيد الطلب.

#### Create / Edit form

##### INV-018 — Required name rejected
- **Steps:** افتح "إضافة صنف"، اترك "اسم الصنف" فارغاً، اضغط "إضافة".
- **Assert:** تنبيه "اسم الصنف مطلوب."؛ اللوحة تبقى مفتوحة؛ لا طلب `POST` يُرسل.

##### INV-019 — Item type toggle to "خدمة" hides inventory policy
- **Steps:** في "إضافة صنف"، غيّر "نوع الصنف" إلى "خدمة".
- **Assert:** بطاقة "تتبع المخزون / طريقة التكلفة / تتبع الدفعات / نقطة إعادة الطلب" تختفي بالكامل؛ الوحدة الأساسية تتحول تلقائياً إلى "SVC" إن كانت لا تزال "PCS".

##### INV-020 — Toggle back to "منتج مخزون" restores policy card
- **Steps:** من نفس اللوحة، أعد "نوع الصنف" إلى "منتج مخزون".
- **Assert:** بطاقة سياسة المخزون تظهر من جديد، "تتبع المخزون" مفعّل افتراضياً.

##### INV-021 — Alternate unit: blank code/name rejected
- **Steps:** أضف وحدة بديلة عبر "+ إضافة وحدة"، اترك الحقلين فارغين، اضغط "إضافة".
- **Assert:** خطأ "كود واسم الوحدة البديلة مطلوبان."

##### INV-022 — Alternate unit matching base unit rejected
- **Steps:** أضف وحدة بديلة بكود "PCS" (نفس الوحدة الأساسية)، اضغط "إضافة".
- **Assert:** خطأ "الوحدة البديلة \"PCS\" لا يمكن أن تطابق الوحدة الأساسية."

##### INV-023 — Duplicate alternate unit code rejected
- **Steps:** أضف وحدتين بديلتين بنفس الكود "CTN".
- **Assert:** خطأ "كود الوحدة البديلة \"CTN\" مكرر."

##### INV-024 — Non-positive conversion factor rejected
- **Steps:** أضف وحدة بديلة "CTN" بعامل تحويل = 0.
- **Assert:** خطأ "عامل تحويل الوحدة \"CTN\" يجب أن يكون رقماً موجباً."

##### INV-025 — Alternate unit save + reload
- **Steps:** أضف وحدة صحيحة "CTN" / "كرتونة" / عامل 12، احفظ، أعد تحميل الصفحة (F5)، افتح الصنف ← تبويب "الوحدات والباركود".
- **Assert:** الجدول يظهر "1 CTN = 12 PCS".

##### INV-026 — Blank barcode rejected
- **Steps:** أضف باركوداً عبر "+ إضافة باركود آخر"، اتركه فارغاً، اضغط "إضافة".
- **Assert:** خطأ "لا يمكن ترك الباركود فارغاً."

##### INV-027 — Duplicate barcode rejected
- **Steps:** أضف نفس قيمة الباركود مرتين.
- **Assert:** خطأ "الباركود \"...\" مكرر."

##### INV-028 — Barcode save + reload (feeds label printing — see INV-140)
- **Steps:** أضف باركوداً صحيحاً طويلاً (مثال: `1234567890123456789012345`, 25 خانة)، احفظ، أعد التحميل، افتح تبويب "الوحدات والباركود".
- **Assert:** الباركود ظاهر كشريحة؛ هذا هو نفس الباركود الذي ستستخدمه شاشة طباعة الملصقات لاحقاً.

##### INV-029 — Negative sale price — **not rejected** (gap)
- **Steps:** اكتب "-50" في "سعر البيع"، احفظ.
- **Assert (expected):** يجب أن تُرفض القيمة السالبة. **الفعلي:** `MoneyInput` يقبل علامة السالب صراحةً (`sanitizeDraft` تحافظ على `-`) و`validateDraft` في `ItemsScreen.tsx` لا يتحقق من `salePrice`/`costPrice` إطلاقاً — لا حارس عميل ولا خادم ظاهر من الشاشة. القيمة تُحفظ سالبة وتبقى بعد إعادة التحميل. سجّل كخلل مكتشف عند التنفيذ.

##### INV-030 — Negative cost price — same gap
- **Steps:** كرر INV-029 على "سعر التكلفة".
- **Assert:** نفس النتيجة — لا رفض.

##### INV-031 — Negative reorder point rejected
- **Pre:** نوع الصنف = "منتج مخزون".
- **Steps:** اكتب "-5" في "نقطة إعادة الطلب"، احفظ.
- **Assert:** خطأ "نقطة إعادة الطلب لا يمكن أن تكون سالبة."؛ لا حفظ.

##### INV-032 — Negative reorder qty rejected
- **Steps:** كرر على "كمية إعادة الطلب".
- **Assert:** خطأ "كمية إعادة الطلب لا يمكن أن تكون سالبة."

##### INV-033 — Negative tax rate rejected
- **Steps:** اكتب "-1" في "نسبة الضريبة %".
- **Assert:** خطأ "نسبة الضريبة لا يمكن أن تكون سالبة."

##### INV-034 — trackBatches disabled when trackInventory off
- **Steps:** أطفئ مفتاح "تتبع المخزون".
- **Assert:** مفتاح "تتبع الدفعات وتواريخ الصلاحية" يصبح معطّلاً ويُطفأ تلقائياً.

##### INV-035 — Costing method save + reload
- **Steps:** غيّر "طريقة التكلفة" إلى "FIFO"، احفظ، أعد التحميل، افتح تبويب "عام".
- **Assert:** "طريقة التكلفة" = "الأقدم أولاً (FIFO)".

##### INV-036 — GL account override save + reload
- **Steps:** في بطاقة الحسابات، اختر حساباً مخصصاً لـ"حساب المخزون" بدل "الافتراضي حسب نوع الصنف"، احفظ، أعد التحميل، افتح تبويب "الحسابات".
- **Assert:** يظهر الحساب المختار بصيغة "الكود — الاسم"، وليس "الافتراضي حسب نوع الصنف".

##### INV-037 — ETA fields save + reload
- **Steps:** اختر "نوع الكود (ETA)" = EGS، اكتب كوداً بصيغة `EG-XXXXXXXXX-SKU`، احفظ، أعد التحميل.
- **Assert:** تبويب "الحسابات" يعرض القيم المحفوظة بدل "—".

##### INV-038 — Full happy-path create + reload
- **Steps:** أنشئ صنفاً جديداً كاملاً (اسم، وحدة، سعر بيع/تكلفة، ضريبة)، احفظ، أعد تحميل الصفحة، ابحث عنه بالاسم.
- **Assert:** يظهر في القائمة بنفس الاسم/الكود/النوع/الوحدة/الأسعار المُدخلة.

##### INV-039 — Cancel discards draft
- **Steps:** افتح "إضافة صنف"، اكتب اسماً، اضغط "إلغاء".
- **Assert:** اللوحة تُغلق؛ لا طلب `POST`؛ الاسم لا يظهر في القائمة حتى بعد إعادة التحميل.

##### INV-040 — Edit status dropdown (edit-only field)
- **Pre:** فتح صنف موجود للتعديل.
- **Steps:** لاحظ حقل "الحالة" يظهر فقط في وضع التعديل (غير موجود في نموذج الإضافة)؛ غيّره إلى "غير نشط"، احفظ، أعد التحميل.
- **Assert:** الصف يحمل شارة "غير نشط"؛ إحصائية "نشط" تنقص بواحد.

##### INV-041 — Save-time server error keeps draft open
- **Pre:** حاكِ رفض الخادم لطلب `PATCH`/`POST`.
- **Steps:** احفظ صنفاً صالحاً ظاهرياً.
- **Assert:** تنبيه بنص خطأ الخادم (أو الرسالة الافتراضية "تعذّرت العملية.")؛ اللوحة تبقى مفتوحة ببيانات المستخدم كما هي (لا فقدان للمُدخلات).

#### Detail

##### INV-042 — Tab "عام"
- **Steps:** افتح أي صنف، تبويب "عام" (الافتراضي).
- **Assert:** يعرض نوع الصنف، التصنيف، الماركة، طريقة التكلفة، تتبع المخزون (نعم/لا)، تتبع الدفعات (نعم/لا)، نقطة/كمية إعادة الطلب.

##### INV-043 — Tab "الوحدات والباركود" empty states
- **Pre:** صنف بلا وحدات بديلة وبلا باركود (أي صنف مزروع لم يُعدَّل).
- **Steps:** افتح التبويب.
- **Assert:** "لا توجد وحدات قياس بديلة" و"لا يوجد باركود مسجل".

##### INV-044 — Tab "التسعير"
- **Steps:** افتح التبويب.
- **Assert:** يعرض سعر البيع وسعر التكلفة الحاليين + ملاحظة "يصبح مشتقاً تلقائياً من حركات المخزون فور ربط دفتر التكاليف (المرحلة الثانية)". **`[NOT IMPLEMENTED]`** مقارنةً بالكتالوج: لا جدول "طبقات التكلفة"، لا مطابقة متوسط التكلفة مقابل الطبقات، لا سجل تكاليف إضافية موزعة (landed costs) — كل هذا نص مرحلة ثانية معلّق.

##### INV-045 — Tab "الحسابات"
- **Steps:** افتح التبويب.
- **Assert:** يعرض حساب الإيراد/التكلفة/المخزون + حقول ETA (نوع الكود، كود الصنف لدى المصلحة، كود GPC).

##### INV-046 — Tab "المخزون" — `[NOT IMPLEMENTED]`
- **Steps:** افتح التبويب.
- **Assert:** نص ثابت فقط: "ستُعرض أرصدة المخزون حسب المستودع هنا فور ربط حركات المخزون بدفتر المخزون (المرحلة الثانية)." لا جدول مستودع/متاح/محجوز/إجمالي كما يصف الكتالوج — لا توجد طريقة من هذه الشاشة لرؤية توزيع مخزون صنف عبر المستودعات الأربعة.

##### INV-047 — Header actions "رجوع للقائمة" / "تعديل"
- **Steps:** من صفحة التفاصيل، اضغط "تعديل".
- **Assert:** تفتح لوحة التعديل معبأة؛ "رجوع للقائمة" يعيد لقائمة الأصناف بدون فتح أي لوحة.

##### INV-048 — `[NOT IMPLEMENTED]` catalog features absent from Items entirely
- **Assert (no UI path exists for any of):** قائمة "المزيد" (طباعة ملصقات / تحديد رصيد افتتاحي / تعطيل / حذف من صفحة الصنف)، حوار "تصنيفات الأصناف" من رأس القائمة، فلتر "إخفاء المتغيرات"، نطاقات سعر البيع/سعر التكلفة في لوحة الفلاتر، حقل صورة الصنف، حقل الموسم المرتبط بالمورد، مفتاحا "متاح في نقطة البيع" و"يعتبر هدراً عند التقديم"، تبويبا "المرفقات" و"السجل"، وأنواع الأصناف الست الكاملة (هذا البناء يقتصر على `stock`/`service` فقط، بلا "مادة خام" أو "منتج نهائي" أو "مستهلك" أو "الوصفة" كخيارات مستقلة).

---

### 2. المواصفات (Item Specifications)

`[NOT IN CATALOG]` — build-only feature, absent from `docs/archive/catalog/03-inventory.md`
entirely; documented here from code alone. Feeds the "من سجل المواصفات" attribute
shortcut on Product Templates (see INV-060).

##### INV-049 — Header stats and chips on load
- **Pre:** 5 مواصفات مزروعة (SIZE, PACK, ORIGIN — اختيار؛ NET-WEIGHT — رقم؛ STORAGE — نص).
- **Steps:** افتح المخزون ← المواصفات.
- **Assert:** "إجمالي المواصفات" = 5؛ "قابلة للتصفية" = 3 (SIZE/PACK/ORIGIN، الوحيدة بـ`filterable: true`).

##### INV-050 — Chip "قائمة اختيار"
- **Steps:** اضغط شريحة "قائمة اختيار".
- **Assert:** 3 صفوف (SIZE, PACK, ORIGIN).

##### INV-051 — Chip "رقم"
- **Steps:** اضغط شريحة "رقم".
- **Assert:** صف واحد (NET-WEIGHT) بعمود "القيم / الوحدة" = "جم".

##### INV-052 — Chip "نص"
- **Steps:** اضغط شريحة "نص".
- **Assert:** صف واحد (STORAGE) بعمود "القيم / الوحدة" = "—".

##### INV-053 — Search by code/name
- **Steps:** اكتب "SIZE" في "بحث بالكود أو الاسم…".
- **Assert:** صف واحد فقط.

##### INV-054 — Values cell for select type
- **Steps:** لاحظ عمود "القيم / الوحدة" لصف SIZE.
- **Assert:** شرائح "صغير"، "وسط"، "كبير".

##### INV-055 — Usage count column
- **Steps:** لاحظ عمود "الاستخدام" لصفوف SIZE/PACK/ORIGIN (مستخدمة في قوالب TPL-TEA/TPL-RICE).
- **Assert:** رقم > 0 لكل من SIZE/PACK/ORIGIN؛ 0 لـ NET-WEIGHT وSTORAGE.

##### INV-056 — Delete guarded when in use
- **Pre:** SIZE مستخدمة (usageCount > 0).
- **Steps:** اضغط زر الحذف (سلة المهملات) على صف SIZE.
- **Assert:** الزر معطّل (`disabled={... || s.usageCount > 0}`) — لا يمكن النقر عليه إطلاقاً.

##### INV-057 — Delete unused specification
- **Steps:** أنشئ مواصفة جديدة غير مستخدمة (كود `TEST-1`)، ثم اضغط حذفها.
- **Assert:** تختفي من القائمة؛ لا خطأ.

##### INV-058 — Create: code pattern validation
- **Steps:** اضغط "مواصفة جديدة"، اكتب كوداً بحروف صغيرة أو رموز غير مسموحة (مثال "size!"), احفظ.
- **Assert:** خطأ "الكود مطلوب — حروف إنجليزية كبيرة أو أرقام أو - أو _ (20 حرفاً كحد أقصى)." (الحقل نفسه يحوّل الإدخال لحروف كبيرة تلقائياً `.toUpperCase()`، فالرمز "!" هو ما يُسقط الفحص).

##### INV-059 — Create: name required
- **Steps:** اترك "الاسم بالعربية" فارغاً، احفظ.
- **Assert:** خطأ "الاسم بالعربية مطلوب."

##### INV-060 — Create: select type requires ≥1 value
- **Steps:** اختر النوع "قائمة اختيار"، اترك "القيم المسموح بها" فارغة، احفظ.
- **Assert:** خطأ "قائمة الاختيار تحتاج قيمة واحدة على الأقل."

##### INV-061 — Create: number type shows unit field
- **Steps:** اختر النوع "رقم".
- **Assert:** يظهر حقل "الوحدة" بدل "القيم المسموح بها".

##### INV-062 — Create: text type shows neither
- **Steps:** اختر النوع "نص".
- **Assert:** لا حقل قيم ولا حقل وحدة.

##### INV-063 — Create full round-trip + reload
- **Steps:** أنشئ مواصفة اختيار جديدة (كود، اسم، قيم "أحمر, أزرق"), فعّل "قابلة للتصفية في الكتالوج", احفظ, أعد تحميل الصفحة.
- **Assert:** تظهر في القائمة بنفس القيم والعلم "نعم" في عمود "قابلة للتصفية".

##### INV-064 — Edit: code and type locked
- **Steps:** افتح مواصفة موجودة للتعديل (زر "تعديل").
- **Assert:** حقلا "الكود" و"النوع" معطّلان (توضيح اللوحة: "النوع والكود لا يتغيران بعد الحفظ — قوالب المنتجات ترتبط بهما").

##### INV-065 — Edit: toggle "نشطة" off + reload
- **Steps:** عدّل مواصفة غير مستخدمة، أطفئ "نشطة"، احفظ، أعد التحميل.
- **Assert:** الصف يحمل شارة "غير نشطة" بجانب الاسم.

---

### 3. قوالب المنتجات (Product Templates)

##### INV-066 — Header stat and list columns
- **Pre:** قالبان مزروعان (TPL-TEA بثلاثة متغيرات مولّدة، TPL-RICE باثنين).
- **Steps:** افتح المخزون ← قوالب المنتجات.
- **Assert:** "إجمالي القوالب" = 2؛ الأعمدة: اسم المنتج، الكود، الخصائص (عدد)، الحالة. **`[NOT IMPLEMENTED]`**: لا عمود "المتغيرات" كما يصف الكتالوج، ولا مربع بحث على هذه الشاشة إطلاقاً (لا `searchValue` في الكود)، ولا فلاتر حالة (نشط/غير نشط).

##### INV-067 — Create: required fields
- **Steps:** اضغط "قالب جديد"، اترك "الكود" فارغاً، احفظ.
- **Assert:** خطأ "الكود والاسم ووحدة القياس مطلوبة." (فحص واحد مشترك للحقول الثلاثة).

##### INV-068 — Create: no numeric guard on default price/cost — gap
- **Steps:** اكتب "-100" في "السعر الافتراضي".
- **Assert (expected):** رفض القيمة السالبة. **الفعلي:** الحقل `TextField` نصي بحت، بلا `NumberField` وبلا فحص علامة في `handleCreateSubmit` — القيمة تُحفظ كما كُتبت.

##### INV-069 — Create full round-trip
- **Steps:** أنشئ قالباً (اسم، كود، وحدة "PCS")، احفظ.
- **Assert:** ينتقل تلقائياً لفتح لوحة تفاصيل القالب الجديد (`setSelectedId(created.id)`).

##### INV-070 — Add attribute from free text
- **Pre:** قالب جديد بلا خصائص.
- **Steps:** اترك "من سجل المواصفات" على "خاصية خاصة بهذا القالب"، اكتب "اسم الخاصية" = "اللون"، "القيم مفصولة بفواصل" = "أحمر, أزرق, أخضر"، اضغط "إضافة خاصية".
- **Assert:** بطاقة خاصية جديدة "اللون (3)" بثلاث شرائح قيم.

##### INV-071 — Add attribute: blank name/values rejected
- **Steps:** اترك اسم الخاصية والقيم فارغين، اضغط "إضافة خاصية".
- **Assert:** خطأ "اسم الخاصية والقيم (مفصولة بفواصل) مطلوبة."

##### INV-072 — Add attribute from specification registry
- **Steps:** افتح "من سجل المواصفات"، اختر "الحجم (SIZE)"، اضغط "إضافة خاصية".
- **Assert:** خاصية جديدة تحمل قيم SIZE الثلاث (صغير/وسط/كبير) بلا كتابة يدوية.

##### INV-073 — Add value inline
- **Pre:** خاصية موجودة.
- **Steps:** اكتب قيمة في حقل "+ قيمة" داخل بطاقة الخاصية، اضغط Enter.
- **Assert:** شريحة القيمة الجديدة تظهر فوراً؛ عداد "(N)" يزيد بواحد.

##### INV-074 — Delete attribute value — **no client guard** (gap vs. catalog)
- **Pre:** TPL-TEA، خاصية SIZE مستخدمة في 3 متغيرات موجودة.
- **Steps:** افتح TPL-TEA، اضغط × على قيمة "صغير" ضمن خاصية "الحجم".
- **Assert (expected per catalog):** يجب أن يكون الزر معطّلاً بتلميح "هذه الخاصية مستخدمة في N متغير — احذف المتغيرات أولاً". **الفعلي:** الزر دائماً قابل للنقر (`handleDeleteValue` يستدعي مباشرة بلا أي شرط)؛ الرفض إن وُجد يأتي فقط من استجابة الخادم كرسالة خطأ عامة "تعذّر حذف القيمة." — لا حارس على مستوى الواجهة.

##### INV-075 — Delete attribute — same gap
- **Steps:** اضغط "حذف الخاصية" على خاصية مستخدمة في متغيرات موجودة.
- **Assert:** نفس الملاحظة — لا تعطيل عميل؛ الاعتماد كليًا على رفض الخادم (رسالة "تعذّر حذف الخاصية." إن رُفض).

##### INV-076 — Variant generator: combination count and locking
- **Pre:** TPL-TEA (SIZE×PACK = 3×3 = 9 تركيبة ممكنة نظرياً لكن القيم المزروعة مختلفة الحجم لكل — تحقق العدد الفعلي من `combos.length`).
- **Steps:** افتح TPL-TEA.
- **Assert:** العنوان "توليد المتغيرات — N تركيبة ممكنة، 3 موجودة بالفعل"؛ الصفوف الثلاثة المولّدة مسبقاً معطّلة الصندوق ومحدّدة تلقائياً بشارة "موجود"؛ الباقي بشارة "جديد".

##### INV-077 — Generate new variant combinations
- **Pre:** TPL-RICE (تركيبتان موجودتان من أصل 4 ممكنة إن كان SIZE له قيمتان × ORIGIN له 3 قيم — تحقق العدد الفعلي).
- **Steps:** حدد صندوق تركيبة "جديد" غير موجودة، اضغط "توليد (1)".
- **Assert:** يظهر متغير جديد في قسم "المتغيرات" بكود صنف (`itemCode`) حقيقي؛ الصنف الجديد يظهر أيضاً في شاشة الأصناف بعد تحديثها.

##### INV-078 — All combinations already generated
- **Pre:** كل التركيبات الممكنة لقالب موجودة.
- **Steps:** افتح ذلك القالب.
- **Assert:** رسالة "تم توليد كل التركيبات الممكنة."؛ زر "توليد (0)" معطّل.

##### INV-079 — Variants list
- **Steps:** افتح TPL-TEA، مرر لقسم "المتغيرات (3)".
- **Assert:** ثلاث بطاقات، كل واحدة بتسمية التركيبة (مثال "صغير / كيس") وكود الصنف المولّد.

##### INV-080 — `[NOT IMPLEMENTED]` alternate units UI
- **Assert:** لا يوجد أي عنصر واجهة لتعريف "وحدات بديلة" على مستوى القالب كما يصف الكتالوج ("لفة = 12 متر" تُورث لكل متغير) — لا حقل، لا زر "إضافة وحدة" على هذه الشاشة إطلاقاً.

---

### 4. المنتجات القابلة للتهيئة (Configurable Products)

Nav item lives under "المخزون" في الشريط الجانبي لكنها منطقياً وحدة تصنيع؛ الشاشة نفسها
تُصنَّف "Manufacturing · Configurable products" في الكود.

##### INV-081 — Header stats and chips
- **Pre:** لا منتجات قابلة للتهيئة مزروعة في هذا التينانت (القائمة `WORK_ORDERS`/`BOMS` لا تُنشئ منتجاً قابلاً للتهيئة).
- **Steps:** افتح المخزون ← المنتجات القابلة للتهيئة.
- **Assert:** "الإجمالي" = 0؛ حالة فارغة "لا توجد منتجات قابلة للتهيئة مطابقة — أضف منتجاً جديداً".

##### INV-082 — Create: required fields
- **Steps:** اضغط "إضافة منتج قابل للتهيئة"، اترك "الكود" و"الاسم بالعربية" و"المنتج الناتج" فارغة، لاحظ زر "حفظ".
- **Assert:** الزر معطّل (`canSave` يتطلب الثلاثة + مدخل واحد صالح على الأقل + خامة واحدة صالحة على الأقل).

##### INV-083 — Output item auto-fills unit
- **Steps:** اختر "المنتج الناتج" من قائمة الأصناف.
- **Assert:** حقل "وحدة المنتج النهائي" يتحدث تلقائياً لوحدة الصنف الأساسية.

##### INV-084 — Config input rows: add/remove
- **Steps:** اضغط "إضافة مدخل"، ثم "حذف المدخل" على الصف الأول (يظهر الزر فقط عند وجود أكثر من صف واحد).
- **Assert:** الصف الأول (الوحيد الآن) لا يحمل زر حذف — لا يمكن ترك القائمة بلا صف واحد على الأقل.

##### INV-085 — Material rows: add/remove
- **Steps:** كرر نفس السلوك على قسم "خامات التصنيع".
- **Assert:** نفس القاعدة — صف أخير غير قابل للحذف.

##### INV-086 — Pricing method "معادلة" requires price formula
- **Steps:** اختر "طريقة التسعير" = "معادلة"، اترك "معادلة السعر (للوحدة)" فارغة، لاحظ "حفظ".
- **Assert:** الزر معطّل حتى تُملأ معادلة السعر.

##### INV-087 — Full happy-path create + reload
- **Steps:** أنشئ منتجاً قابلاً للتهيئة كاملاً: كود، اسم عربي، منتج ناتج (اختر ITEM-DEMO-4)، مدخل واحد (`width`/"العرض"), خامة واحدة (اختر ITEM-DEMO-3 بمعادلة `width*2`), التسعير "معادلة" بصيغة `width*3.5`, احفظ, أعد تحميل الصفحة.
- **Assert:** يظهر في القائمة بنفس الكود والاسم؛ عمود "مدخلات التهيئة" = "العرض"؛ عمود "خامات التصنيع" = 1.

##### INV-088 — Detail tabs
- **Steps:** افتح المنتج الذي أُنشئ في INV-087.
- **Assert:** تبويب "مدخلات التهيئة (1)" يعرض المعرف/التسمية/الحد الأدنى/الأقصى؛ تبويب "خامات التصنيع (1)" يعرض الصنف/معادلة الكمية/نسبة الهالك؛ تبويب "التسعير والتكلفة" يعرض معادلة السعر `width*3.5` ومعادلتي العمالة/المصاريف كـ"—" إن لم تُدخلا.

##### INV-089 — Effects copy — sandboxed formulas
- **Steps:** لاحظ نص "تأثيرات" أسفل ملخص التفاصيل.
- **Assert:** "المعادلات تُقيَّم عبر مُقيِّم آمن (Sandbox) — لا يستخدم eval إطلاقاً." و"كل أمر تصنيع مخصص يُقيّم هذه المعادلات مقابل مواصفات العميل لحساب الخامات والسعر."

##### INV-090 — Deactivate
- **Steps:** من صفحة التفاصيل لمنتج نشط، اضغط "تعطيل".
- **Assert:** الحالة تتحول "غير نشط"؛ زر "تعطيل" يختفي (الشرط `status === "active"`); لا حوار تأكيد.

##### INV-091 — `[NOT IMPLEMENTED]` no edit action
- **Pre:** منتج قابل للتهيئة موجود.
- **Steps:** ابحث عن أي طريقة لتعديل الصيغ/المدخلات/الخامات بعد الإنشاء.
- **Assert:** لا يوجد — الشاشة توفر فقط "إنشاء" و"تعطيل"؛ لا `useUpdateConfigurableProduct` ولا زر تعديل في `ProductDetail`.

##### INV-092 — `[NOT IMPLEMENTED]` no row menu / no quick "new custom order"
- **Assert:** لا قائمة كيباب على صفوف القائمة، ولا زر سريع "أمر تصنيع مخصص جديد" على كل صف كما يصف الكتالوج — للوصول لإنشاء أمر تصنيع مخصص يجب الانتقال يدوياً لشاشة "التصنيع المخصص" (قسم 13).

##### INV-093 — Status chips and search
- **Steps:** بعد إنشاء منتجين (أحدهما مُعطَّل)، اضغط شريحة "نشط" ثم "غير نشط"، ثم ابحث بالكود.
- **Assert:** كل فلتر يعزل الصف الصحيح؛ لا صفحات (كل النتائج تُعرض دفعة واحدة).

---

### 5. أرصدة المخزون (Stock Balance)

Read-only rollup — no create/edit, no filter chips, no filters panel
(**`[NOT IMPLEMENTED]`** مقارنة بالكتالوج: لا فلاتر مستودع/تصنيف/وحدة/نطاق كمية، لا
شرائح "الكل/مخزون منخفض/نفد المخزون").

##### INV-094 — Header stats and columns
- **Steps:** افتح المخزون ← أرصدة المخزون.
- **Assert:** "إجمالي الأصناف" و"نفد المخزون" يطابقان عدد الأصناف ذات رصيد صفري عبر كل المستودعات؛ الأعمدة: الصنف، إجمالي المخزون، متوسط التكلفة، القيمة الإجمالية، عدد المستودعات.

##### INV-095 — Search
- **Steps:** ابحث بجزء من اسم صنف (مثال "شاي").
- **Assert:** تظهر فقط الأصناف المطابقة (ITEM-DEMO-4/5/6).

##### INV-096 — Sort by "إجمالي المخزون"
- **Steps:** اضغط رأس العمود.
- **Assert:** ترتيب رقمي تصاعدي/تنازلي عند التبديل.

##### INV-097 — Reconciliation check — INITIAL_STOCK-only GL evidence
- **Pre:** لا وصول من هذه الشاشة نفسها لرصيد حساب 1200 (خارج نطاق هذا الملف — راجع "Scope boundary").
- **Steps:** لاحظ "متوسط التكلفة" و"القيمة الإجمالية" لصف ITEM-DEMO-1.
- **Assert:** القيمة الإجمالية = المخزون الحالي × متوسط التكلفة المعروض على نفس الصف (فحص حسابي بسيط داخل هذه الشاشة وحدها)؛ أي مطابقة أعمق مع حساب 1200 تتطلب شاشة خارج نطاق هذا الملف.

##### INV-098 — Empty search
- **Steps:** ابحث بنص لا يطابق أي صنف.
- **Assert:** حالة فارغة "لا توجد أصناف مطابقة".

##### INV-099 — Load error + retry
- **Pre:** حاكِ فشل `GET /inventory/stock-balance`.
- **Steps:** افتح الشاشة.
- **Assert:** "تعذّر تحميل أرصدة المخزون." + "إعادة المحاولة".

##### INV-100 — No row navigation to per-warehouse breakdown — `[NOT IMPLEMENTED]`
- **Steps:** اضغط على صف صنف.
- **Assert:** لا شيء يحدث (لا `onRowClick` معرَّف في هذه الشاشة) — لا انتقال لتفاصيل الصنف أو لوحة جانبية، خلافاً لما يفترضه الكتالوج ("النقر على الصف يفتح صفحة الصنف").

---

### 6. تحويلات المخزون (Stock Transfers)

**أهم فجوة في هذا القسم:** زر "حفظ" في نموذج الإنشاء ينفّذ `createStockTransfer` ثم
`confirmStockTransfer` في نفس الاستدعاء — لا توجد مرحلة "مسودة" قابلة للمراجعة، ولا زر
"تأكيد" مستقل، ولا زر إلغاء لمسودة قائمة. التحويل المسودة الوحيد في البيانات المزروعة
(`TRF-DEMO-3`) أُنشئ عبر مسار خلفي مخصّص للبذر (`/inventory/stock-transfers/draft`) لا
تستخدمه الواجهة إطلاقاً — وبمجرد وجوده، **لا يوجد أي زر في الواجهة لتأكيده**.

##### INV-101 — Header stats and attention banner
- **Pre:** TRF-DEMO-1/2 مؤكدان، TRF-DEMO-3 مسودة.
- **Steps:** افتح المخزون ← تحويلات المخزون.
- **Assert:** "إجمالي التحويلات" = 3، "مسودة" = 1، "مؤكد" = 2.

##### INV-102 — Status chip "مسودة"
- **Steps:** اضغط شريحة "مسودة".
- **Assert:** صف واحد فقط (TRF-DEMO-3).

##### INV-103 — Draft row has no confirm action — `[NOT IMPLEMENTED]`
- **Pre:** من INV-102.
- **Steps:** افتح صف TRF-DEMO-3.
- **Assert:** تفتح صفحة التفاصيل، لكن لا يوجد أي زر "تأكيد" في الرأس ولا في أي مكان آخر بالصفحة (فحص الكود: الإجراء الوحيد الشرطي هو نص تنبيه يظهر فقط عندما `status === "confirmed"`؛ لا إجراء مقابل لحالة `draft`). هذا التحويل **عالق دون تأكيد بشكل دائم** عبر الواجهة.

##### INV-104 — Status chip "مؤكد"
- **Steps:** اضغط شريحة "مؤكد".
- **Assert:** صفان (TRF-DEMO-1/2).

##### INV-105 — Route column
- **Steps:** لاحظ عمود "المسار" لـTRF-DEMO-1.
- **Assert:** "مستودع الفرع الرئيسي ← مستودع فرع الجيزة" (أو الاسم المكافئ لـWH-MAIN وWH-GIZA).

##### INV-106 — Search by transfer number / memo
- **Steps:** ابحث بجزء من رقم التحويل.
- **Assert:** يعزل الصف الصحيح.

##### INV-107 — Create: warehouse required + same-warehouse rejected
- **Steps:** اضغط "تحويل جديد"، اختر نفس المستودع في "المستودع المصدر" و"المستودع الوجهة".
- **Assert:** تنبيه "يجب أن يختلف المستودع المصدر عن مستودع الوجهة."؛ زر "حفظ" معطّل.

##### INV-108 — Create: line qty must be > 0
- **Steps:** اختر صنفاً في السطر الأول، اترك "كمية التحويل" = 0.
- **Assert:** "حفظ" معطّل (`allLinesValid` يتطلب `qty > 0`).

##### INV-109 — Create: service items excluded from item picker
- **Steps:** افتح قائمة اختيار الصنف في أي سطر.
- **Assert:** لا يظهر أي صنف من نوع "خدمة" (فلتر `i.type !== "service"` في `itemOptions`) — لا صنف خدمي مزروع أصلاً في هذا التينانت، لكن الفلتر موجود في الكود بغض النظر.

##### INV-110 — Add / remove line
- **Steps:** اضغط "إضافة بند" مرتين، ثم احذف أحد السطور الجديدة (✕)، اترك سطراً واحداً، تحقق أن زر الحذف معطّل عليه.
- **Assert:** لا يمكن حذف آخر سطر متبقٍ.

##### INV-111 — Non-numeric quantity — native browser rejection
- **Steps:** حاول كتابة حروف في حقل "كمية التحويل" (type=number).
- **Assert:** المتصفح يرفض إدخال الحروف أصلاً؛ القيمة تبقى دون تغيير.

##### INV-112 — Effects panel text
- **Steps:** لاحظ بطاقة "تأثيرات هذا التحويل" أثناء الإنشاء.
- **Assert:** "خصم الكميات من المستودع المصدر وإضافتها للمستودع الوجهة" و"لا يتغير إجمالي قيمة المخزون".

##### INV-113 — Full create → auto-confirm → reload (value-neutral transfer)
- **Pre:** لاحظ "متوسط التكلفة" و"القيمة الإجمالية" لـITEM-DEMO-1 في أرصدة المخزون قبل التحويل.
- **Steps:** أنشئ تحويلاً من WH-MAIN إلى WH-GIZA لـ10 وحدات من ITEM-DEMO-1، اضغط "حفظ"، أعد تحميل شاشة أرصدة المخزون.
- **Assert:** رقم التحويل الجديد يظهر مباشرة بحالة "مؤكد" (لا حالة مسودة وسيطة مرئية للمستخدم رغم أن الطلبين منفصلان في الشبكة)؛ "متوسط التكلفة" لـITEM-DEMO-1 لا يتغير؛ "القيمة الإجمالية" الكلية (مجموع كل الصفوف في أرصدة المخزون) لا تتغير — القيمة انتقلت بين مستودعين فقط، لم تخرج من الشركة.

##### INV-114 — Cancel discards draft
- **Steps:** افتح "تحويل جديد"، عبّئ بعض الحقول، اضغط "إلغاء".
- **Assert:** لا طلب شبكة يُرسل؛ العودة لقائمة التحويلات بلا تغيير.

##### INV-115 — Confirmed transfer detail: cannot-cancel notice
- **Steps:** افتح TRF-DEMO-1.
- **Assert:** نص "لا يمكن إلغاء تحويل مؤكد — بعد تأكيد التحويل لا يمكن إلغاؤه. لعكس الحركة، أنشئ تحويلاً جديداً بالاتجاه المعاكس."

##### INV-116 — Detail: lines tab only — `[NOT IMPLEMENTED]`
- **Steps:** افتح تفاصيل أي تحويل.
- **Assert:** تبويب واحد فقط "البنود"؛ لا تبويبي "المرفقات" أو "سجل التدقيق" كما يصف الكتالوج.

##### INV-117 — Detail: status stepper
- **Steps:** لاحظ شريط الحالة أعلى التفاصيل.
- **Assert:** خطوتان: "مسودة" ← "مؤكد"؛ للتحويلات المؤكدة تظهر الخطوة الثانية مكتملة.

##### INV-118 — `[NOT IMPLEMENTED]` no Excel import
- **Steps:** ابحث عن زر "استيراد من إكسل" في نموذج الإنشاء كما يصف الكتالوج.
- **Assert:** غير موجود.

##### INV-119 — Empty search / no results
- **Steps:** ابحث برقم غير موجود.
- **Assert:** حالة فارغة "لا توجد تحويلات مطابقة".

---

### 7. تسويات المخزون (Stock Adjustments)

Same one-click create+confirm pattern as Transfers: زر "اعتماد التسوية" ينفّذ الإنشاء
والتأكيد معاً؛ لا مرحلة مسودة مرئية، ولا زر تأكيد منفصل.

##### INV-120 — Header stats
- **Pre:** 6 تسويات مزروعة، كلها مؤكدة.
- **Steps:** افتح المخزون ← تسويات المخزون.
- **Assert:** "إجمالي التسويات" = 6، "مسودة" = 0، "مؤكد" = 6.

##### INV-121 — Reason picker: all 8 cards
- **Steps:** اضغط "تسوية جديدة".
- **Assert:** 8 بطاقات بالترتيب: رصيد افتتاحي، تصحيح جرد، تلف، سرقة، انتهاء صلاحية، نقص / فقدان، مرتجع للمورد، أخرى — كل بطاقة بوصف سطر واحد مطابق تماماً لـ`ADJUSTMENT_REASON_DEFINITIONS` (`packages/domain/src/inventory/reasons.ts`).

##### INV-122 — Reason "رصيد افتتاحي" → IN-only form
- **Steps:** اختر "رصيد افتتاحي".
- **Assert:** عنوان الصفحة يتحول "الرصيد الافتتاحي"؛ لا عمود "الاتجاه" في جدول البنود (الاتجاه IN ثابت)؛ حقل "سعر التكلفة" مفعّل (مطلوب لأي سطر IN).

##### INV-123 — Reason "تلف" → OUT-only form
- **Steps:** اختر "تلف".
- **Assert:** لا عمود "الاتجاه"؛ حقل "سعر التكلفة" معطّل تلقائياً (الاتجاه OUT ثابت، والتكلفة تُحسب من متوسط التكلفة الحالي لا تُدخل يدوياً).

##### INV-124 — Reason "تصحيح جرد" → EITHER, direction picker per line
- **Steps:** اختر "تصحيح جرد".
- **Assert:** يظهر عمود "الاتجاه" لكل سطر (زيادة/نقصان)؛ اختيار "نقصان" يعطّل حقل سعر التكلفة لذلك السطر، واختيار "زيادة" يفعّله ويطلبه.

##### INV-125 — Line validation: qty must be > 0
- **Steps:** اترك "الكمية" = 0 لسطر، لاحظ "اعتماد التسوية".
- **Assert:** الزر معطّل.

##### INV-126 — Line validation: IN direction requires unit cost > 0
- **Steps:** في تسوية "أخرى"، اختر اتجاه "زيادة"، اترك "سعر التكلفة" = 0.
- **Assert:** "اعتماد التسوية" معطّل حتى يُدخل سعر موجب.

##### INV-127 — Add / remove line, minimum one line
- **Steps:** أضف سطرين، احذف واحداً، حاول حذف السطر الأخير المتبقي.
- **Assert:** لا يمكن حذف آخر سطر.

##### INV-128 — Effects panel text — direction-dependent
- **Steps:** أنشئ تسوية بسطر واحد اتجاهه "زيادة"، لاحظ بطاقة "تأثيرات هذه التسوية".
- **Assert:** "ارتفعت قيمة المخزون حسب بنود التسوية"؛ لو كان الاتجاه "نقصان" يظهر "انخفضت قيمة المخزون..." بدلاً منها. في الحالتين: "لا تأثير على المورد أو العميل" و"ينشئ قيداً محاسبياً موازناً عند وجود فرق قيمة" (**هذا السطر الثالث مضلل لغير INITIAL_STOCK — راجع INV-133**).

##### INV-129 — Opening balance full round-trip + GL check (D2's positive case)
- **Steps:** أنشئ تسوية "رصيد افتتاحي" لصنف جديد أو موجود، مستودع WH-MAIN، كمية 50، سعر تكلفة 20، اضغط "اعتماد التسوية"، افتح التفاصيل ← تبويب "المحاسبة".
- **Assert:** التسوية تظهر مؤكدة فوراً؛ تبويب "المحاسبة" يعرض قيداً بمدين "المخزون — 1200" 1000.00 ودائن "رأس مال الملاك — 3100" 1000.00 (50 × 20).

##### INV-130 — Existing DAMAGE adjustment: GL tab shows D2-pattern gap
- **Pre:** ADJ-DEMO-2 (DAMAGE, OUT 6× ITEM-DEMO-2).
- **Steps:** افتح ADJ-DEMO-2 ← تبويب "المحاسبة".
- **Assert:** "لا يوجد قيد محاسبي لهذه التسوية (لا يوجد فرق قيمة)." — رغم أن التسوية غيّرت الكمية والقيمة فعلياً. هذا نفس آلية D2 (`adjustmentGlAccountsForReason` تُرجع `null` لأي سبب غير `INITIAL_STOCK`)، وليس حالة استثنائية.

##### INV-131 — Existing OTHER adjustment: same gap
- **Pre:** ADJ-DEMO-3 (OTHER, IN 18× ITEM-DEMO-3 @ 31).
- **Steps:** افتح تبويب "المحاسبة".
- **Assert:** نفس رسالة "لا يوجد قيد محاسبي..." رغم أن هذه تسوية IN بقيمة موجبة واضحة (18 × 31 = 558.00) ظاهرة في تبويب "بنود التسوية".

##### INV-132 — Existing EXPIRY adjustment: same gap
- **Pre:** ADJ-DEMO-4 (EXPIRY, OUT 20× ITEM-DEMO-8).
- **Steps:** افتح تبويب "المحاسبة".
- **Assert:** نفس الرسالة.

##### INV-133 — PHYSICAL_COUNT-generated adjustments: D2 itself
- **Pre:** ADJ-DEMO-5 وADJ-DEMO-6 (مولّدتان من PC-DEMO-1/PC-DEMO-2 على نفس الصنف بنفس الكمية باتجاهين متعاكسين).
- **Steps:** افتح كل تسوية على حدة ← تبويب "المحاسبة".
- **Assert:** كلتاهما "لا يوجد قيد محاسبي..." — هذا هو D2 حرفياً. لاحظ أن صافي قيمتهما معاً = صفر بسبب تصميم البيانات المزروعة (نفس الصنف، نفس الكمية، اتجاه معاكس) — **هذا لا يثبت أن المسار آمن**، فقط أن البيانات المزروعة تتجنبه. أنشئ تسوية PHYSICAL_COUNT بقيمة صافية غير صفرية (وليس عبر شاشة الجرد الفعلي، بل مباشرة من "تسوية جديدة" ← "تصحيح جرد") لإثبات أن الفجوة تدفع مخزون فرعي غير متطابق مع حساب 1200 لأي مبلغ غير صفري.

##### INV-134 — Bench: lines tab shows before/change/after — `[partial vs. catalog]`
- **Steps:** افتح أي تسوية ← تبويب "بنود التسوية".
- **Assert:** الأعمدة الفعلية: الصنف، الاتجاه، الكمية، سعر التكلفة، القيمة. **`[NOT IMPLEMENTED]`**: لا عمودي "قبل" و"بعد" الكمية كما يصف الكتالوج — فقط الكمية المتحركة نفسها، لا الرصيد قبل/بعد.

##### INV-135 — Confirmed-adjustment cannot-cancel notice
- **Steps:** افتح أي تسوية مؤكدة.
- **Assert:** نص "لا يمكن إلغاء تسوية مؤكدة — ... لعكس الأثر، أنشئ تسوية جديدة بالاتجاه المعاكس."

##### INV-136 — Detail: only 2 tabs — `[NOT IMPLEMENTED]`
- **Assert:** لا تبويبي "المرفقات" أو "سجل التدقيق" كما يصف الكتالوج — فقط "بنود التسوية" و"المحاسبة".

##### INV-137 — `[NOT IMPLEMENTED]` no opening-balance shortcut from Items
- **Steps:** ابحث في شاشة الأصناف عن زر "تحديد الرصيد الافتتاحي" على صف صنف برصيد صفري كما يصف الكتالوج.
- **Assert:** غير موجود (راجع INV-048) — المسار الوحيد لرصيد افتتاحي هو بطاقة "رصيد افتتاحي" في منتقي الأسباب مباشرة.

##### INV-138 — Warehouse / reason filters
- **Steps:** لاحظ عمود "المستودع / السبب" لكل صف، ابحث برقم التسوية.
- **Assert:** كل صف يعرض "اسم المستودع — تسمية السبب"، مثال "مستودع الفرع الرئيسي — تلف".

##### INV-139 — Cancel discards draft
- **Steps:** ادخل منتقي الأسباب، اختر سبباً، عبّئ سطراً، اضغط "رجوع" ثم "إلغاء".
- **Assert:** لا طلب شبكة؛ العودة لقائمة التسويات.

---

### 8. الجرد الفعلي (Physical Counts)

Fully implemented — the catalog's read-only pass never reached a filled session; this
build's is real end-to-end.

##### INV-140 — Header stats
- **Pre:** PC-DEMO-1/2 مكتملتان بتسوية مولّدة، PC-DEMO-3 قيد التنفيذ.
- **Steps:** افتح المخزون ← الجرد الفعلي.
- **Assert:** "إجمالي عمليات الجرد" = 3، "قيد التنفيذ" = 1، "مكتمل" = 0 (كلتا PC-DEMO-1/2 انتقلتا لحالة "تم إنشاء التسوية" وليس "مكتمل" بعد توليد التسوية)، "تم إنشاء التسوية" = 2.

##### INV-141 — Status chip "تم إنشاء التسوية"
- **Steps:** اضغط الشريحة.
- **Assert:** صفان (PC-DEMO-1/2).

##### INV-142 — Variance column shows "جرد أعمى" for blind, in-progress session
- **Pre:** PC-DEMO-3 (أعمى، قيد التنفيذ).
- **Steps:** لاحظ عمود "صافي قيمة الفرق" لصف PC-DEMO-3.
- **Assert:** نص "جرد أعمى" بدل أي رقم — لا فرق محسوب أو ظاهر قبل الإنهاء.

##### INV-143 — New count dialog: warehouse required, item count preview
- **Steps:** اضغط "جرد جديد"، اختر مستودعاً.
- **Assert:** نص "سيتم تحميل جميع الأصناف المتوفرة في المستودع المحدد مع أرصدتها الحالية (N صنف)." يتحدث حسب عدد الأصناف ذات رصيد ≠ صفر في ذلك المستودع؛ زر "إضافة" معطّل إن كان N = 0.

##### INV-144 — Blind toggle hint text
- **Steps:** فعّل مفتاح "جرد أعمى".
- **Assert:** نص التلميح: "يُخفي كميات النظام عن القائم بالجرد حتى إنهاء الجلسة — الرصيد يُلتقط عند الفتح في الحالتين."

##### INV-145 — Blind counting genuinely hides system quantity — positive proof
- **Pre:** PC-DEMO-3 (أعمى، قيد التنفيذ، سطر ITEM-DEMO-3 لم يُعدّ بعد).
- **Steps:** افتح PC-DEMO-3 (زر "متابعة الجرد" من تفاصيلها، أو مباشرة إن كانت الجلسة النشطة).
- **Assert:** بانر "جرد أعمى — كميات النظام والفروقات مخفية حتى إنهاء الجرد."؛ عمودا "النظام" و"الفرق" **غير موجودين إطلاقاً** في الجدول (لا يُعرضان مموّهين — العمود نفسه غير مُصيَّر عند `blindOpen`)؛ العمود الوحيد الظاهر بجانب الصنف هو "المعدود". هذا يثبت أن الميزة تعمل كما ينبغي — لو ظهر أي رقم نظام هنا، فتلك هي الميزة وهي تفشل.

##### INV-146 — Blind count: counted input starts blank/zero, not pre-biased
- **Steps:** لاحظ القيمة الابتدائية لحقل "المعدود" لسطر لم يُعدّ بعد ضمن PC-DEMO-3.
- **Assert:** القيمة الابتدائية "0" (`count.blind ? "0" : systemQty`) — لا تحيّز نحو رقم النظام، خلافاً لجلسة غير عمياء (راجع INV-147).

##### INV-147 — Non-blind count: counted input pre-filled with system qty — worth flagging
- **Pre:** أنشئ جرداً غير أعمى جديداً.
- **Steps:** ابدأ الجرد، لاحظ القيمة الابتدائية لحقل "المعدود" لأي سطر.
- **Assert:** الحقل معبأ مسبقاً بكمية النظام نفسها (`l.systemQty`) — القائم بالجرد يرى الرقم المتوقع منذ اللحظة الأولى حتى في جرد "ظاهر" عادي؛ هذا سلوك مقصود لغير الأعمى لكنه يستحق الإشارة له كفرق تصميم واضح عن الجرد الأعمى.

##### INV-148 — "إنهاء الجرد" disabled until every line has a valid quantity
- **Pre:** PC-DEMO-3، سطر ITEM-DEMO-3 فارغ.
- **Steps:** لاحظ زر "إنهاء الجرد".
- **Assert:** معطّل (`!allCounted`) حتى تُدخل قيمة رقمية صالحة لكل سطر، بما فيها ITEM-DEMO-3.

##### INV-149 — "حفظ ومتابعة لاحقاً" pauses without completing
- **Steps:** أدخل بعض القيم في جلسة جرد نشطة، اضغط "حفظ ومتابعة لاحقاً".
- **Assert:** يعود لقائمة الجرد؛ حالة الجرد تبقى "قيد التنفيذ"؛ القيم المُدخلة **لا تُحفظ للخادم** (لا استدعاء `recordPhysicalCounts` عند هذا الزر — فقط `onDone()` محلي) — عند العودة لاحقاً عبر "متابعة الجرد" تُعاد تعبئة الحقول من قيم النظام/الفارغة الأصلية، وليس مما كُتب سابقاً. سجّل هذا كخلل محتمل عند التنفيذ (فقدان تقدّم الجرد الجزئي).

##### INV-150 — Complete a fresh (non-blind) count end to end
- **Pre:** جرد جديد على WH-MAIN لأصناف معروفة الكمية.
- **Steps:** أدخل كميات معدودة تختلف عن كمية النظام لسطر واحد على الأقل (زيادة 3 وحدات)، اضغط "إنهاء الجرد".
- **Assert:** الحالة تتحول "مكتمل"؛ التفاصيل تعرض "أصناف بها فروقات" ≥ 1، "قيمة الزيادة" > 0، "صافي قيمة الفرق" موجب.

##### INV-151 — Generate adjustment from a completed count
- **Pre:** من INV-150 (الحالة "مكتمل").
- **Steps:** من تفاصيل الجرد، اضغط "توليد تسوية".
- **Assert:** الحالة تتحول "تم إنشاء التسوية"؛ حقل "التسوية الناتجة" يتحول من "—" إلى "تم إنشاؤها"؛ التسوية الجديدة تظهر في شاشة تسويات المخزون بسبب "تصحيح جرد"، وتبويب "المحاسبة" لها يعرض نفس فجوة D2 (لا قيد) إن كانت قيمتها الصافية غير صفرية — راجع INV-133.

##### INV-152 — PC-DEMO-1 / PC-DEMO-2 concrete cross-warehouse variance
- **Pre:** PC-DEMO-1 (الرئيسي) أنقص ITEM-DEMO-2 بمقدار 4 عن النظام؛ PC-DEMO-2 (الجيزة) أزاد نفس الصنف بنفس المقدار.
- **Steps:** افتح تفاصيل PC-DEMO-1 ثم PC-DEMO-2.
- **Assert:** PC-DEMO-1: "قيمة العجز" > 0، "صافي قيمة الفرق" سالب. PC-DEMO-2: "قيمة الزيادة" > 0، "صافي قيمة الفرق" موجب، بنفس القيمة المطلقة تقريباً (نفس الصنف، نفس الكمية، ومتوسط تكلفة الجيزة يساوي متوسط تكلفة الرئيسي وقت الجرد لأن كل مخزون الجيزة من هذا الصنف جاء من TRF-DEMO-1 بلا إعادة توسيط منذ ذلك الحين).

##### INV-153 — Resume an in-progress count from detail
- **Pre:** PC-DEMO-3 (قيد التنفيذ).
- **Steps:** افتح تفاصيل PC-DEMO-3، اضغط "متابعة الجرد".
- **Assert:** يعود لشاشة إدخال الجرد بنفس القيم المسجلة (ITEM-DEMO-7/8 المعدودتان مسبقاً، ITEM-DEMO-3 فارغة).

##### INV-154 — Cancel/empty search
- **Steps:** ابحث برقم جرد غير موجود.
- **Assert:** حالة فارغة (النص الفعلي هو رسالة الخطأ إن فشل الطلب، أو "لا توجد عمليات جرد — أنشئ عملية جرد فعلي لمطابقة المخزون الفعلي مع النظام" إن كانت القائمة فارغة أصلاً؛ هنا فقط لا نتائج بحث فتُستخدم قائمة `filtered` الفارغة بنفس مكوّن الحالة الفارغة).

##### INV-155 — Warehouse filter / date range — `[NOT IMPLEMENTED]`
- **Assert:** لا فلتر مستودع ولا نطاق تاريخ في هذه الشاشة رغم أن الكتالوج يذكرهما ("Filters: المستودع، من/إلى تاريخ") — فقط شرائح الحالة والبحث بالرقم.

---

### 9. طباعة الملصقات (Label Printing)

Stateless single-page builder; barcode rendering verified real (Code128 SVG via
`bwip-js`), not placeholder text.

##### INV-156 — Disclaimer banner
- **Steps:** افتح المخزون ← طباعة الملصقات.
- **Assert:** "السعر المطبوع هو السعر الفعلي الذي تحسبه نقطة البيع للعميل العادي (بعد قوائم الأسعار والشرائح). الطباعة لا تغير أي سعر."

##### INV-157 — `[NOT IMPLEMENTED]` no item/document mode toggle
- **Steps:** ابحث عن مبدّل "صنف / مستند" كما يصف الكتالوج.
- **Assert:** غير موجود — الشاشة في وضع "صنف" فقط دائماً.

##### INV-158 — Add item populates table row from live item data
- **Steps:** ابحث عن "أرز أبيض" في "إضافة صنف"، اخترها.
- **Assert:** سطر جديد بالاسم/الكود/الباركود (`item.barcodes[0] ?? item.code`، هنا الكود "IT-0001" لأن الصنف بلا باركود مسجل)/السعر المطبوع (سعر البيع الحالي 180.00)/عدد النسخ = 1 افتراضياً.

##### INV-159 — Already-added items excluded from picker
- **Pre:** من INV-158.
- **Steps:** افتح "إضافة صنف" مجدداً.
- **Assert:** "أرز أبيض ٥ كجم" لم تعد ضمن الخيارات.

##### INV-160 — Copies QtyInput bounds
- **Steps:** غيّر "عدد النسخ" لسطر إلى 0 ثم 1000.
- **Assert:** الحقل يفرض `min=1, max=999` — لا يقبل قيمة أقل من 1 ولا أكبر من 999.

##### INV-161 — Remove line
- **Steps:** اضغط "إزالة" على سطر.
- **Assert:** يختفي من الجدول؛ الإجمالي "N ملصق" يتحدث.

##### INV-162 — Template dropdown default + switch
- **Steps:** لاحظ "قالب الملصق" الافتراضي، ثم غيّره.
- **Assert:** الخيارات الثلاثة بنصها الحرفي: "ملصق حراري — 40×30mm" (افتراضي)، "ملصق رف — 50×25mm"، "ملصق منتج — 100×50mm"؛ تغيير القالب يعيد رسم "معاينة الملصق" بأبعاد جديدة فوراً.

##### INV-163 — Barcode-too-long warning appears and clears
- **Pre:** أضف باركوداً طويلاً (25+ خانة) لصنف عبر شاشة الأصناف أولاً (راجع INV-028)، مثال `1234567890123456789012345`.
- **Steps:** في طباعة الملصقات، أضف ذلك الصنف مع القالب الافتراضي "ملصق حراري — 40×30mm" (العرض 40mm؛ الحد الأقصى لعدد خانات باركود يناسبه ≈ 22 خانة عند 1.5mm/خانة + هامش 6mm).
- **Assert:** تحذير أحمر تحت قيمة الباركود بنص "الباركود لا يناسب هذا القالب"؛ زر "معاينة وطباعة" معطّل (`hasBlockingIssues`).

##### INV-164 — Switching to a bigger template clears the warning
- **Pre:** من INV-163.
- **Steps:** غيّر القالب إلى "ملصق منتج — 100×50mm" (العرض 100mm يستوعب حتى ≈62 خانة).
- **Assert:** التحذير يختفي؛ "معاينة وطباعة" يصبح مفعّلاً (إن لم يوجد سطر آخر معطِّل).

##### INV-165 — Print button disabled with zero items
- **Steps:** أزل كل الأصناف من الجدول.
- **Assert:** "معاينة وطباعة" معطّل؛ صف الجدول يعرض "لم تتم إضافة أي صنف بعد."

##### INV-166 — Running total sums copies across lines
- **Steps:** أضف صنفين بعدد نسخ 3 و5.
- **Assert:** "الإجمالي: 8 ملصق".

##### INV-167 — Live preview renders real Code128 SVG barcode
- **Pre:** صنف بباركود صالح مضاف للجدول.
- **Steps:** لاحظ لوحة "معاينة الملصق" أسفل الصفحة.
- **Assert:** بلاطة المعاينة تحتوي عنصر SVG حقيقي مُدرج عبر `bwip-js` (`bcid: "code128"`) — وليس نصاً بديلاً أو صورة ثابتة؛ يمكن مسحه ضوئياً بقارئ Code 128 حقيقي. يظهر اسم الصنف فوقه (مقصوص RTL) والكود والسعر أسفله.

##### INV-168 — Preview shows at most 6 tiles
- **Steps:** أضف 8 أصناف.
- **Assert:** لوحة المعاينة تعرض أول 6 فقط (`lines.slice(0, 6)`)؛ ورقة الطباعة الفعلية (`.mz-print-sheet`, مخفية إلا عند الطباعة) تحتوي كل النسخ من كل الأصناف الثمانية.

##### INV-169 — Print triggers real `window.print()`
- **Steps:** مع سطر واحد صالح، اضغط "معاينة وطباعة".
- **Assert:** يُستدعى `window.print()` مباشرة — لا خطوة "معاينة" منفصلة رغم اسم الزر؛ `@page` تُضبط ديناميكياً بأبعاد القالب المختار (مم).

---

### 10. هبوط قيمة المخزون (Writedown Runs)

`[NOT IN CATALOG]` — build-only feature. Monthly batch: Dr 5060 (مصروف هبوط القيمة) /
Cr 1190 (مخصص هبوط — عكس أصل)، منفصل تماماً عن حساب المخزون 1200 ولا يمسّ متوسط
التكلفة المسجل.

##### INV-170 — Header stats + existing posted run
- **Pre:** عملية واحدة مزروعة، فترة `2026-08`، مرحّلة.
- **Steps:** افتح المخزون ← هبوط قيمة المخزون.
- **Assert:** "إجمالي العمليات" = 1، "مسودة" = 0، "مرحل" = 1.

##### INV-171 — Status chip "مرحل"
- **Steps:** اضغط الشريحة.
- **Assert:** الصف الوحيد يظهر.

##### INV-172 — Detail: period, warehouse, total, journal link
- **Steps:** افتح الصف المرحّل.
- **Assert:** "الفترة" = 2026-08، "المستودع" = "كل المستودعات" (لم يُحدَّد مستودع عند الإنشاء)، "تاريخ الترحيل" ≠ "—"، "قيد اليومية" يظهر معرّفاً حقيقياً.

##### INV-173 — Detail line table shows raw item id — `[NOT IMPLEMENTED gap]`
- **Steps:** لاحظ عمود "الصنف" في جدول "تفاصيل البنود".
- **Assert:** يعرض `itemId` الخام (مثال "ITEM-DEMO-6") **وليس** اسم الصنف بالعربية — لا استدعاء لخريطة تسمية هنا، خلافاً لكل شاشة أخرى في هذا الملف.

##### INV-174 — Detail line: aging days and rate for ITEM-DEMO-6
- **Pre:** ITEM-DEMO-6 استُلم 2026-02-15، تجاوز عتبة 180 يوماً بحلول أغسطس 2026 ولم يتحرك منذ ذلك الحين.
- **Steps:** لاحظ سطر ITEM-DEMO-6.
- **Assert:** "أيام التقادم" > 180؛ "نسبة المخصص" > 0%؛ "المبلغ" > 0.

##### INV-175 — Create: year/month bounds validation
- **Steps:** اضغط "تشغيل عملية جديدة"، اكتب سنة خارج 2000–2100 (مثال 1999)، اضغط "تشغيل".
- **Assert:** خطأ "السنة غير صحيحة."

##### INV-176 — Create: month bounds validation
- **Steps:** اكتب شهراً = 13.
- **Assert:** خطأ "الشهر يجب أن يكون بين 1 و12."

##### INV-177 — Create: defaults to current period
- **Steps:** افتح "تشغيل عملية جديدة" دون تعديل.
- **Assert:** السنة/الشهر معبآن تلقائياً بالسنة/الشهر الحاليين.

##### INV-178 — Create: warehouse optional, defaults "كل المستودعات"
- **Steps:** لاحظ حقل "المستودع".
- **Assert:** الخيار الافتراضي "كل المستودعات"؛ يمكن تحديد مستودع واحد صراحة.

##### INV-179 — Create a new draft run for a different period + reload
- **Steps:** أنشئ عملية لفترة `2026-07` (شهر لم يُشغَّل بعد)، احفظ ("تشغيل")، أعد تحميل الصفحة.
- **Assert:** صف جديد بحالة "مسودة"؛ "إجمالي العمليات" = 2، "مسودة" = 1.

##### INV-180 — Post a draft run — per-row pending state
- **Pre:** من INV-179 (مسودة موجودة).
- **Steps:** اضغط "ترحيل" على صف المسودة الجديدة فقط.
- **Assert:** أثناء التنفيذ يظهر النص "جارٍ الترحيل..." **على هذا الصف فقط** — لا تعطيل لبقية الصفوف (نمط pending صحيح لكل عنصر على حدة)؛ بعد النجاح تتحول الحالة "مرحل" ويظهر معرّف قيد اليومية بدل زر "ترحيل".

##### INV-181 — Post error surfaces without disabling other rows
- **Pre:** حاكِ فشل `POST .../post`.
- **Steps:** اضغط "ترحيل" على صف مسودة.
- **Assert:** بطاقة خطأ منفصلة أعلى القائمة (`postError`)؛ الصف يعود لحالة قابلة لإعادة المحاولة (`postingId` يُصفَّر في `finally`)؛ صفوف أخرى غير متأثرة.

##### INV-182 — Empty state
- **Pre:** حاكِ تينانت بلا أي عملية.
- **Steps:** افتح الشاشة.
- **Assert:** "لا توجد عمليات هبوط قيمة — لم يتم تشغيل أي عملية بعد".

##### INV-183 — Reconciliation note: write-down never touches 1200/WAC
- **Steps:** لاحظ وصف الشاشة أسفل العنوان.
- **Assert:** "...تُنشئ مخصصاً محاسبياً (مدين مصروف / دائن مخصص هبوط) للأصناف بطيئة الحركة — دون المساس بتكلفة المخزون المسجلة." — أي أن هذه العملية لا يجب أن تُحدث أي فرق في مطابقة حساب المخزون 1200 (تذهب لحسابي 5060/1190 بدلاً منه)؛ تحقق من أرصدة المخزون لـITEM-DEMO-6 قبل وبعد ترحيل العملية المزروعة — "متوسط التكلفة" و"القيمة الإجمالية" في شاشة أرصدة المخزون يجب ألا يتغيرا بسبب هذه العملية.

---

### 11. أوامر التصنيع (Work Orders)

Row click opens the WO's own detail directly (fixes the catalog's documented "clicking
opens the item, not the WO" outlier). No kebab menu anywhere — so catalog actions
(تكرار/إلغاء أمر التصنيع) have **no button to click** in this build.

##### INV-184 — KPI strip and status chips
- **Pre:** WO-DEMO-1 (مخطط)، WO-DEMO-2 (قيد التنفيذ، بدأ)، WO-DEMO-3 (ملغي).
- **Steps:** افتح التصنيع ← أوامر التصنيع.
- **Assert:** "الإجمالي" = 3، "مخطط" = 1، "جار التنفيذ" = 1، "مكتمل هذا الشهر" = 0. شرائح الحالة: الكل/مخطط/قيد التنفيذ/مكتمل/ملغي — **`[NOT IMPLEMENTED]`** لا شريحة "متأخر" منفصلة (فقط بانر عددي).

##### INV-185 — Overdue banner
- **Pre:** أي أمر بتاريخ انتهاء مجدول ماضٍ وحالة غير مكتملة/ملغاة.
- **Steps:** لاحظ بانر "تحتاج متابعة" أعلى القائمة.
- **Assert:** يعرض عدد الأوامر المتأخرة الفعلي.

##### INV-186 — Search by number or product name
- **Steps:** ابحث "WO-DEMO-2".
- **Assert:** صف واحد.

##### INV-187 — `[NOT IMPLEMENTED]` filters panel
- **Steps:** ابحث عن "تصفية النتائج" (مستودع/أولوية/منتج نهائي/نطاق كمية/نطاق تاريخ) كما يصف الكتالوج.
- **Assert:** غير موجود — فقط شرائح الحالة والبحث النصي.

##### INV-188 — Row click opens WO detail (not item)
- **Steps:** اضغط على أي صف.
- **Assert:** تفتح صفحة تفاصيل أمر التصنيع نفسه مباشرة (`أمر تصنيع WO-000x`) — لا لوحة صنف جانبية.

##### INV-189 — Create: BOM picker only shows active BOMs
- **Steps:** اضغط "أمر عمل جديد"، افتح "قائمة المواد *".
- **Assert:** فقط قوائم المواد النشطة تظهر.

##### INV-190 — Create: required fields gate save
- **Steps:** اترك "مستودع الخامات" أو "مستودع المنتجات" فارغاً، لاحظ "حفظ أمر العمل".
- **Assert:** معطّل حتى تُملأ قائمة المواد + كلا المستودعين + كمية > 0.

##### INV-191 — Create: same warehouse both sides — no rejection (gap)
- **Steps:** اختر نفس المستودع لـ"مستودع الخامات" و"مستودع المنتجات".
- **Assert (expected):** رفض مشابه لتحويلات المخزون. **الفعلي:** لا فحص من هذا النوع في `canSave` — يُقبل بلا تنبيه.

##### INV-192 — Create: planned qty min 0, no required asterisk despite being required
- **Steps:** لاحظ تسمية "الكمية المخططة" (بلا `*` رغم أن `canSave` يتطلبها > 0).
- **Assert:** غياب النجمة تناقض بصري صغير مع القاعدة الفعلية — سجّله كملاحظة اتساق.

##### INV-193 — Create: date fields are free text, no format validation
- **Steps:** اكتب نصاً عشوائياً (مثال "غداً") في "تاريخ البدء المجدول".
- **Assert (expected):** رفض أو تنسيق تلقائي. **الفعلي:** حقل نصي حر بلا أي تحقق من الصيغة — يُقبل أي نص ويُرسل كما هو.

##### INV-194 — Full create + reload
- **Steps:** أنشئ أمر تصنيع جديداً على BOM-DEMO-1، كمية 5، مستودعا خامات/منتجات مختلفين، احفظ، أعد تحميل الصفحة.
- **Assert:** يظهر في القائمة بحالة "مخطط"، الكمية المخططة 5، المنتج النهائي = اسم ITEM-DEMO-5.

##### INV-195 — Cancel discards draft
- **Steps:** افتح النموذج، عبّئ حقولاً، اضغط "إلغاء".
- **Assert:** لا طلب شبكة.

##### INV-196 — Detail: effects copy contradicts D3
- **Steps:** افتح أي أمر تصنيع ← لاحظ قسم "تأثيرات أمر التصنيع".
- **Assert:** السطر الأخير يقرأ: "المنتج النهائي لا يدخل المخزون إلا عند الاستلام؛ وعند الإكمال تُرحَّل قيود رسملة الإنتاج تحت التشغيل تلقائياً." — هذا **خطأ** وفق D3 (`completeWorkOrder` لا يلمس حساب 1200 إطلاقاً). النص نفسه يوثّق سلوكاً غير موجود.

##### INV-197 — Detail: summary omits scheduled end date / BOM version — gap
- **Steps:** لاحظ حقول الملخص أعلى صفحة التفاصيل.
- **Assert:** لا حقل "تاريخ الانتهاء المجدول" ولا "قائمة المواد (الإصدار)" في الملخص، رغم أنهما مُدخلان وقت الإنشاء وموصوفان في الكتالوج.

##### INV-198 — Detail: only 2 tabs — `[NOT IMPLEMENTED]`
- **Steps:** لاحظ التبويبات.
- **Assert:** فقط "المواد" و"التكاليف". لا "استخدام المواد"، "حركة المواد"، "الاستلامات"، "القيود المحاسبية"، "السجل" كما يصف الكتالوج — **لا توجد أي طريقة من هذه الشاشة لرؤية القيود المحاسبية التي أنشأها أمر التصنيع فعلياً**.

##### INV-199 — Materials tab columns
- **Steps:** افتح تبويب "المواد" لأمر بدأ صرف مواده.
- **Assert:** الأعمدة: الصنف، المطلوبة، الصادرة، المرجعة، الصافي — **`[NOT IMPLEMENTED]`**: لا عمودي "الكمية المتاحة" أو "النقص" كما يصف الكتالوج.

##### INV-200 — Stage 1: بدء العمل (single click, no dialog)
- **Pre:** WO-DEMO-1 (مخطط، لم يبدأ).
- **Steps:** افتح WO-DEMO-1، اضغط الزر الأساسي "بدء العمل" في رأس الصفحة.
- **Assert:** المرحلة تتحول "بدء العمل"؛ نص زر الإجراء يتغير فوراً إلى "صرف المواد"؛ لا حوار تأكيد ولا حقل إدخال.

##### INV-201 — Stage 2: صرف المواد (single click, opaque full-qty issue)
- **Pre:** من INV-200.
- **Steps:** اضغط "صرف المواد".
- **Assert:** يصرف كامل الكمية المطلوبة دفعة واحدة (لا حقل كمية جزئية)؛ نص الزر يتحول "استلام المنتج"؛ عمود "الصادرة" في تبويب المواد يتحدث.

##### INV-202 — Stage 3: استلام المنتج opens a side panel
- **Pre:** من INV-201.
- **Steps:** اضغط "استلام المنتج".
- **Assert:** تفتح لوحة "استلام المنتج" بحقل "الكمية المنتجة" معبأ مسبقاً بالكمية المخططة كاملة؛ اضغط "تأكيد الاستلام".
- **Assert (after):** المرحلة تتحول "استلام المنتج"؛ زر رأس الصفحة يتحول "إكمال أمر العمل".

##### INV-203 — Receive panel: qty must be > 0
- **Pre:** لوحة "استلام المنتج" مفتوحة.
- **Steps:** اضبط "الكمية المنتجة" = 0.
- **Assert:** "تأكيد الاستلام" معطّل.

##### INV-204 — Receive panel: cancel
- **Steps:** افتح اللوحة، اضغط "إلغاء".
- **Assert:** اللوحة تُغلق؛ المرحلة تبقى دون تغيير.

##### INV-205 — Cancelled work order shows no action button
- **Pre:** WO-DEMO-3 (ملغي).
- **Steps:** افتح تفاصيله.
- **Assert:** شريط الحالة يظهر بلون تحذيري ("danger")؛ لا يظهر أي زر إجراء أساسي في الرأس (`order.status !== "cancelled"` شرط لعرضه).

##### INV-206 — Stage 4: إكمال أمر العمل — **D3, throwaway DB only**
- **Pre:** ⚠️ **نفّذ هذا السيناريو فقط على قاعدة بيانات مؤقتة قابلة للحذف، وليس قبل أي سيناريو مطابقة GL 1200.** أمر وصل مرحلة "استلام المنتج" (مثال: أكمل WO-DEMO-1 عبر INV-200→INV-202، أو استخدم WO-DEMO-2 بعد صرف مواده).
- **Steps:** اضغط "إكمال أمر العمل" في رأس صفحة التفاصيل.
- **Assert:** نقرة واحدة، بلا حوار تأكيد وبلا أي حقل إدخال؛ المرحلة تتحول "مكتمل". **هذا يُفعِّل D3** — `completeWorkOrder` لا يرحّل أي قيد على حساب 1200 رغم أن كمية الكلفة تحت التشغيل (`قيمة الإنتاج تحت التشغيل` في الملخص) تُصفَّر ظاهرياً؛ أي مطابقة لاحقة بين المخزون الفرعي وحساب 1200 ستنحرف بمقدار قيمة هذا الأمر (قِس بمقارنة "القيمة الإجمالية" الكلية في أرصدة المخزون قبل/بعد — مرجع القياس السابق في defects.md: BOM-DEMO-1 بكمية 10 ينحرف بمقدار 80.00).

##### INV-207 — Silent error on advance actions outside the receive panel — gap
- **Pre:** حاكِ فشل `POST .../start` أو `.../issue-materials` أو `.../complete`.
- **Steps:** اضغط زر الإجراء الأساسي أثناء الفشل المحاكى.
- **Assert (expected):** رسالة خطأ ظاهرة للمستخدم. **الفعلي:** `advance()` يلتقط الخطأ في حالة داخلية (`actionError`) لكن `WorkOrderDetail` لا يعرض هذه الحالة إطلاقاً خارج لوحة الاستلام — الفشل صامت تماماً من منظور المستخدم على الأزرار الثلاثة الأخرى (بدء/صرف/إكمال).

---

### 12. قوائم المواد (BOMs)

##### INV-208 — KPI strip and chips
- **Pre:** BOM-DEMO-1/2 نشطتان.
- **Steps:** افتح التصنيع ← قوائم المواد.
- **Assert:** "الإجمالي" = 2، "نشط" = 2، "غير نشط" = 0.

##### INV-209 — Search by number or product name
- **Steps:** ابحث "BOM-DEMO-2".
- **Assert:** صف واحد.

##### INV-210 — List cost estimate column
- **Steps:** لاحظ عمود "التكلفة التقديرية" لـBOM-DEMO-1.
- **Assert:** رقم غير صفري (مواد + عمالة 50 + مصاريف 30).

##### INV-211 — Create: product picker auto-fills unit
- **Steps:** اضغط "قائمة مواد جديدة"، اختر "المنتج النهائي".
- **Assert:** حقل "الوحدة" يتحدث تلقائياً لوحدة الصنف الأساسية.

##### INV-212 — Create: cannot save with zero valid material lines
- **Steps:** اترك سطر المواد الوحيد بصنف فارغ، لاحظ "حفظ قائمة المواد".
- **Assert:** معطّل (`canSave` يتطلب سطراً واحداً صالحاً على الأقل).

##### INV-213 — Create: negative labor/overhead cost — native min guard only
- **Steps:** اكتب "-10" في "تكلفة العمالة" (حقل رقمي بـ`min=0`).
- **Assert:** الحقل من نوع `number` بخاصية `min=0` (حماية متصفح بصرية فقط ما لم يُستخدم تحقق فعلي عبر `<form>`)؛ لا فحص JS إضافي في `save()` يمنع قيمة سالبة صراحة إن أُدخلت.

##### INV-214 — Create: waste % has no upper bound — gap
- **Steps:** اكتب "500" في "نسبة الهالك %" لسطر مادة.
- **Assert (expected):** رفض قيمة غير منطقية (> 100%). **الفعلي:** لا سقف أعلى (`min={0}` فقط) — القيمة تُقبل وتُغذّي `effectiveQty = qty × (1 + 500/100)` بلا اعتراض.

##### INV-215 — Material line: cannot remove last remaining line
- **Steps:** أضف سطر مادة ثانياً، احذفه، حاول حذف السطر الأخير المتبقي.
- **Assert:** زر "حذف البند" لا يظهر إلا عند وجود أكثر من سطر واحد.

##### INV-216 — Full create + reload
- **Steps:** أنشئ قائمة مواد جديدة لمنتج ITEM-DEMO-4 (خامتان: ITEM-DEMO-1 كمية 2، ITEM-DEMO-3 كمية 1)، احفظ، أعد تحميل الصفحة.
- **Assert:** تظهر بحالة "نشط"، إصدار v1، عدد بنود = 2.

##### INV-217 — Detail: waste-adjusted quantity column
- **Steps:** افتح BOM-DEMO-1 ← تبويب "بنود المواد الخام".
- **Assert:** عمود "الكمية بعد الهالك" = الكمية × (1 + نسبة الهالك/100) لكل سطر (نسبة الهالك = 0% لسطور BOM-DEMO-1 المزروعة، فتساوي الكمية الأصلية تماماً).

##### INV-218 — Detail: cost breakdown summary
- **Steps:** افتح BOM-DEMO-1 ← الملخص.
- **Assert:** "تكلفة المواد"، "إجمالي التكلفة"، "تكلفة الوحدة" مبنية من `bom.estimate` — تكلفة المواد = مجموع (كمية السطر × تكلفة وحدة الصنف)، إجمالي التكلفة = تكلفة المواد + 50 (عمالة) + 30 (مصاريف).

##### INV-219 — Effects copy — versioning semantics
- **Steps:** لاحظ قسم "تأثيرات" في التفاصيل.
- **Assert:** "قائمة المواد وصفة تصنيع فقط — لا تؤثر على المخزون أو الحسابات حتى يُنشأ أمر تصنيع منها."، "الكمية المطلوبة تُضخَّم تلقائياً بنسبة الهالك..."، "إنشاء إصدار جديد يُلغي تنشيط الإصدار السابق (لا يُعدّله)."

##### INV-220 — Deactivate — no confirmation dialog
- **Pre:** قائمة مواد نشطة غير مستخدمة في أمر تصنيع حالي.
- **Steps:** من التفاصيل، اضغط "تعطيل".
- **Assert:** الحالة تتحول "غير نشط" فوراً، **بلا أي حوار تأكيد** رغم أن قوائم المواد نشطة تُستخدم في إنشاء أوامر تصنيع.

##### INV-221 — `[NOT IMPLEMENTED]` no "أمر عمل جديد" shortcut from BOM detail
- **Steps:** ابحث عن زر "أمر عمل جديد" على صفحة تفاصيل قائمة المواد كما يصف الكتالوج.
- **Assert:** غير موجود — يجب الذهاب لشاشة أوامر التصنيع والبحث عن قائمة المواد يدوياً من هناك.

##### INV-222 — `[NOT IMPLEMENTED]` no "إصدار جديد" versioning action
- **Steps:** ابحث عن أي طريقة لإنشاء إصدار جديد من قائمة مواد موجودة (النص التوضيحي يذكر الإصدارات لكن لا زر لإنشاء واحد).
- **Assert:** غير موجود — `createBom` تُنشئ دائماً قائمة جديدة كاملة، لا مسار "إصدار جديد" من داخل شاشة قائمة مواد قائمة.

##### INV-223 — Detail: single tab only — `[NOT IMPLEMENTED]`
- **Assert:** لا تبويبي "سجل الإصدارات" أو "سجل التدقيق" كما يصف الكتالوج — تبويب واحد فقط "بنود المواد الخام (N)"، وبلا صف تذييل "إجمالي تكلفة المواد" داخل الجدول نفسه.

---

### 13. التصنيع المخصص (Custom Manufacturing / Config Instances)

##### INV-224 — Empty state (no seeded config instances)
- **Steps:** افتح التصنيع ← التصنيع المخصص.
- **Assert:** "لا توجد أوامر تصنيع مخصص — أنشئ أمراً جديداً" — لا أوامر مزروعة (لا يوجد منتج قابل للتهيئة أصلاً في البيانات المزروعة، راجع INV-081).

##### INV-225 — Create: product picker active-only
- **Pre:** أنشئ منتجاً قابلاً للتهيئة أولاً (راجع INV-087).
- **Steps:** اضغط "أمر تصنيع مخصص جديد"، افتح "المنتج *".
- **Assert:** فقط المنتجات القابلة للتهيئة النشطة تظهر.

##### INV-226 — Dynamic spec fields render per product input
- **Pre:** من INV-225، منتج بمدخل واحد "width"/"العرض".
- **Steps:** اختر المنتج.
- **Assert:** يظهر حقل نصي بتسمية "العرض" (أو "العرض (min – max)" إن كانت الحدود معرّفة).

##### INV-227 — Spec fields accept non-numeric text — no validation gap
- **Steps:** اكتب "abc" في حقل مواصفة رقمية.
- **Assert (expected):** رفض قيمة غير رقمية. **الفعلي:** الحقل `TextField` نصي بحت رغم أن نوع المدخل معرّف "رقم" — يُقبل أي نص ويُرسل كما هو لمُقيّم المعادلات لاحقاً (قد يفشل هناك بدلاً من الواجهة).

##### INV-228 — Live preview fires only when every spec field is non-blank
- **Steps:** أدخل قيمة في مدخل واحد من أصل اثنين مطلوبين.
- **Assert:** لوحة "معاينة الاحتياجات والتكلفة" تبقى على "أكمل المواصفات لعرض المعاينة." حتى تُملأ كل الحقول.

##### INV-229 — Preview loading and success states
- **Steps:** أكمل كل حقول المواصفات بقيم صالحة.
- **Assert:** "جارِ الحساب…" أولاً، ثم قائمة الخامات (صنف × معادلة الكمية × تكلفة الوحدة = تكلفة السطر)، وسطر "تكلفة الوحدة" الإجمالي، وسطر "السعر المقترح (للوحدة)" إن كانت طريقة التسعير معادلة.

##### INV-230 — Preview error shows raw formula error message
- **Pre:** منتج بمعادلة كمية تقسم على متغير قد يساوي صفراً (أو أي معادلة تفشل عند قيم معينة).
- **Steps:** أدخل قيمة مواصفات تُسقط تقييم المعادلة.
- **Assert:** لوحة المعاينة تعرض نص الخطأ الخام من `preview.error.message` مباشرة — لا رسالة عربية موحّدة، بل أياً كان ما يرجعه المُقيّم.

##### INV-231 — Save is allowed even while preview is erroring — gap
- **Pre:** من INV-230 (معاينة في حالة خطأ).
- **Steps:** أكمل بقية الحقول المطلوبة (الكمية، المستودعان)، لاحظ زر "حفظ".
- **Assert (expected):** تعطيل الحفظ حتى تنجح المعاينة. **الفعلي:** `canSave` لا يتحقق من نجاح `preview` إطلاقاً — يمكن حفظ أمر تصنيع مخصص رغم أن معاينة تكلفته/خاماته تفشل.

##### INV-232 — Create: warehouses required, no distinct-warehouse check
- **Steps:** اختر نفس المستودع لـ"مستودع الخامات" و"مستودع المنتجات"، احفظ.
- **Assert:** يُقبل بلا تنبيه (نفس فجوة INV-191).

##### INV-233 — Customer optional, defaults "بدون عميل"
- **Steps:** لاحظ حقل "العميل" الافتراضي.
- **Assert:** "بدون عميل"؛ الحفظ ممكن بدونه.

##### INV-234 — Full create + reload
- **Steps:** أكمل نموذجاً صالحاً كاملاً، احفظ، أعد تحميل الصفحة.
- **Assert:** أمر جديد يظهر بحالة "مهيأة" (`configured`)، رقم بصيغة `CM-...`.

##### INV-235 — Detail: profit margin tone
- **Steps:** افتح أمراً حُفظ بتكلفة فعلية أو تقديرية أعلى من إجمالي البيع.
- **Assert:** "هامش الربح" يُعرض بلون تحذيري (`danger`) عند القيمة السالبة، وبلون نجاح عند الموجبة.

##### INV-236 — Detail effects copy — auto work order + cost capture
- **Steps:** لاحظ قسم "تأثيرات".
- **Assert:** "يُنشأ أمر تصنيع (Work Order) مرتبط تلقائياً عند إنشاء أمر التصنيع المخصص لتنفيذ الإنتاج الفعلي." و"عند إغلاق الأمر تُحفظ التكلفة الفعلية من أمر التصنيع المرتبط."

##### INV-237 — Detail: linked work order id is inert text, not a link — gap
- **Steps:** افتح تبويب "التكلفة الفعلية"، لاحظ سطر "أمر التشغيل".
- **Assert (expected):** زر قابل للنقر ينقل لتفاصيل أمر التصنيع كما يصف الكتالوج ("WO-0007" كزر). **الفعلي:** نص ثابت يعرض معرّف أمر التصنيع الخام (`instance.workOrderId`) بلا أي إجراء نقر.

##### INV-238 — Close order — no confirmation dialog
- **Pre:** أمر بحالة قابلة للإجراء (`configured`/`in_progress`/`produced`).
- **Steps:** من التفاصيل، اضغط "إغلاق الأمر".
- **Assert:** الحالة تتحول "مغلقة" فوراً بلا حوار تأكيد؛ أزرار "إغلاق الأمر"/"إلغاء" تختفي تماماً بعدها (وليس فقط تُعطَّل).

##### INV-239 — Cancel order — no confirmation dialog
- **Pre:** أمر آخر بحالة قابلة للإجراء.
- **Steps:** اضغط "إلغاء".
- **Assert:** الحالة تتحول "ملغاة" فوراً بلا حوار تأكيد.

##### INV-240 — Status chips and search on list
- **Pre:** بعد إنشاء عدة أوامر بحالات مختلفة.
- **Steps:** اضغط كل شريحة حالة (مهيأة/في التنفيذ/تم الإنتاج ضمن "في التنفيذ"/مغلقة/ملغاة)، ثم ابحث برقم الأمر أو المنتج أو العميل.
- **Assert:** كل فلتر يعزل الصفوف الصحيحة.

---

### 14. لوحة الإنتاج (Production Dashboard)

Pure read-only dashboard — no create/edit surface of its own.

##### INV-241 — KPI strip
- **Pre:** WO-DEMO-1 (مخطط)، WO-DEMO-2 (قيد التنفيذ)، WO-DEMO-3 (ملغي).
- **Steps:** افتح التصنيع ← لوحة الإنتاج.
- **Assert:** "أوامر نشطة" يعكس عدد الأوامر غير المكتملة/الملغاة؛ "قيمة الإنتاج تحت التشغيل" > 0 (WO-DEMO-2 بدأ)؛ "الوحدات المنتجة هذا الشهر" = 0 (لا أمر أُكمل)؛ "أوامر متأخرة" يعتمد على تواريخ الانتهاء المجدولة مقابل تاريخ اليوم. **`[NOT IMPLEMENTED]`**: لا بطاقة رابعة "متوسط التكلفة للوحدة" كما يصف الكتالوج — بديلها هنا "أوامر متأخرة".

##### INV-242 — Bucket lists are non-interactive — gap
- **Steps:** اضغط على أي بطاقة ضمن "بانتظار صرف المواد" أو "بانتظار استلام المنتج" أو "جاهزة للإنهاء".
- **Assert (expected):** ينقل لتفاصيل ذلك الأمر. **الفعلي:** لا `onClick` على هذه البطاقات إطلاقاً — عرض فقط.

##### INV-243 — Bucket: "بانتظار صرف المواد"
- **Pre:** WO-DEMO-2 بدأ لكن لم يُصرف له مواد بعد.
- **Steps:** لاحظ هذه القائمة.
- **Assert:** WO-DEMO-2 يظهر فيها بشريحة الأولوية وكسر التقدّم "0/15".

##### INV-244 — Empty bucket state
- **Steps:** لاحظ قائمة "جاهزة للإنهاء" إن لم يوجد أمر بهذه المرحلة.
- **Assert:** "لا توجد أوامر في هذه المرحلة."

##### INV-245 — Active orders table: next-action button only navigates, doesn't act — gap
- **Steps:** في جدول "جميع الأوامر النشطة"، اضغط زر "الإجراء التالي" (مثال "صرف المواد") لصف WO-DEMO-2.
- **Assert (expected):** ينفّذ خطوة الصرف مباشرة من لوحة الإنتاج. **الفعلي:** الزر يستدعي فقط `navigate("work-orders")` — ينقل لقائمة أوامر التصنيع العامة بلا تنفيذ أي إجراء ولا حتى فتح ذلك الأمر تحديداً؛ يجب على المستخدم البحث عن الأمر من جديد هناك.

##### INV-246 — Label mismatch across screens — gap
- **Pre:** أمر بمرحلة "استلام المنتج" (جاهز للإكمال).
- **Steps:** قارن نص زر "الإجراء التالي" هنا مع نص الزر المكافئ في تفاصيل أمر التصنيع (قسم 11).
- **Assert:** هنا "إنهاء الأمر"؛ هناك "إكمال أمر العمل" — نفس الإجراء بتسمية مختلفة بين الشاشتين.

##### INV-247 — Overdue badge on bucket cards and table rows
- **Pre:** أمر بتاريخ انتهاء ماضٍ وحالة غير مكتملة.
- **Steps:** لاحظه في كل من قوائم "المراحل" وجدول "الأوامر النشطة".
- **Assert:** شارة حمراء "متأخر" في كلا الموضعين لنفس الأمر.

##### INV-248 — Quick-nav header buttons
- **Steps:** اضغط "أوامر التصنيع" ثم عد، اضغط "قوائم المواد".
- **Assert:** كل زر ينقل للشاشة المقابلة مباشرة.

##### INV-249 — Load error + retry
- **Pre:** حاكِ فشل `GET /manufacturing/dashboard`.
- **Steps:** افتح الشاشة.
- **Assert:** "تعذّر تحميل لوحة الإنتاج." + "إعادة المحاولة".

##### INV-250 — No filters/date range — `[expected, matches catalog]`
- **Steps:** ابحث عن أي فلتر أو نطاق تاريخ على هذه الشاشة.
- **Assert:** لا يوجد — هذا متوقع ومطابق للكتالوج (لوحة استثناءات تشغيلية فقط، وليست تقريراً قابلاً للتصفية).

---

### 15. صفحات الإنشاء والتعديل في الأصناف (Create/edit sub-pages)

The five الأصناف screens no longer open their create and edit forms in a side panel; each
form is a page with its own address. That change is what these scenarios exist for — a
panel could only ever be opened by the click that filled it, so none of the reload,
deep-link or Back cases below were previously possible to run at all.

The addresses:

| Page | Address |
|---|---|
| إضافة صنف | `/items/items/new` |
| تعديل صنف | `/items/items/<code>` — e.g. `/items/items/IT-0001` |
| مواصفة جديدة | `/items/item-specifications/new` |
| تعديل مواصفة | `/items/item-specifications/<code>` — e.g. `…/SIZE` |
| قالب منتج جديد | `/items/product-templates/new` |
| تفاصيل قالب منتج | `/items/product-templates/<code>` — e.g. `…/TPL-TEA` |
| منتج قابل للتهيئة جديد | `/items/configurable-products/new` |
| قائمة مواد جديدة | `/items/boms/new` |

The executable half of this subsection is `scripts/scenarios/items-forms.ts`
(`pnpm scenarios items-forms`, 62 assertions): it drives the exact payload each form sends
and asserts the address contract — that every code is unique and resolves to exactly one
row. What stays manual here is what it cannot see: layout, reload, Back, focus and RTL.

#### Addressing and navigation

##### ITMF-001 — «إضافة صنف» opens a page, not a drawer
- **Pre:** افتح الأصناف ← الأصناف.
- **Steps:** اضغط «إضافة صنف».
- **Assert:** يتغيّر العنوان إلى `/items/items/new`؛ تختفي قائمة الأصناف بالكامل ولا تظهر خلف طبقة تعتيم؛ العنوان «إضافة صنف» وفوقه «الأصناف · دليل الأصناف»؛ زرّا «إلغاء» و«إضافة» في رأس الصفحة.

##### ITMF-002 — الصفحة تنجو من إعادة التحميل
- **Steps:** من `/items/items/new` اضغط تحديث الصفحة (F5).
- **Assert:** تعود صفحة «إضافة صنف» نفسها، لا قائمة الأصناف ولا صفحة 404.

##### ITMF-003 — «تعديل» يفتح عنواناً يحمل الكود
- **Steps:** من قائمة الأصناف اضغط أيقونة التعديل في صف «أرز أبيض ٥ كجم».
- **Assert:** العنوان `/items/items/IT-0001` — الكود وليس المعرّف الداخلي (uuid)؛ الترويسة «تعديل صنف» وفتات الخبز تعرض `IT-0001`.

##### ITMF-004 — رابط التعديل المباشر يملأ النموذج
- **Pre:** انسخ `/items/items/IT-0001`.
- **Steps:** افتحه في تبويب جديد وسجّل الدخول.
- **Assert:** النموذج ممتلئ ببيانات الصنف (الاسم، الاسم بالإنجليزية، المورد، الماركة، الموسم) — لا نموذج فارغ. هذه هي الحالة التي لم تكن ممكنة أصلاً مع اللوحة الجانبية.

##### ITMF-005 — المعرّف الداخلي ما زال يعمل
- **Steps:** افتح `/items/items/<uuid>` لنفس الصنف.
- **Assert:** تُفتح صفحة التعديل نفسها — الروابط القديمة المكتوبة بالمعرّف لا تنكسر.

##### ITMF-006 — زر الرجوع في المتصفح يعود للقائمة
- **Steps:** من القائمة افتح «إضافة صنف»، ثم اضغط زر الرجوع في المتصفح.
- **Assert:** تعود قائمة الأصناف بنفس التصفية والصفحة التي غادرتها.

##### ITMF-007 — «إلغاء» يعود للقائمة دون حفظ
- **Steps:** في «إضافة صنف» اكتب اسماً، ثم اضغط «إلغاء».
- **Assert:** تعود القائمة؛ لا يظهر صنف جديد؛ العنوان يعود `/items/items`.

##### ITMF-008 — عنوان لا يطابق أي صنف
- **Steps:** افتح `/items/items/IT-NOPE`.
- **Assert:** «لم يتم العثور على هذا الصنف.» مع زر «العودة إلى الأصناف» — لا نموذج فارغ (نموذج فارغ هنا كان سينشئ صنفاً ثانياً عند الحفظ).

##### ITMF-009 — العنوان أثناء التحميل
- **Steps:** افتح `/items/items/IT-0001` مع إبطاء الشبكة.
- **Assert:** يظهر «جارٍ التحميل…» قبل النموذج — لا تظهر رسالة «لم يتم العثور» أثناء انتظار القائمة.

#### الكود المقترح في صفحة الإضافة

##### ITMF-010 — الكود المقترح حرّ (تراجع مُصحَّح)
- **Steps:** افتح `/items/items/new` بالضغط من القائمة، لاحظ «كود الصنف». ثم افتح العنوان نفسه مباشرة بإعادة تحميل الصفحة.
- **Assert:** الكود نفسه في الحالتين، وهو الكود التالي الحر (مثلاً `ITM-000052`) — **وليس** `ITM-000001`. التحميل البارد كان يحسب الكود من قائمة فارغة فيقترح كوداً مأخوذاً.
- **Guards:** `nextCodeIsFree` في `scripts/scenarios/items-forms.ts`.

##### ITMF-011 — حقل الكود غير قابل للتحرير
- **Assert:** «كود الصنف» معطّل مع تلميح «يُنشأ تلقائياً»؛ لا يمكن الكتابة فيه.

#### التقسيم البصري للنموذج

##### ITMF-012 — النموذج مقسّم إلى بطاقات معنونة
- **Steps:** افتح «إضافة صنف» لصنف من نوع «منتج مخزون».
- **Assert:** تظهر البطاقات: «الهوية والتصنيف»، «التصنيف والمصدر»، «وحدات القياس»، «الباركود»، «التسعير والضريبة»، «سياسة المخزون»، «الحسابات المحاسبية»، «الفاتورة الإلكترونية» — لا عمود واحد طويل من الحقول بلا عناوين.

##### ITMF-013 — عرض النموذج محدود ومتوسّط
- **Assert:** المحتوى لا يمتد على كامل عرض شاشة عريضة ولا يلتصق بحافة واحدة؛ الترويسة والحقول على المحور نفسه.

##### ITMF-014 — «سياسة المخزون» تختفي لصنف خدمي
- **Steps:** في «إضافة صنف» غيّر «نوع الصنف» إلى «خدمة».
- **Assert:** تختفي بطاقة «سياسة المخزون» بالكامل؛ تتغيّر الوحدة الأساسية من PCS إلى SVC.

##### ITMF-015 — بطاقة «الحالة» في التعديل فقط
- **Assert:** «الحالة» تظهر في `/items/items/IT-0001` ولا تظهر في `/items/items/new`.

#### الحفظ

##### ITMF-016 — إنشاء صنف من الصفحة
- **Steps:** في `/items/items/new` اكتب «اسم الصنف»، اضغط «إضافة».
- **Assert:** تعود قائمة الأصناف؛ الصنف الجديد ظاهر بالبحث عن اسمه؛ العنوان `/items/items`.

##### ITMF-017 — تعديل يُحفظ ويبقى بعد إعادة التحميل
- **Steps:** في `/items/items/IT-0001` غيّر «الاسم بالإنجليزية»، اضغط «حفظ»، ثم أعد فتح العنوان نفسه.
- **Assert:** القيمة الجديدة موجودة — الحفظ وصل للخادم فعلاً وليس للواجهة فقط.

##### ITMF-018 — الكود لا يتغيّر بالتعديل
- **Assert:** بعد الحفظ، الكود في القائمة وفي العنوان كما كان — العنوان الذي يقف عليه المستخدم لا ينكسر تحته.
- **Guards:** `itemFormRoundTrip` في `scripts/scenarios/items-forms.ts`.

##### ITMF-019 — خطأ التحقق يبقي الصفحة مفتوحة
- **Steps:** اضغط «إضافة» دون اسم.
- **Assert:** رسالة خطأ أعلى النموذج (`role="alert"`)؛ الصفحة لا تُغادَر ولا يضيع ما كُتب.

##### ITMF-020 — باركود مكرر مرفوض
- **Steps:** أضف باركودين متطابقين، اضغط «إضافة».
- **Assert:** خطأ يذكر التكرار؛ الصفحة تبقى.

#### المواصفات

##### SPCF-001 — «مواصفة جديدة» صفحة بعنوان
- **Assert:** `/items/item-specifications/new`؛ بطاقتا «تعريف المواصفة» و«السلوك».

##### SPCF-002 — «تعديل» يفتح العنوان بالكود
- **Steps:** اضغط «تعديل» في صف «الحجم».
- **Assert:** `/items/item-specifications/SIZE`؛ النموذج ممتلئ؛ «الكود» و«النوع» معطّلان.

##### SPCF-003 — الرابط المباشر يملأ النموذج
- **Steps:** افتح `/items/item-specifications/SIZE` مباشرة.
- **Assert:** «الحجم» و«صغير، وسط، كبير» ظاهرة — النموذج يُبذَر من السجل الذي يسمّيه العنوان عند التركيب، لا من نقرة سابقة.

##### SPCF-004 — الحفظ يبقى بعد إعادة التحميل
- **Steps:** غيّر «الاسم بالإنجليزية»، احفظ، أعد فتح العنوان.
- **Assert:** القيمة الجديدة موجودة؛ الكود والنوع لم يتغيّرا.
- **Guards:** `specificationFormRoundTrip` في `scripts/scenarios/items-forms.ts`.

##### SPCF-005 — كود غير موجود
- **Steps:** افتح `/items/item-specifications/NOPE`.
- **Assert:** «لم يتم العثور على هذه المواصفة.» مع «العودة إلى المواصفات».

##### SPCF-006 — «القيم المسموح بها» تتبع النوع
- **Steps:** في «مواصفة جديدة» بدّل «النوع» بين «قائمة اختيار» و«رقم» و«نص».
- **Assert:** حقل القيم يظهر لـ «قائمة اختيار» فقط؛ حقل «الوحدة» لـ «رقم» فقط.

#### قوالب المنتجات

##### TPLF-001 — «قالب جديد» صفحة بعنوان
- **Assert:** `/items/product-templates/new`؛ بطاقة «بيانات القالب».

##### TPLF-002 — صف القالب يفتح صفحة بالكود
- **Steps:** اضغط صف «شاي ميزان المعبأ».
- **Assert:** `/items/product-templates/TPL-TEA` — الكود لا الـ uuid؛ فتات الخبز تعرض `TPL-TEA` وليس معرّفاً طويلاً.

##### TPLF-003 — إنشاء قالب ينتقل إلى صفحته
- **Steps:** أنشئ قالباً جديداً.
- **Assert:** ينتقل مباشرة إلى `/items/product-templates/<الكود الجديد>` حيث تُضاف الخصائص.

##### TPLF-004 — الخصائص والمتغيرات على الصفحة نفسها
- **Assert:** إضافة خاصية، إضافة قيمة، وجدول توليد المتغيرات كلها ظاهرة دون درج جانبي؛ «رجوع» يعيد للقائمة.

#### قوائم المواد والمنتجات القابلة للتهيئة

##### BOMF-001 — «قائمة مواد جديدة» صفحة بعنوان
- **Assert:** `/items/boms/new`؛ البطاقات «الصنف المجمّع»، «التكاليف الإضافية»، «بنود المكونات»؛ «حفظ قائمة المواد» معطّل حتى يُختار منتج وبند واحد على الأقل.

##### BOMF-002 — البنود مربوطة بأصناف حقيقية
- **Steps:** اختر الصنف المجمّع ثم صنفاً في أول بند واحفظ.
- **Assert:** البند محفوظ بمعرّف الصنف الحقيقي — لا نص حر.
- **Guards:** `bomFormRoundTrip` في `scripts/scenarios/items-forms.ts`.

##### CFGF-001 — «منتج قابل للتهيئة جديد» صفحة بعنوان
- **Assert:** `/items/configurable-products/new`؛ البطاقات «هوية المنتج»، «مدخلات التهيئة»، «خامات التصنيع»، «التسعير».

##### CFGF-002 — معادلة السعر تُحفظ
- **Steps:** اختر «التسعير: معادلة»، اكتب معادلة، احفظ.
- **Assert:** المعادلة موجودة بعد الحفظ — مخطط zod يسقط المفاتيح غير المعروفة بصمت، فحقل يرسله العميل ولا يحمله العقد يختفي خلف 201 مبتهجة.
- **Guards:** `configurableFormRoundTrip` في `scripts/scenarios/items-forms.ts`.

#### اللغة والاتجاه

##### ITMF-021 — تشغيل بالإنجليزية / LTR
- **Steps:** بدّل اللغة من الشريط العلوي وأعد فتح `/items/items/new`.
- **Assert:** كل عناوين البطاقات بالإنجليزية؛ الترويسة والأزرار تنعكس إلى اليسار؛ لا يظهر مفتاح ترجمة خام (`items.section.…`).

##### ITMF-022 — لوحة المفاتيح وحدها
- **Steps:** من القائمة، انتقل بـ Tab إلى «إضافة صنف» واضغط Enter، ثم تنقّل بين الحقول بـ Tab حتى «إضافة».
- **Assert:** الترتيب يتبع البطاقات من أعلى لأسفل؛ حلقة التركيز ظاهرة على كل حقل؛ Enter داخل حقل نصي يرسل النموذج مرة واحدة فقط.

### Appendix — consolidated `[NOT IMPLEMENTED]` gaps vs. the reference catalog

Grouped by screen, for a tester who wants the punch list without re-reading every
scenario:

- **Items**: item type limited to `stock`/`service` only (catalog: 6 types); no item-categories dialog; no "hide variants" / price-range filters; no season/image/POS-visibility/kitchen-waste fields; no cost-layers or stock-by-warehouse tab (both are literal "Phase 2" placeholders); no attachments/log tabs; no "more" menu (print labels / opening balance / deactivate / delete shortcuts); no client-side negative-number guard on sale/cost price.
- **Item Specifications**: not in the catalog at all — build-only.
- **Product Templates**: no search box; no variant-count list column; no client-side guard on deleting an in-use attribute/value (server-error-only); no alternate-units UI; base unit is free text, not a dropdown; no numeric guard on default price/cost.
- **Configurable Products**: no row kebab menu, no per-row "new custom order" shortcut, no edit action on an existing product (create + deactivate only).
- **Stock Balance**: no filter chips, no filters panel, no row-click navigation.
- **Stock Transfers**: create always auto-confirms (no draft stage reachable through the UI); a pre-existing draft (like the seeded `TRF-DEMO-3`) has no confirm button anywhere; no Excel import; only a "lines" detail tab (no attachments/audit).
- **Stock Adjustments**: same auto-confirm pattern as Transfers; only 2 detail tabs (no attachments/audit); no before/after quantity columns; no opening-balance shortcut from Items.
- **Physical Counts**: pausing a session ("حفظ ومتابعة لاحقاً") does not persist entered counts to the server; no warehouse/date-range filters.
- **Label Printing**: no item/document mode toggle (item mode only).
- **Inventory Write-downs**: not in the catalog at all — build-only; line table shows raw item ids, not names.
- **Work Orders**: no filters panel; no kebab menu (so no duplicate/cancel action); only 2 detail tabs (materials, costs) — no way to see the GL entries a work order posted; the detail page's own effects copy claims GL 1200 posts on completion, which is false (D3); silent error on start/issue/complete outside the receive panel; no distinct-warehouse check.
- **BOMs**: no "new work order" or "new version" shortcut from a BOM's own detail page; only 1 detail tab; deactivate has no confirmation; waste % has no upper bound.
- **Custom Manufacturing**: spec inputs are unvalidated free text; save is allowed even when the cost/material preview is erroring; linked work order id is inert text, not a link; close/cancel have no confirmation dialogs; no distinct-warehouse check.
- **Production Dashboard**: bucket cards are not clickable; the "next action" button on the active-orders table only navigates to the Work Orders list, it never executes the step; inconsistent action labels between this screen ("إنهاء الأمر") and the Work Order detail page ("إكمال أمر العمل"); no average-cost-per-unit KPI tile.

FEFO note: this build has **no UI surface anywhere** in these 14 screens for viewing or
selecting a batch/cost-layer (no cost-layers tab on Items, no batch column on Label
Printing, no batch selector on Adjustments/Transfers/Physical Counts). Every batch-
tracked item in the seed (`ITEM-DEMO-7`/`ITEM-DEMO-8`) is costed WAC, so even a correct
FEFO consumption order produces an identical unit cost to FIFO — nothing in the UI would
visibly differ either way. The seed does plant a real FEFO test fixture at the data
layer (milk batch `MLK-2708`, received second on 2026-08-21, expires 2026-09-05 —
*before* `MLK-2607`, received first, which expires 2026-10-20), but proving which batch
a movement actually drew from requires reading the domain/API layer directly, not this
build's UI. Scenario **`[NOT IMPLEMENTED]`**.

---

# 8. Accounting and treasury


Exhaustive scenarios for every screen in the "المحاسبة" and "الخزينة" nav groups, plus
"سجل الشيكات" (financial-papers) and the financial-statement reports embedded in
Accounting (`FinancialReportsScreen`'s seven tabs and the standalone `TrialBalanceReportScreen`).
POS, and every non-financial report under the sidebar's "التقارير" group, are out of
scope for this file.

**Sources**: `docs/archive/catalog/04-accounting-treasury.md`, `docs/archive/catalog/08-reports.md` (reference
product, captured live) cross-read against the actual implementation in
`apps/web/src/screens/{ChartOfAccounts,CostCenters,CostCenterPnL,Journals,FiscalPeriods,
Taxes,ExchangeRates,FxRevaluation,Reconciliation,Eta,TrialBalanceReport,FinancialReports,
TreasuryAccounts,TreasuryVouchers,BankReconciliation,Cheques}Screen.tsx`,
`apps/web/src/screens/hubs/{Accounting,Treasury}HubScreen.tsx`, `apps/web/src/nav-config.ts`,
and the domain/report engine in `packages/domain/src/{reports,gl,fiscal-periods,vouchers,
cheques,reconciliation,accounts}`.

**Data**: the demo seed gives a full chart of accounts (root codes 1000/2000/3000/4000/5000;
e.g. 1105 ذمم عملاء تجارية, 1200 المخزون, 1300‑1 صندوق نقدي الفرع الرئيسي, 1310 حسابات بنكية,
1320 شيكات تحت التحصيل, 1360 شيكات مرتجعة, 1400 ضريبة مدخلات, 2100 ذمم دائنة, 2150 شيكات صادرة,
2200 ضريبة مخرجات), 2 cost centres (CC-DEMO-1/2, both currently unassigned to any
transaction), 12 fiscal periods (one calendar year, all "مفتوحة"), 12 treasury vouchers,
5 cheques (CHQ‑DEMO‑1 pending‑incoming, ‑2 collected‑incoming, ‑3 **bounced**‑incoming,
‑4 collected‑outgoing, ‑5 pending‑outgoing), 5 exchange rates over 3 dates (USD ×3, EUR ×2;
the two EUR rates and the latest USD rate are unapproved/"pending"), 2 treasury accounts
(one cash, one bank), and 43 posted journal entries.

**Known defects — reference, do not re-file** (`ROADMAP.md` §5): **D1** a confirmed
collection voucher credits AR in the GL but never updates the invoice's `amountPaid`, so
مطابقة الأرصدة shows a permanent AR mismatch; inventory and AP reconcile exactly. **D5** the
ETA submission queue has no producer — no user action enqueues a document, so the queue is
empty regardless of how many documents are confirmed elsewhere in the app.

**ID scheme**: `ACC-001` upward, sequential across the whole file, grouped by screen.

---

### المحاسبة — Accounting Hub (`nav: accounting ▸ نظرة عامة`)

- **ACC-001** — **Pre**: logged in, land on the app. **Steps**: افتح الشريط الجانبي ← «المحاسبة» ← «نظرة عامة». **Assert**: تظهر لافتة حالة الفترة المالية الحالية (مثلاً "الفترة المالية مفتوحة — يمكن الترحيل")، وصف الصفحة "إدارة القيود والتقارير والفترات المالية".
- **ACC-002** — **Pre**: على «نظرة عامة» المحاسبة. **Steps**: لاحظ شبكة "مناطق العمل": القيود المحاسبية، التقارير المالية، مطابقة الأرصدة، دليل الحسابات، الفترات المالية، الضرائب، أسعار الصرف، إعادة تقييم العملات الأجنبية. **Assert**: بلاطة القيود المحاسبية تعرض عدداً إجمالياً حقيقياً (43 أو أكثر)؛ بلاطة الفترات المالية تعرض "12 مفتوحة" (أو ما يطابق حالة الفترات الفعلية).
- **ACC-003** — **Steps**: اضغط زر البدء السريع "قيد يومية جديد". **Assert**: ينتقل إلى شاشة إنشاء قيد يومي (`/accounting/journals/new` المكافئة) فارغة، وليس نموذجاً مبسطاً منفصلاً.
- **ACC-004** — **Steps**: مرر إلى قسم "النشاط الأخير" ← "آخر القيود المرحلة". **Assert**: تظهر حتى 5 قيود، كل صف يعرض الوصف، رقم القيد + التاريخ، ووسم حالة "مرحل"؛ النقر على قيد ينقل إلى تفاصيله في شاشة القيود.
- **ACC-005** — **Steps**: اضغط "عرض" على بلاطة "دليل الحسابات". **Assert**: ينتقل فعلياً إلى شاشة دليل الحسابات (وليس رابطاً معطلاً) — تحقق أن هذا يصح لكل بلاطة في الشبكة (8 روابط).

---

### دليل الحسابات — Chart of Accounts

- **ACC-006** — **Pre**: افتح «المحاسبة» ← «دليل الحسابات». **Assert**: تظهر بطاقات إحصائية إجمالي الحسابات/حسابات نشطة/حسابات رئيسية/حسابات تفصيلية بأعداد حقيقية (مجموع الرئيسية + التفصيلية = الإجمالي).
- **ACC-007** — **Steps**: لاحظ الشجرة الافتراضية. **Assert**: كل الحسابات الرئيسية (isHeader) تبدأ موسّعة تلقائياً عند أول تحميل، وكل الحسابات التفصيلية تظهر كأوراق تحت رئيسها الصحيح (1105 تحت 1100 تحت 1000).
- **ACC-008** — **Steps**: اضغط زر "طي الكل". **Assert**: تنطوي كل الحسابات الرئيسية دفعة واحدة والزر يتحول إلى "توسيع الكل"؛ اضغطه مجدداً فتعود الشجرة للتوسع الكامل.
- **ACC-009** — **Steps**: اضغط سهم التوسّع لحساب رئيسي واحد فقط (1300 النقدية). **Assert**: هذا الفرع فقط ينطوي/يتوسع؛ باقي الشجرة لا تتأثر؛ الزر العلوي "طي/توسيع الكل" لا يتغير طالما لم تُطوَ كل الحسابات الرئيسية.
- **ACC-010** — **Steps**: اكتب "نقدي" في مربع البحث "بحث بالاسم أو الرقم...". **Assert**: تتحول العرض من شجرة إلى قائمة مسطّحة (بلا مسافة بادئة) لكل الحسابات المطابقة بالاسم العربي أو الإنجليزي أو الكود، مرتبة حسب الكود.
- **ACC-011** — **Steps**: اكتب "1300-1" (الكود بالضبط). **Assert**: يظهر صف واحد "صندوق نقدي الفرع الرئيسي".
- **ACC-012** — **Steps**: امسح البحث، اختر "النوع" = أصول من قائمة التصفية. **Assert**: تتحول العرض لقائمة مسطحة تعرض فقط حسابات النوع أصول (لا التزامات ولا إيرادات).
- **ACC-013** — **Steps**: اختر "الحالة" = غير نشط. **Assert**: القائمة فارغة أو تعرض فقط الحسابات غير النشطة إن وُجدت؛ رسالة الحالة الفارغة "لا توجد حسابات مطابقة" تظهر إذا لا يوجد شيء.
- **ACC-014** — **Steps**: امسح كل الفلاتر. **Assert**: تعود الشجرة الهرمية الافتراضية (وليست قائمة مسطحة).
- **ACC-015** — **Steps**: لاحظ سطر العدّاد أسفل الشجرة "عرض N من M حساب". **Assert**: N يساوي عدد الصفوف المرئية فعلياً في الشجرة (يزيد بتوسيع فرع ويقل بطيّه)، وM يساوي الإجمالي الثابت من بطاقة "إجمالي الحسابات".
- **ACC-016** — **Steps**: اضغط "إضافة حساب". **Assert**: تُفتح لوحة جانبية بعنوان "إضافة حساب" بحقول: النوع* (افتراضي أصول)، الكود* (placeholder "1xxx")، الاسم*، الاسم بالإنجليزي، الحساب الرئيسي (EntityPicker، افتراضي "بدون رئيسي (جذر)")، الرصيد الطبيعي* (مدين/دائن، افتراضي مدين)، مفتاح "حساب رئيسي (غير قابل للترحيل عليه)". **Assert إضافي [مغاير للمرجع]**: لا يوجد حقل "التصنيف الفرعي" ولا حقل "الاسم بالعربي" منفصل كما في المرجع — الحقل الوحيد الاختياري هو "الاسم بالإنجليزي".
- **ACC-017** — **Steps**: اضغط "إضافة" بدون تعبئة أي حقل. **Assert**: متصفح HTML5 يمنع الإرسال (الحقول `required`: النوع، الكود، الاسم)؛ لا خطأ خادم.
- **ACC-018** — **Steps**: أدخل كوداً مطابقاً لكود موجود بالفعل (مثلاً 1105) واسماً، اضغط "إضافة". **Assert**: رسالة خطأ محلية فورية (بدون استدعاء خادم): `الكود "1105" مستخدم بالفعل — اختر كوداً آخر.`
- **ACC-019** — **Steps**: أنشئ حساباً جديداً بكود فريد "1970"، اسم "حساب اختبار"، بدون رئيسي. **Assert**: يُغلق النموذج، الحساب الجديد يظهر في الشجرة كجذر مستقل جديد، وبطاقة "إجمالي الحسابات" تزداد بمقدار 1.
- **ACC-020** — **Steps**: عدّل نفس الحساب، اختر حساباً رئيسياً = نفسه من قائمة "الحساب الرئيسي" (إن كان ممكناً اختياره). **Assert**: رسالة `لا يمكن اختيار هذا الحساب كحساب رئيسي له (تسلسل دائري).` — ولاحظ أن قائمة الحسابات الرئيسية المتاحة أصلاً تستثني الحساب نفسه من الخيارات (EntityPicker لا يعرضه).
- **ACC-021** — **Steps**: عدّل حساباً رئيسياً له أبناء (مثلاً 1300 النقدية)، أطفئ مفتاح "حساب رئيسي". **Assert**: `هذا الحساب الرئيسي يحتوي على حسابات فرعية، لا يمكن تحويله إلى حساب تفصيلي.`
- **ACC-022** — **Steps**: افتح تعديل حساب تفصيلي وارد الوضع إلى "غير نشط"، احفظ. **Assert**: وسم الحالة في الشجرة يتحول إلى "غير نشط" (لون محايد)، وبطاقة "حسابات نشطة" تنقص بمقدار 1.
- **ACC-023** — **Steps**: انقر على أي صف حساب في الشجرة (ليس زر التعديل). **Assert**: تُفتح لوحة جانبية بعنوان "{الكود} — {الاسم}" مع وسم الحالة، وسم "رئيسي/تفصيلي"، بطاقة الرصيد الطبيعي + الحساب الرئيسي، وبطاقة أرصدة (رصيد أول المدة/حركة الفترة/رصيد نهاية المدة).
- **ACC-024** — **Steps**: لاحظ بطاقة الأرصدة في اللوحة الجانبية. **Assert `[NOT IMPLEMENTED]`**: الأرصدة الثلاثة تعرض 0.00 ج.م دائماً بصرف النظر عن الحساب المختار — لا توجد حركات فعلية محسوبة من القيود المرحّلة (المرجع يصف رصيداً حياً وحركة فترة حقيقية). لا يوجد فلتر فترة سريع (هذا الشهر/هذه السنة/كل الفترات) ولا نطاق تاريخ مخصص كما في المرجع.
- **ACC-025** — **Steps**: بدّل إلى تبويب "حركات الحساب" ثم "سجل التدقيق" داخل اللوحة الجانبية. **Assert `[NOT IMPLEMENTED]`**: كلا التبويبين يعرض نص عنصر نائب ثابت ("ستُعرض حركات الحساب هنا فور ربط القيود المحاسبية بدفتر الأستاذ (المرحلة الثانية)." / "سجل التدقيق يعرض كل تعديل على الحساب بالتاريخ والمستخدم.") — لا جدول حركات، لا رقم قيد قابل للنقر، لا مصدر مستند، لا رصيد جارٍ، رغم أن كل حساب فعلياً له قيود مرحّلة (43 قيداً في المستأجر التجريبي).
- **ACC-026** — **Steps**: من اللوحة الجانبية اضغط "تعديل". **Assert**: يُفتح نموذج التعديل بنفس بيانات الحساب المختار مُعبّأة مسبقاً، وحقل الحالة إضافي يظهر فقط في وضع التعديل.
- **ACC-027** — **Steps**: ابحث عن زر "فتح في صفحة كاملة" أو قائمة كباب (⋮) على أي صف. **Assert `[NOT IMPLEMENTED]`**: لا يوجد — الإجراء الوحيد لكل صف هو زر تعديل واحد (أيقونة قلم)، ولا صفحة كاملة منفصلة `/accounting/accounts/{id}` كما يصفها المرجع.
- **ACC-028** — **Assert**: لافتة "دليل أرقام الحسابات" أسفل الشجرة ثابتة (1xxx أصول · 2xxx التزامات · 3xxx حقوق ملكية · 4xxx إيرادات · 5xxx مصروفات).
- **ACC-029** — **Pre**: أوقف الشبكة أو تسبب بخطأ خادم. **Steps**: أعد تحميل الشاشة. **Assert**: بطاقة خطأ "تعذّر تحميل دليل الحسابات." مع زر "إعادة المحاولة" يعيد الاستعلام عند الضغط.

---

### مراكز التكلفة — Cost Centers

- **ACC-030** — **Pre**: افتح «المحاسبة» ← «مراكز التكلفة». **Assert**: بطاقات إحصائية إجمالي مراكز التكلفة (2)، نشط، مرتبط، مستقل — القيم تعكس أن CC-DEMO-1 وCC-DEMO-2 كلاهما ظاهر وأياً منهما غير مرتبط بقسم/فرع فتُحسب ضمن "مستقل".
- **ACC-031** — **Steps**: لاحظ الشجرة. **Assert**: تظهر مراكز التكلفة الاثنان (وليس شاشة فارغة كما في بيانات المرجع)، وكل الأشجار تبدأ موسّعة عند أول تحميل.
- **ACC-032** — **Steps**: اضغط "توسيع الكل"/"طي الكل". **Assert**: نفس سلوك دليل الحسابات (ACC-008).
- **ACC-033** — **Steps**: ابحث عن "إنشاء من الأقسام" في رأس الصفحة. **Assert `[NOT IMPLEMENTED]`**: الزر غير موجود؛ الإجراءات المتاحة فقط "توسيع/طي الكل" و"إضافة مركز تكلفة" — لا توجد وسيلة لتوليد مراكز تكلفة تلقائياً من أقسام HR كما يصفها المرجع.
- **ACC-034** — **Steps**: اكتب في مربع البحث "ابحث بالكود أو الاسم…" جزءاً من اسم مركز موجود. **Assert**: القائمة تتحول لعرض مسطح مطابق (بحث بالاسم العربي أو الكود، غير حساس لحالة الأحرف).
- **ACC-035** — **Steps**: اختر فلتر "النوع" بقيمة لا تطابق أي مركز موجود. **Assert**: تظهر رسالة الحالة الفارغة "لا توجد مراكز تكلفة بعد" مع نص توضيحي وزر CTA "إضافة مركز تكلفة" داخل الجدول (حتى لو كانت البيانات موجودة لكن الفلتر استبعدها جميعاً — تحقق أن هذه رسالة الفراغ العامة وليست خاصة بعدم وجود بيانات إطلاقاً).
- **ACC-036** — **Steps**: اضغط "إضافة مركز تكلفة". **Assert**: نموذج بحقول الكود* (placeholder "CC-005")، الاسم*، الاسم بالعربي، النوع (قائمة من `COST_CENTER_TYPE_DEFINITIONS`، افتراضي "عام")، المركز الرئيسي (EntityPicker، افتراضي "بدون مركز رئيسي")، ملاحظات. **Assert `[NOT IMPLEMENTED]`**: لا يوجد حقل "القسم" ولا حقل "الفرع" في نموذج الإنشاء رغم أن المرجع يصفهما كحقلين قابلين للربط، ورغم أن كيان مركز التكلفة نفسه يحمل `branchId` (يظهر للقراءة فقط في اللوحة الجانبية) — أي أن الربط بفرع/قسم غير قابل للتعيين من الواجهة عند الإنشاء أو التعديل.
- **ACC-037** — **Steps**: أنشئ مركزاً بكود مكرر لـCC-DEMO-1. **Assert**: `الكود "..." مستخدم بالفعل — اختر كوداً آخر.`
- **ACC-038** — **Steps**: أنشئ مركزاً بدون اسم عربي (فارغ). **Assert**: `الاسم مطلوب.`
- **ACC-039** — **Steps**: أنشئ مركزاً فرعياً واختر المركز الرئيسي = CC-DEMO-1. **Assert**: يُحفظ، ويظهر متداخلاً تحت CC-DEMO-1 في الشجرة؛ بطاقة "مرتبط" في الملخص العلوي لا تتغير (الربط بمركز أب لا يُحتسب "مرتبط" — ذلك محجوز للربط بقسم/فرع فقط، حسب `isLinked`).
- **ACC-040** — **Steps**: حاول تعيين المركز الفرعي الجديد كرئيسي لِـCC-DEMO-1 (تسلسل دائري عكسي). **Assert**: `لا يمكن اختيار هذا المركز كمركز رئيسي له (تسلسل دائري).`
- **ACC-041** — **Steps**: افتح مركزاً له أبناء من اللوحة الجانبية. **Assert**: قسم "المراكز الفرعية (N)" يسرد كل الأبناء كأزرار قابلة للنقر تنقل مباشرة إلى تفاصيل الابن.
- **ACC-042** — **Steps**: افتح تعديل مركز، بدّل الحالة إلى "غير نشط"، احفظ. **Assert**: الوسم في الشجرة يتحول والبطاقة "نشط" تنقص بمقدار 1.
- **ACC-043** — **Steps**: من اللوحة الجانبية اضغط تعديل ثم إلغاء بدون حفظ. **Assert**: التغييرات لا تُحفظ، البيانات في القائمة تبقى كما كانت.

---

### أرباح مراكز التكلفة — Cost Center P&L

- **ACC-044** — **Pre**: افتح «المحاسبة» ← «أرباح مراكز التكلفة». **Assert**: نطاق تاريخ افتراضي (من 2026-08-01 إلى 2026-08-31 أو الشهر الجاري)، وبطاقات إجمالي الإيرادات/إجمالي المصروفات/صافي الربح تُحسب من نفس محرك `computeCostCenterPnL` في الخادم (لا بيانات وهمية).
- **ACC-045** — **Steps**: لاحظ الجدول. **Assert**: بما أن لا حركة مالية في هذا المستأجر تحمل بُعد مركز تكلفة (CC-DEMO-1/2 غير مستخدمين في أي قيد)، يظهر صف واحد فقط "غير مخصص لمركز تكلفة" (أو رسالة فراغ "لا توجد حركات في هذه الفترة" إن كان الصف غير المخصص لا يُبنى إلا عند وجود حركة).
- **ACC-046** — **Steps**: غيّر "من"/"إلى" إلى نطاق خارج أي نشاط (مثلاً 2020). **Assert**: البطاقات تُظهر 0.00 والجدول فارغ برسالة "لا توجد حركات في هذه الفترة" — بدون خطأ.
- **ACC-047** — **Steps**: اجعل "من" بعد "إلى" (نطاق معكوس). **Assert**: لا يوجد تحقق عميل صريح لهذا الحقل (input بسيط من نوع date) — تحقق ما يعيده الخادم (رسالة خطأ أو نتيجة فارغة) بدل شاشة بيضاء.
- **ACC-048** — **Steps**: صافي الربح سالب افتراضياً (تحقق حسابياً). **Assert**: عندما `profit < 0` يظهر الرقم بلون الخطر (`text-danger-ink`) في كل من البطاقة وصف الجدول؛ عكسه (`text-success-ink`) عند القيم الموجبة.
- **ACC-049** — **Assert `[NOT IMPLEMENTED]`**: لا يوجد فلتر "مركز التكلفة" (مربع بحث حر) يصفه المرجع لتضييق التقرير على مركز واحد — الفلتر الوحيد المتاح هو نطاق التاريخ.
- **ACC-050** — **Assert `[NOT IMPLEMENTED]`**: لا يوجد زر تصدير على هذه الشاشة، ولا لافتة تحذير "تكاليف العمالة والأعباء المرسملة في تحت التشغيل لا تظهر هنا وقت تسجيلها" التي يصفها المرجع.

---

### القيود المحاسبية — Journal Entries

- **ACC-051** — **Pre**: افتح «المحاسبة» ← «القيود المحاسبية». **Assert**: بطاقات إحصائية إجمالي القيود (43+)، مرحل، معكوس، مسودة — كل القيود في المستأجر التجريبي "مرحل" (معكوس/مسودة = 0).
- **ACC-052** — **Steps**: تبويبات الحالة "الكل/مسودة/مرحل/معكوس". **Assert**: العدّاد المرافق لكل تبويب يطابق العدد الفعلي؛ اختيار "مرحل" يُبقي الـ43 قيداً ظاهرة، واختيار "مسودة" يفرّغ الجدول برسالة "لا توجد قيود مطابقة".
- **ACC-053** — **Steps**: اكتب في "بحث برقم القيد..." رقم قيد معروف جزئياً (مثلاً "JE-0004"). **Assert**: تُصفّى النتائج بمطابقة رقم القيد أو البيان (case-insensitive).
- **ACC-054** — **Assert `[NOT IMPLEMENTED]`**: لا يوجد زر "تصفية النتائج" بنطاق تاريخ ولا فلتر "الوحدة المصدر" كما في المرجع — التصفية محدودة بحالة + بحث نصي فقط.
- **ACC-055** — **Assert `[NOT IMPLEMENTED]`**: لا يوجد زر "طباعة القيود" في رأس الصفحة؛ الإجراء الوحيد هو "قيد جديد".
- **ACC-056** — **Assert `[NOT IMPLEMENTED]`**: عمود "الوحدة المصدر" غير موجود في جدول القائمة (فقط: رقم القيد، التاريخ، البيان، إجمالي المدين، الحالة) — لا وسيلة من القائمة لمعرفة أن قيداً معيّناً وُلّد من فاتورة مبيعات مقابل سند خزينة. كذلك لا عمود "بواسطة".
- **ACC-057** — **Pre**: افتح تفاصيل أي قيد مرحّل (النقر على الصف). **Assert**: حقل "المصدر" في ملخص التفاصيل يعرض دائماً النص الثابت **"يدوي"** — حتى للقيود المولّدة تلقائياً من سندات/فواتير — `[NOT IMPLEMENTED]` مقارنة بالمرجع الذي يصف رابطاً حياً لمستند المصدر (مثل "سند نقدي · CV-000009").
- **ACC-058** — **Steps**: لاحظ شريط الحالة (Stepper) أعلى تفاصيل القيد. **Assert**: يعرض أربع خطوات (مسودة/بانتظار الموافقة/مرحل/معكوس) مع تمييز الخطوة الحالية.
- **ACC-059** — **Steps**: لاحظ جدول "بنود القيد". **Assert**: كل سطر يعرض اسم الحساب (كود — اسم)، البيان، مدين، دائن؛ صف التذييل يكرر شارة "متوازن ✓" وإجمالي المدين/الدائن، ويطابقان بالضبط (فرق = 0.00).
- **ACC-060** — **Assert `[NOT IMPLEMENTED]`**: لا يوجد تبويب "المرفقات" ولا "سجل المراجعة" في تفاصيل القيد — تبويب واحد فقط "بنود القيد".
- **ACC-061** — **Pre**: على تفاصيل قيد **مرحّل**. **Steps**: اضغط "عكس القيد". **Assert**: يُنشأ قيد عكسي جديد فوراً (مرآة معكوسة الأرقام على نفس الحسابات)، القيد الأصلي يتحول لحالة "معكوس" ويبقى في السجل دون حذف أو تعديل لبنوده الأصلية (سلوك غير قابل للتفاوض)، وتعود القائمة إلى وضع "list".
- **ACC-062** — **Steps**: افتح القيد الأصلي (الآن "معكوس") مجدداً. **Assert**: لا يظهر زر "عكس القيد" ثانية (الزر مشروط بـ`status === "posted"` فقط)، ما يمنع عكس نفس القيد مرتين.
- **ACC-063** — **Steps**: افتح القيد العكسي الجديد نفسه. **Assert**: حالته "مرحل" ومبالغه المدين/الدائن معكوسة بالضبط عن القيد الأصلي؛ إجمالياته لا تزال متوازنة.
- **ACC-064** — **Pre**: على القائمة. **Steps**: اضغط "قيد جديد". **Assert**: ينتقل لصفحة إنشاء كاملة (وليس لوحة جانبية) بعنوان "إنشاء قيد يومي"، مع حقلي "تاريخ القيد*" و"الوصف*" وجدول بسطرين افتراضيين.
- **ACC-065** — **Assert `[NOT IMPLEMENTED]`**: حقل "تاريخ القيد" هو صندوق نص عادي (placeholder "YYYY-MM-DD") وليس منتقي تاريخ (`<input type="date">`) كما يصفه المرجع — لا تحقق تنسيق من جهة العميل؛ إدخال نص غير صالح (مثل "غداً") يمرّ محلياً ويُرفض فقط من الخادم عند الترحيل. **Assert إضافي**: لا يوجد حقل عملة/currency على نموذج الإنشاء رغم أن المرجع يصف قائمة عملة افتراضية "EGP (العملة الأساسية)" — القيد يُنشأ دوماً بعملة النظام الأساسية ضمنياً.
- **ACC-066** — **Steps**: حاول حذف سطر عندما لا يوجد سوى سطرين. **Assert**: زر الحذف (✕) معطّل لكلا السطرين — لا يمكن النزول عن سطرين، مطابقاً لقاعدة "قيد غير متوازن لا يمكن ترحيله" التي تبدأ بالحد الأدنى البنيوي.
- **ACC-067** — **Steps**: اضغط "إضافة سطر" ثلاث مرات. **Assert**: يُضاف سطر جديد فارغ في كل مرة، وزر الحذف يصبح فعّالاً على كل الأسطر بمجرد تجاوز سطرين.
- **ACC-068** — **Steps**: في السطر الأول اختر حساباً وأدخل مديناً 100، في السطر الثاني اختر حساباً آخر وأدخل دائناً 100، اترك "الوصف" فارغاً. **Assert**: زر "ترحيل القيد" يبقى معطّلاً (البيان مطلوب) رغم توازن المبالغ؛ بطاقة "التوازن" الجانبية تعرض "متوازن ✓" مع ذلك (التحقق من التوازن مستقل عن حقل الوصف).
- **ACC-069** — **Steps**: أدخل مديناً 100 في سطر ودائناً 150 في آخر، عبّئ الوصف. **Assert**: بطاقة "التوازن" تعرض الفرق = 50.00 ج.م بلون الخطر، وشارة "غير متوازن"؛ زر "ترحيل القيد" معطّل؛ لافتة "تأثيرات هذا المستند" تضيف بنداً تحذيرياً أحمر "القيد غير متوازن — زر الترحيل معطّل حتى يتساوى المدين والدائن".
- **ACC-070** — **Steps**: أدخل في نفس السطر كلاً من مدين ودائن (اكتب في مدين ثم في دائن لنفس الصف). **Assert**: كتابة قيمة في أحد الحقلين تصفّر الحقل الآخر تلقائياً لنفس السطر (`onChange` يصفّر الطرف الآخر) — لا يمكن لسطر واحد أن يحمل مديناً ودائناً معاً من الواجهة.
- **ACC-071** — **Steps**: اترك حقل "الحساب" فارغاً في أحد السطور مع مبلغ صحيح. **Assert**: `allLinesValid` يفشل، زر "ترحيل القيد" يبقى معطّلاً حتى يُختار حساب لكل سطر يحمل مبلغاً.
- **ACC-072** — **Steps**: أنشئ قيداً متوازناً صحيحاً (مثال: مدين 500 على 1300‑1، دائن 500 على 4900) بتاريخ داخل شهر مفتوح، اضغط "ترحيل القيد". **Assert**: يُنشأ القيد فوراً بحالة "مرحل" (لا وجود لحفظ كمسودة على هذا النموذج رغم أن قائمة الحالات تتضمن "مسودة")، يظهر في قائمة القيود برقم تسلسلي جديد، وبطاقة "إجمالي القيود" تزداد بمقدار 1.
- **ACC-073** — **Pre**: أغلق فترة مالية تغطي تاريخاً معيّناً (عبر شاشة الفترات المالية). **Steps**: أنشئ قيداً بتاريخ داخل تلك الفترة المغلقة واضغط "ترحيل القيد". **Assert**: يظهر تنبيه خطأ أحمر برسالة الخادم الحرفية "Fiscal period ... is closed and does not allow posting." (أو ترجمتها) — لا يُنشأ القيد، ولا شاشة بيضاء صامتة.
- **ACC-074** — **Steps**: اضغط "إلغاء" أثناء تعبئة النموذج. **Assert**: يعود لقائمة القيود دون حفظ أي شيء وبلا تأكيد إضافي (لا حوار "هل أنت متأكد؟").
- **ACC-075** — **Pre**: أوقف الشبكة. **Steps**: أعد تحميل قائمة القيود. **Assert**: بطاقة خطأ "تعذّر تحميل القيود المحاسبية." وزر "إعادة المحاولة".

---

### الفترات المالية — Fiscal Periods

- **ACC-076** — **Pre**: افتح «المحاسبة» ← «الفترات المالية». **Assert**: منتقي السنة يعرض السنة التي تحتوي بيانات فعلية (سنة واحدة مولّدة، 12 شهراً)؛ بطاقات إجمالي الفترات=12، فترات مفتوحة=12، مغلقة=0، مقفلة=0.
- **ACC-077** — **Steps**: لاحظ لافتة "الفترة الحالية". **Assert**: تعرض الشهر/السنة المطابقين للتاريخ الحالي مع نطاق التاريخ ووسم "مسموح" (أخضر).
- **ACC-078** — **Steps**: إن وُجدت فترات مفتوحة تجاوز تاريخ نهايتها التاريخ الحالي. **Assert**: تظهر عبارة "يحتاج انتباه: N فترة مفتوحة تجاوزت نهايتها." بلون تحذيري أسفل لافتة الفترة الحالية. `[NOT IMPLEMENTED]`: لا يوجد زر/رابط "عرض المفتوحة" مختصر كما في المرجع — النص وحده بلا إجراء.
- **ACC-079** — **Steps**: لاحظ جدول الفترات الاثني عشر. **Assert**: كل صف يعرض اسم الشهر بالعربية + السنة، ووسم "الفترة الحالية" أو "منتهية" حسب التاريخ، ونطاق من–إلى، وعمود "الترحيل" (مسموح/غير مسموح) مطابق تماماً لعمود "الحالة" (مفتوحة⇔مسموح، غير ذلك⇔غير مسموح).
- **ACC-080** — **Steps**: تبويبات "الكل (12)/مفتوحة (12)/مغلقة (0)/مقفلة (0)". **Assert**: الأعداد تتحدث فوراً مع كل عملية إغلاق/قفل لاحقة في نفس الجلسة.
- **ACC-081** — **Steps**: اختر فترة شهر ماضٍ منتهية (وسمها "منتهية")، اضغط "إغلاق" في صفها. **Assert**: تنتقل الفترة فوراً لحالة "مغلقة"، الترحيل يتحول إلى "غير مسموح"، وأزرار الصف تتبدل إلى "إعادة فتح" و"قفل" (زر "إغلاق" يختفي).
- **ACC-082** — **Steps**: على فترة **مغلقة**، اضغط "إعادة فتح". **Assert**: تعود لحالة "مفتوحة"، الترحيل "مسموح"، وزر "إغلاق" يعود للظهور — دورة قابلة للعكس مرتين فأكثر.
- **ACC-083** — **Steps**: أغلق الفترة مجدداً، ثم اضغط "قفل" (وليس "إعادة فتح"). **Assert**: تنتقل لحالة "مقفلة"، ولا تظهر أي أزرار إجراء بعد ذلك في صفها (لا إغلاق، لا إعادة فتح، لا قفل) — **حالة نهائية غير قابلة للتفاوض**.
- **ACC-084** — **Steps**: حاول قفل فترة **مفتوحة** مباشرة (تجاوز حالة "مغلقة") — إن أمكن الوصول لهذا المسار عبر استدعاء مباشر أو إعادة تحميل بعد تعديل يدوي. **Assert**: الخادم يرفض بـ`InvalidPeriodTransitionError` ("cannot lock from status open") — لا مسار في الواجهة يعرض زر "قفل" على فترة مفتوحة أصلاً (فقط "إغلاق")، فهذا اختبار للحارس وليس فقط للواجهة.
- **ACC-085** — **Steps**: بعد قفل فترة، حاول ترحيل قيد يومي بتاريخ داخلها (من شاشة القيود). **Assert**: يُرفض بخطأ خادم "period ... is locked and does not allow posting" — مطابق تماماً لرفض الفترة المغلقة (نفس نوع الخطأ `PeriodNotOpenForPostingError`).
- **ACC-086** — **Steps**: اضغط "إنشاء السنة التالية". **Assert**: تُنشأ 12 فترة جديدة للسنة اللاحقة فوراً، منتقي السنة يتبدل تلقائياً لعرضها، وكلها بحالة "مفتوحة".
- **ACC-087** — **Steps**: اضغط "إنشاء السنة التالية" مرة ثانية لنفس السنة (محاولة تكرار). **Assert**: خطأ خادم `DuplicateFiscalPeriodError` يظهر في شريط تنبيه أحمر أعلى الصفحة، ولا تتكرر الفترات.
- **ACC-088** — **Steps**: بدّل منتقي السنة يدوياً للسنة السابقة (2025 إن وُجدت أو غير موجودة). **Assert**: إن لم تكن مولّدة، الجدول فارغ برسالة "لا توجد فترات مطابقة" والبطاقات كلها 0 — لا خطأ.

---

### الضرائب — Taxes

- **ACC-089** — **Pre**: افتح «المحاسبة» ← «الضرائب». **Assert**: وصف الصفحة "تستخدم هذه الضرائب عند إنشاء الفواتير..." ظاهر، وبطاقات إجمالي الضرائب/نشط/غير نشط.
- **ACC-090** — **Steps**: لاحظ صف ضريبة القيمة المضافة الافتراضية (VAT14). **Assert**: شارة "الافتراضي" ظاهرة بجانب الاسم، النسبة 14.00%، النوع "غير شاملة (تضاف على السعر)"، الحالة "نشط".
- **ACC-091** — **Assert `[NOT IMPLEMENTED]`**: لا يوجد زر ثانوي "مجموعات الضرائب (N)" في رأس الصفحة كما يصفه المرجع — لا شاشة/حوار لمجموعات الضرائب مطلقاً.
- **ACC-092** — **Steps**: اكتب في مربع "بحث" اسم الضريبة الافتراضية جزئياً. **Assert**: تُصفّى بمطابقة الاسم أو الرمز.
- **ACC-093** — **Steps**: اضغط "إضافة ضريبة". **Assert**: لوحة جانبية بحقول: اسم الضريبة*، رمز الضريبة*، نسبة الضريبة (%)* (افتراضي 0)، النوع (غير شاملة/شاملة، افتراضي غير شاملة)، مفتاح "ضريبة افتراضية"، قسم "حسابات الترحيل" (حساب الضريبة المستحقة placeholder "تلقائي (الافتراضي 2200)"، حساب ضريبة المدخلات placeholder "تلقائي (الافتراضي 1400)")، قسم "تصنيف الفاتورة الإلكترونية (ETA)" بقائمة النوع الفرعي لضريبة القيمة المضافة.
- **ACC-094** — **Steps**: أنشئ ضريبة برمز مكرر لـ"VAT14". **Assert**: `رمز الضريبة "VAT14" مستخدم بالفعل — اختر رمزاً آخر.`
- **ACC-095** — **Steps**: أدخل نسبة ضريبة = -5 أو 150. **Assert**: `نسبة الضريبة يجب أن تكون رقماً بين 0 و 100.`
- **ACC-096** — **Steps**: أنشئ ضريبة جديدة "ضريبة خدمة 10%"، اترك حسابات الترحيل فارغة، احفظ. **Assert**: تُحفظ الضريبة الجديدة وتظهر في القائمة؛ الحقول الفارغة تُرسل كـ`null` (يعتمد النظام تلقائياً على 2200/1400).
- **ACC-097** — **Steps**: اجعل الضريبة الجديدة "ضريبة افتراضية". **Assert**: بعد الحفظ، شارة "الافتراضي" تنتقل للضريبة الجديدة — تحقق من الخادم أن القاعدة "ضريبة افتراضية واحدة كحد أقصى" منطبقة (الضريبة السابقة تفقد الشارة تلقائياً بعد إعادة التحميل).
- **ACC-098** — **Steps**: اختر "النوع الفرعي لضريبة القيمة المضافة" وتحقق من قائمة الخيارات. **Assert**: القائمة تحتوي رموز ETA (تلقائي، V001–V009 أو ما يعادلها من `ETA_VAT_SUBTYPE_DEFINITIONS`) بتسميات عربية واضحة.
- **ACC-099** — **Steps**: من صف أي ضريبة اضغط "تعديل"، بدّل الحالة إلى "غير نشط"، احفظ. **Assert**: الوسم يتحدث والبطاقة "غير نشط" تزداد.
- **ACC-100** — **Pre**: أوقف الشبكة. **Steps**: أعد تحميل الشاشة. **Assert**: بطاقة خطأ + زر إعادة محاولة.

---

### أسعار الصرف — Exchange Rates

- **ACC-101** — **Pre**: افتح «المحاسبة» ← «أسعار الصرف». **Assert**: لافتة "العملة الأساسية: EGP — جميع الأسعار محسوبة مقابل هذه العملة"، والجدول يعرض 5 صفوف (3 USD + 2 EUR).
- **ACC-102** — **Steps**: لاحظ عمود "الحالة". **Assert**: أقدم سعرين (USD @01‑08، EUR @01‑08 وEUR @15‑08) — تحقق فعلياً أي منها "معتمد" وأيها "بانتظار الاعتماد" حسب البذرة (USD‑1 وUSD‑2 المزروعان بحالة `approved` صراحة؛ سعر EUR الاثنان وآخر سعر USD بلا حالة صريحة يُفترض أن يكونا "بانتظار الاعتماد" افتراضياً).
- **ACC-103** — **Steps**: تبويبات "الكل/بانتظار الاعتماد/معتمد/مقفل". **Assert**: الأعداد تطابق العدّ الفعلي لكل حالة، واختيار "مقفل" يعرض قائمة فارغة (لا سعر مقفل في البذرة).
- **ACC-104** — **Steps**: على صف بحالة "بانتظار الاعتماد"، اضغط "اعتماد". **Assert**: تتحول الحالة فوراً إلى "معتمد" (وسم أخضر)، وزر "اعتماد" يختفي من ذلك الصف.
- **ACC-105** — **Steps**: على صف "معتمد" أو "مقفل". **Assert**: لا يظهر أي زر إجراء (لا اعتماد، لا قفل من الواجهة) — العمود الأخير فارغ.
- **ACC-106** — **Steps**: اضغط "إضافة سعر صرف". **Assert**: يظهر شريط تحرير مضمّن (وليس لوحة جانبية منفصلة كما يصفه المرجع) بحقول: العملة الأجنبية (قائمة من 7 عملات ثابتة)، سعر الصرف (placeholder "50.2500")، تاريخ السريان (منتقي تاريخ حقيقي، افتراضي نهاية الشهر). **Assert `[NOT IMPLEMENTED]`**: لا يوجد حقل "نوع السعر" (قياسي/شراء/بيع) ولا حقل "المصدر" (يدوي/تلقائي) ولا "ملاحظات" كما يصفهم المرجع.
- **ACC-107** — **Steps**: اضغط "حفظ" بدون إدخال سعر. **Assert**: لا يُرسل الطلب (`if (draft.rate.trim() === "") return;`) — لا رسالة خطأ ظاهرة، الحقل يبقى فارغاً بصمت.
- **ACC-108** — **Steps**: أدخل سعراً صحيحاً لعملة جديدة (مثلاً SAR بسعر 13.50) بتاريخ اليوم، احفظ. **Assert**: يُضاف صف جديد بحالة "بانتظار الاعتماد" (القيمة الافتراضية المرسلة من العميل)، والجدول يعرض 6 أسعار الآن.
- **ACC-109** — **Steps**: أضف سعراً لعملة ولنفس التاريخ لسعر موجود مسبقاً بالضبط (تكرار). **Assert**: لاحظ سلوك الخادم — إما يُرفض بخطأ تكرار أو يُقبل كسجل مستقل؛ وثّق أيهما يحدث فعلياً (لا افتراض مسبق في هذه الشاشة).
- **ACC-110** — **Pre**: أوقف الشبكة. **Steps**: حمّل الشاشة. **Assert**: بطاقة خطأ + إعادة محاولة.

---

### إعادة تقييم العملات الأجنبية — FX Revaluation

- **ACC-111** — **Pre**: افتح «المحاسبة» ← «إعادة تقييم العملات الأجنبية». **Assert**: نص الشرح الكامل ظاهر، حقل "إلى تاريخ (تاريخ القيد)" (منتقي تاريخ حقيقي) مبدئياً على نهاية الشهر الحالي، مفتاح "العكس التلقائي" **مفعّل افتراضياً**، ونص مرافق يعرض تاريخ العكس المحسوب (اليوم التالي).
- **ACC-112** — **Steps**: لاحظ رقاقات العملات. **Assert**: "الكل" مفعّلة افتراضياً (لا عملة محددة تحديداً)، مع 7 عملات فردية قابلة للتبديل (USD، EUR، SAR، AED، QAR، KWD، GBP).
- **ACC-113** — **Steps**: اضغط رقاقة USD فقط (تعطيل "الكل" ضمنياً باختيار عملة محددة). **Assert**: الرقاقة تتحول لحالة "نشطة"؛ رقاقة "الكل" لا تُلغى تلقائياً بصرياً لكن منطق الإرسال يحصر التقييم بـUSD فقط عند "معاينة".
- **ACC-114** — **Steps**: اضغط "معاينة" بدون تغيير أي شيء (كل العملات). **Assert**: تظهر بطاقات "إجمالي المكاسب"/"إجمالي الخسائر"/"تاريخ العكس"، وجدول بعمود لكل رصيد أجنبي مفتوح: الحساب، العملة، الرصيد الأجنبي، سعر الإقفال، القيمة الدفترية، بعد التقييم، الفرق (ربح/خسارة) بشريط لوني (VarianceBeam).
- **ACC-115** — **Steps**: بما أن لا أرصدة عميل/مورد/خزينة بعملة أجنبية مفتوحة فعلياً في هذا المستأجر (كل الحسابات المزروعة EGP). **Assert**: جدول المعاينة فارغ برسالة "لا توجد أرصدة عملات أجنبية مفتوحة" — البطاقات تعرض 0.00 للمكاسب والخسائر.
- **ACC-116** — **Steps**: اختر تاريخاً 2028-02-29 (يوم كبيسة حقيقي)، اضغط "معاينة" ثم "ترحيل التقييم" (لو مسموحاً بتواريخ مستقبلية). **Assert**: النص المرافق لمفتاح "العكس التلقائي" يحسب تاريخ العكس = 2028-03-01 بالضبط (اليوم التالي الفعلي، وليس تعاملاً خاصاً باليوم الكبيسي هنا — هذا الحقل يستخدم `nextDay` البسيطة، بخلاف منطق المقارنة السنوية في التقارير المالية أدناه الذي يُشترط عليه اقتطاع 29 فبراير).
- **ACC-117** — **Steps**: اضغط "ترحيل التقييم" (بعد معاينة تحتوي فروقاً — يتطلب بيانات إضافية غير متوفرة في البذرة الحالية؛ وثّق كحالة يدوية إن تعذّر التنفيذ آلياً). **Assert**: تظهر رسالة نجاح خضراء "تم ترحيل قيد إعادة التقييم {رقم القيد} مع قيد عكسي {رقم القيد العكسي}." ويُعاد تشغيل المعاينة تلقائياً لتعكس الحالة الجديدة (على الأرجح فارغة الآن لأن الفروقات أُقفلت).
- **ACC-118** — **Steps**: كرر "ترحيل التقييم" فوراً لنفس التاريخ ونفس العملات بلا تغيير أرصدة. **Assert**: التقييم الثاني ينتج فروقاً صفرية أو رسالة نجاح بقيمة 0.00 — لا خطأ ولا تكرار غير متوقع لقيد سابق لم يُعكس.

---

### مطابقة الأرصدة — Balance Reconciliation

- **ACC-119** — **Pre**: افتح «المحاسبة» ← «مطابقة الأرصدة». **Assert**: تبويب "ملخص المطابقة" هو الافتراضي؛ زر "تحديث" في الرأس يعيد الاستعلام عند الضغط.
- **ACC-120** — **Steps**: لاحظ اللافتة العلوية. **Assert**: بسبب العيب **D1** (سند تحصيل مؤكد لا يحدّث `amountPaid` على الفاتورة)، اللافتة تعرض "توجد فروقات تحتاج إلى مراجعة" (تحذيرية) وليس "جميع الأرصدة متطابقة" — هذا سلوك متوقع، لا تُعِد فتحه كعيب جديد.
- **ACC-121** — **Steps**: لاحظ صف "ذمم العملاء مقابل دفتر الأستاذ". **Assert**: الحالة "غير متطابق" بفرق موجب غير صفري (يعكس بالضبط تراكم مبالغ التحصيل غير المرحّلة على الفواتير، مثل سند VCH-DEMO-1 بمبلغ 6,279.12) — هذا هو أثر D1، مرجعه فقط ولا يُفتح كعيب جديد.
- **ACC-122** — **Steps**: لاحظ صف "تقييم المخزون مقابل دفتر الأستاذ". **Assert**: الحالة "متطابق" وفرق = 0.00 بالضبط.
- **ACC-123** — **Steps**: لاحظ صف "ذمم الموردين مقابل دفتر الأستاذ". **Assert**: الحالة "متطابق" وفرق = 0.00 بالضبط. **إن ظهر أي فرق هنا أو في صف المخزون فهذا عيب جديد** — وثّقه بالقيمة المقاسة بالضبط (وليس وصفاً عاماً)، فهذا خارج ما يغطيه D1.
- **ACC-124** — **Assert `[NOT IMPLEMENTED]`**: لا يوجد صف "الخزينة مقابل دفتر الأستاذ (EGP)" (مقارنة النقدية/البنك) كما يصفه المرجع — فقط 3 صفوف (مخزون، ذمم عملاء، ذمم موردين)؛ لا مطابقة للحسابات النقدية مطلقاً في هذا البناء.
- **ACC-125** — **Assert `[NOT IMPLEMENTED]`**: لا يوجد زر "تفاصيل المخزون (لكل صنف ولكل نوع مستند)" أو أي إمكانية تفصيل (drill‑down) من صف الملخص — الصفوف نصية فقط بلا تفاعل.
- **ACC-126** — **Steps**: بدّل إلى تبويب "القيود غير المرتبطة (N)". **Assert**: N في عنوان التبويب يطابق طول مصفوفة `unlinked` الفعلية؛ إن كانت صفراً تظهر بطاقة "جميع بنود حسابات المراقبة مخصصة بشكل صحيح".
- **ACC-127** — **Pre**: أنشئ يدوياً قيداً محاسبياً (من شاشة القيود) يستهدف مباشرة حساب مراقبة (1200 المخزون أو 1105 الذمم أو 2100 الموردين) بمصدر "manual". **Steps**: عد إلى مطابقة الأرصدة ← تبويب القيود غير المرتبطة. **Assert**: يظهر البند الجديد في الأعلى (الأحدث أولاً) بأعمدة رقم القيد/التاريخ/الحساب/الوصف/مدين/دائن.
- **ACC-128** — **Steps**: اضغط "تحديث" في رأس الصفحة. **Assert**: تُعاد جلب البيانات وتُحدَّث اللافتة العلوية والصفوف دون إعادة تحميل كامل الصفحة.

---

### الفاتورة الإلكترونية — ETA e-Invoicing

- **ACC-129** — **Pre**: افتح «المحاسبة» ← «الفاتورة الإلكترونية». **Assert**: بطاقة "الجاهزية: N%" مع قائمة عناصر تحقق (رقم التسجيل الضريبي، كود النشاط، عنوان المنشأة، أكواد الفروع، أكواد الأصناف، ربط الوحدات، أنواع الضريبة الفرعية) كل عنصر بوسم "مكتمل"/غير مكتمل.
- **ACC-130** — **Steps**: لاحظ وسم البيئة بجانب شريط الجاهزية. **Assert**: يعرض "بيئة الاختبار" أو "بيئة الإنتاج" مطابقاً لإعداد `config.environment`.
- **ACC-131** — **Assert `[NOT IMPLEMENTED]`** (فجوة رئيسية مقابل المرجع): لا توجد تبويبات على هذه الشاشة إطلاقاً — المرجع يصف خمسة تبويبات (عام، بيانات الربط، ربط الأصناف، ربط الوحدات، الإرسالات). البناء الفعلي صفحة واحدة مسطحة تجمع فقط لافتة الجاهزية + قائمة الإرسالات؛ **لا نموذج لتعديل بيانات التسجيل الضريبي (رقم التسجيل/كود النشاط/العنوان)، لا نموذج بيانات الربط (Client ID/Secret/طريقة التوقيع)، لا شاشة ربط الأصناف، لا شاشة ربط الوحدات** — الجاهزية معروضة للقراءة فقط بلا أي وسيلة لرفعها من هذه الشاشة.
- **ACC-132** — **Steps**: لاحظ تبويبات/رقائق حالة الإرسالات "الكل/جاهز/بانتظار التوقيع/أخطاء/مرسل/مقبول/مستبعد". **Assert**: الأعداد المرافقة تطابق العدّ الفعلي؛ بسبب العيب **D5** (لا مُنتِج يُدخل مستندات في قائمة الإرسال — لا مسار/حدث يستدعي `enqueue`)، توقّع أن القائمة **فارغة بالكامل** (كل الرقائق = 0) بصرف النظر عن عدد الفواتير/السندات المؤكدة في التطبيق. هذا مرجعه فقط، لا تُعِد فتحه.
- **ACC-133** — **Steps**: اضغط "إرسال كل الجاهز" والقائمة فارغة. **Assert**: لا يحدث خطأ؛ إما لا شيء يتغيّر أو يظهر إشعار محايد يفيد بعدم وجود مستندات جاهزة (`result.queued.length === 0` لا يُنتج إشعاراً حسب الشيفرة الحالية).
- **ACC-134** — **Pre**: لو توفّر مستند واحد على الأقل بحالة "جاهز" (عبر بيانات اختبار مباشرة على الخادم). **Steps**: اضغط "إرسال" على صفه. **Assert**: يظهر إشعار تحذيري أصفر: "الإرسال الفعلي متاح فقط عند الاتصال بالمصلحة (موقوف في هذه النسخة) — بقي المستند في قائمة الإرسال." والمستند يبقى بحالته (الإرسال الفعلي مُعطَّل عمداً في هذا البناء، غير متصل).
- **ACC-135** — **Steps**: على نفس الصف اضغط "استبعاد". **Assert**: يظهر شريط "سبب الاستبعاد (إلزامي)" بحقل نصي؛ زر "تأكيد الاستبعاد" **يبقى قابلاً للضغط** لكن الاستدعاء الفعلي يتطلب سبباً غير فارغ من جهة الدالة (`reason.trim() === "" ? return`) — اختبر إرسال سبب فارغ فلا يحدث شيء، ثم اكتب سبباً واضغط تأكيد فتنتقل حالة المستند إلى "مستبعد".
- **ACC-136** — **Steps**: على مستند بحالة "مستبعد" أو "مقبول". **Assert**: لا تظهر أزرار "إرسال"/"استبعاد" (الإجراءات مقصورة على جاهز/بانتظار التوقيع/أخطاء).
- **ACC-137** — **Pre**: أوقف الشبكة. **Steps**: حمّل الشاشة. **Assert**: بطاقة خطأ واحدة تغطي كلا الاستعلامين (الإعداد + الإرسالات) وزر "إعادة المحاولة" يعيد كليهما معاً.

---

### ميزان المراجعة — Standalone Trial Balance Report

- **ACC-138** — **Pre**: افتح «المحاسبة» ← «ميزان المراجعة» (عنصر تنقّل مستقل عن تبويب "ميزان المراجعة" داخل «التقارير المالية»). **Assert**: العنوان "ميزان المراجعة"، وحقل "حتى تاريخ" فقط.
- **ACC-139** — **Steps**: لاحظ الحالة قبل أي تشغيل. **Assert `[مغاير عن تبويب التقارير المالية]`**: هذه الشاشة **حسب الطلب** (`onDemand: true` بلا تجاوز) — تعرض حالة فارغة وزر "عرض التقرير" يجب الضغط عليه أولاً، بخلاف تبويب "ميزان المراجعة" داخل «التقارير المالية» الذي يُشغَّل تلقائياً دون ضغط.
- **ACC-140** — **Steps**: اضغط "عرض التقرير" بدون تغيير "حتى تاريخ" (القيمة الافتراضية = اليوم). **Assert**: يظهر جدول مجمّع حسب نوع الحساب (أصول/التزامات/حقوق ملكية/إيرادات/مصروفات)، عمود مدين وعمود دائن، وصف تحقق إجمالي أعلى الجدول "إجمالي المدين = إجمالي الدائن" مع القيمتين متطابقتين **بالضبط** (فرق = 0.00) — هذا الاختبار الحسابي الأهم لهذه الشاشة.
- **ACC-141** — **Steps**: اجمع يدوياً كل قيم عمود "مدين" في الجدول واطرح مجموع "دائن". **Assert**: الناتج = 0.00 ج.م بالضبط (بما يطابق شارة التحقق).
- **ACC-142** — **Steps**: غيّر "حتى تاريخ" إلى تاريخ قبل أي نشاط (مثلاً 2025-01-01). **Assert**: كل الأرصدة 0.00، والتحقق لا يزال "إجمالي المدين = إجمالي الدائن" (0 = 0).
- **ACC-143** — **Steps**: اضغط "تصدير CSV" ثم "تصدير Excel" بعد تشغيل التقرير. **Assert**: كلا الزرين مفعّل (النتيجة غير فارغة)، وينزّل ملفاً باسم يبدأ بـ`trial-balance` بالامتداد الصحيح (`.csv`/`.xlsx`).
- **ACC-144** — **Steps**: بدّل "حتى تاريخ" قبل تشغيل التقرير للمرة الأولى (النتيجة لا تزال null). **Assert**: زرا التصدير معطّلان (`disabled={!hasResult || rows.length === 0}`).
- **ACC-145** — **Steps**: انقر على أي كود/اسم حساب في صفوف النتيجة. **Assert**: تُفتح لوحة جانبية بتفاصيل الحساب (نفس لوحة دليل الحسابات) — بما فيها القيود المعروفة `[NOT IMPLEMENTED]` من قسم دليل الحسابات أعلاه (الحركات لا تزال عنصراً نائباً).

---

### التقارير المالية — Financial Reports (7 تبويبات على `/accounting/reports`)

كل تبويب يستخدم نفس مكوّن `ReportRunner` — **تصدير CSV وتصدير Excel متاحان دائماً على كل السبعة تبويبات** (يظهر هذا مغايراً لما رصده المرجع، الذي وصف التصدير محصوراً بأربعة تقارير أساسية فقط ولم يشغّل تبويبي دفتر الأستاذ ودفتر حساب مطلقاً — التنفيذ الفعلي أشمل من ذلك).

#### تبويب ميزان المراجعة (يُشغَّل تلقائياً، بخلاف الشاشة المستقلة أعلاه)

- **ACC-146** — **Pre**: افتح «المحاسبة» ← «التقارير المالية» (تبويب "ميزان المراجعة" مفعّل افتراضياً). **Assert**: الجدول يُحمَّل تلقائياً بلا ضغط "عرض التقرير" — على عكس ACC-139/شاشة `TrialBalanceReportScreen` المستقلة لنفس التقرير بالضبط.
- **ACC-147** — **Steps**: قارن مجموع صف واحد (مثلاً حساب 1105) في هذا التبويب مع نفس الحساب في الشاشة المستقلة «ميزان المراجعة» لنفس "حتى تاريخ". **Assert**: القيمتان متطابقتان تماماً (كلاهما يستدعي نفس نقطة النهاية `/accounting/trial-balance`).
- **ACC-148** — **Assert**: تحقق التوازن "إجمالي المدين = إجمالي الدائن" صحيح (فرق 0.00) لأي "حتى تاريخ" يُختار.

#### تبويب قائمة الدخل

- **ACC-149** — **Steps**: بدّل إلى تبويب "قائمة الدخل". **Assert**: الحقول: الفترة (من/إلى، افتراضياً 2026-01-01 → اليوم تقريباً)، والمقارنة (قائمة منسدلة "الفترة السابقة"/"نفس الفترة من العام الماضي"، افتراضياً "الفترة السابقة"). **Assert `[NOT IMPLEMENTED]` مقارنة بالمرجع**: لا يوجد فلتر "الفرع" — التقرير يشمل كل الفروع دوماً؛ زر المقارنة قائمة اختيار حقيقية بقيمتين وليس مجرد مفتاح تبديل ثنائي كما وصفه المرجع.
- **ACC-150** — **Steps**: لاحظ الجدول. **Assert**: الأقسام مرتبة دوماً "الإيرادات" ثم "تكلفة البضاعة المباعة" ثم "المصاريف التشغيلية"؛ كل قسم له إجمالي فرعي؛ الأعمدة: الفترة الحالية، فترة المقارنة، التغيّر (بشريط لوني موجب/سالب).
- **ACC-151** — **Pre**: سجّل يدوياً (أو لاحظ) قيمة عمود "الفترة الحالية" لحساب إيراد معيّن نشط في أغسطس 2026 بنطاق الفترة 2026-08-01→2026-08-31 والمقارنة "الفترة السابقة". **Steps**: بدّل النطاق يدوياً إلى الفترة السابقة المكافئة تماماً (2026-07-01→2026-07-31، نفس عدد الأيام) وشغّل التقرير مباشرة لهذه الفترة وحدها. **Assert (فحص حسابي إلزامي حسب مهمة الاختبار)**: قيمة عمود "الفترة الحالية" في التشغيل الثاني (يوليو منفرداً) **تساوي تماماً** قيمة عمود "فترة المقارنة" التي ظهرت في التشغيل الأول (أغسطس مع مقارنة "الفترة السابقة") لنفس الحساب. أي اختلاف يكشف خطأ إزاحة بمقدار يوم واحد (off-by-one) في حساب `comparativeRange`.
- **ACC-152** — **Steps**: بدّل المقارنة إلى "نفس الفترة من العام الماضي" لنطاق أغسطس 2026 (لا نشاط في أغسطس 2025). **Assert**: كل حساب له نشاط في 2026 لا يزال يظهر في الجدول، لكن عمود "فترة المقارنة" = 0.00 له (لا يُحذف الصف بصمت) — هذا الفحص المطلوب صراحة: "حساب نشط في نافذة واحدة فقط يجب أن يظهر، بصفر في الجانب الفارغ".
- **ACC-153** — **Steps**: كرر ACC-151 لكن بنطاق ينتهي في 29 فبراير من سنة كبيسة (مثلاً من 2028-02-01 إلى 2028-02-29) بالمقارنة "نفس الفترة من العام الماضي" (2027، غير كبيسة). **Assert (فحص اليوم الكبيسي الإلزامي)**: شغّل بعد ذلك التقرير مباشرة على الفترة 2027-02-01→2027-02-28 (28 يوماً، آخر يوم في فبراير 2027). عمود "الفترة الحالية" لهذا التشغيل المباشر يجب أن يساوي **بالضبط** عمود "فترة المقارنة" من التشغيل الأول — أي أن 29 فبراير يُقتطع (clamp) إلى 28 فبراير في السنة غير الكبيسة، ولا "ينزلق" إلى 1 مارس. لا حاجة لبيانات فعلية في هذا النطاق؛ الفحص صحيح حتى لو كل الأعمدة صفراً — المهم تطابق النطاقين.
- **ACC-154** — **Steps**: تحقق KPI الأعلى (إجمالي الإيرادات، إجمالي المصروفات، صافي الدخل). **Assert**: صافي الدخل = إجمالي الإيرادات − (تكلفة البضاعة المباعة + المصاريف التشغيلية) بحساب يدوي من صفوف الجدول، وليس رقماً منفصلاً غير متسق.
- **ACC-155** — **Steps**: اضغط "تصدير CSV" و"تصدير Excel". **Assert**: كلاهما ينزّل ملفاً باسم يبدأ بمعرّف التقرير (`accounting.income-statement`) — تحقق أن أعمدة التصدير تطابق أعمدة الشاشة (الفترة الحالية/فترة المقارنة/التغيّر).

#### تبويب الميزانية العمومية

- **ACC-156** — **Steps**: بدّل إلى تبويب "الميزانية العمومية". **Assert**: حقل "حتى تاريخ" فقط (لا مقارنة سنة سابقة ظاهرة كخيار فعلي رغم أن نمط الحقول العام يدعمها لبقية التبويبات — لاحظ أن هذا التبويب تحديداً لا يحمل حقل "compareTo" في تعريفه، فقط asOfDate). **Assert `[NOT IMPLEMENTED]` مقارنة بالمرجع**: لا فلتر "الفرع"، ولا زر "مقارنة بالعام الماضي" على هذا التبويب تحديداً (خلافاً لما وصفه المرجع).
- **ACC-157** — **Steps**: شغّل التقرير على تاريخ اليوم. **Assert**: لا يظهر صف/إجمالي كلي واحد يجمع كل شيء (`showGrandTotal=false` مقصود) — بدلاً من ذلك جدول واحد بثلاثة أقسام (الأصول، الالتزامات، حقوق الملكية) كل قسم بإجمالي فرعي، وشارة تحقق أعلى الصفحة "الأصول = الالتزامات + حقوق الملكية".
- **ACC-158** — **Steps (فحص حسابي إلزامي)**: اجمع يدوياً كل صفوف قسم "الأصول". **Assert**: المجموع يساوي بالضبط مجموع صفوف "الالتزامات" + "حقوق الملكية" (شامل صف "الأرباح المحتجزة (صافي دخل الفترة)" الذي يُدرج تلقائياً تحت حقوق الملكية عندما يكون صافي الدخل التراكمي غير صفري).
- **ACC-159** — **Steps (فحص تصنيف إلزامي حسب مهمة الاختبار)**: ابحث في قسم "الأصول" عن حساب "1105 ذمم عملاء تجارية". **Assert**: يظهر تحت المجموعة **"الأصول المتداولة"**، وليس تحت أي مجموعة نقدية — رغم أن كود الحساب يبدأ بـ"11" (نفس بادئة نطاق الكاش الافتراضي 11xx في منطق التصنيف الاحتياطي)، القائمة السوداء الصريحة لحسابات النقدية (1300‑1/1310/1315/1320/1330) هي التي تحكم فعلياً، فلا يُصنَّف أي حساب ذمم كنقدية.
- **ACC-160** — **Steps**: ابحث عن حساب "1300‑1 صندوق نقدي الفرع الرئيسي" و"1310 حسابات بنكية". **Assert**: كلاهما يظهر تحت مجموعة منفصلة (النقدية وما في حكمها) أعلى قسم الأصول، مفصولين بوضوح عن "الأصول المتداولة" الأخرى.
- **ACC-161** — **Steps**: صدّر التقرير Excel. **Assert**: الملف يتضمن الأعمدة الثلاثة (رقم الحساب/الحساب/الرصيد) دون عمود إجمالي كلي مضلل.

#### تبويب التدفقات النقدية

- **ACC-162** — **Steps**: بدّل إلى تبويب "التدفقات النقدية"، اترك الفترة على القيمة الافتراضية. **Assert**: الجدول مقسم لثلاثة أنشطة (تشغيلية/استثمارية/تمويلية) بترتيب ثابت، أول صف داخل "الأنشطة التشغيلية" هو دوماً "صافي الدخل".
- **ACC-163** — **Steps (فحص حسابي إلزامي)**: لاحظ صف تحقق أعلى الصفحة "الرصيد الافتتاحي + صافي التغيير = الرصيد الختامي". اجمع يدوياً كل قيم عمود "التدفق النقدي" عبر كل الصفوف (صافي التغيير)، أضفه للرصيد الافتتاحي المعروض. **Assert**: الناتج يساوي بالضبط الرصيد الختامي المعروض — لا فرق ولو قرشاً واحداً.
- **ACC-164** — **Steps**: بدّل المقارنة إلى "نفس الفترة من العام الماضي". **Assert**: أي بند نشط فقط في فترة المقارنة (لا الحالية) يظهر أيضاً بصف مستقل بقيمة "الفترة الحالية" = 0.00 والقيمة الفعلية تحت "فترة المقارنة" — لا يُسقط بصمت (نفس فحص ACC-152 لكن على التدفقات النقدية).
- **ACC-165** — **Steps**: كرر فحص اليوم الكبيسي (ACC-153) على هذا التبويب: فترة تنتهي في 2028-02-29 بمقارنة "نفس الفترة من العام الماضي"، ثم شغّل مباشرة على 2027-02-01→2027-02-28. **Assert**: تطابق تام كما في ACC-153.
- **ACC-166** — **Assert `[NOT IMPLEMENTED]`**: لا فلتر "الفرع" على هذا التبويب رغم وصف المرجع له.

#### تبويب إقرار ضريبة القيمة المضافة

- **ACC-167** — **Steps**: بدّل إلى تبويب "إقرار ضريبة القيمة المضافة". **Assert**: حقل نطاق التاريخ فقط، **لا فلتر فرع، لا زر مقارنة، لا زر تصدير** (التبويب الوحيد من السبعة بلا تصدير — يطابق سلوك المرجع هنا).
- **ACC-168** — **Steps**: شغّل التقرير (يعمل تلقائياً). **Assert**: جدولان منفصلان بعنوانين "ضريبة المخرجات (المبيعات)" و"ضريبة المدخلات (المشتريات)"، كل جدول مقسّم حسب نسبة الضريبة (14.00%، 0.00%) بأعمدة الوعاء الخاضع ومبلغ الضريبة، مع صف إجمالي لكل قسم.
- **ACC-169** — **Steps (فحص حسابي إلزامي)**: لاحظ لافتة الملخص أسفل رأس الصفحة "ضريبة المخرجات − ضريبة المدخلات = {صافي الضريبة المستحقة الدفع أو القابلة للاسترداد}". اجمع يدوياً كل قيم "مبلغ الضريبة" في جدول المخرجات، اطرح مجموع "مبلغ الضريبة" في جدول المدخلات. **Assert**: الناتج يساوي بالضبط الرقم المعروض في اللافتة (والتسمية "مستحقة الدفع" إن كان موجباً أو "قابلة للاسترداد" إن كان سالباً).
- **ACC-170** — **Steps**: انقر على أي رقم في الجداول (لاختبار وجود drill-down). **Assert `[NOT IMPLEMENTED]`**: صفوف هذا التبويب نصية فقط بلا أي عنصر قابل للنقر (مجمّعة حسب شريحة النسبة لا حسب مستند فردي) — لا لوحة جانبية تُفتح.

#### تبويب دفتر الأستاذ العام (حسب الطلب)

- **ACC-171** — **Steps**: بدّل إلى تبويب "دفتر الأستاذ العام". **Assert**: حالة فارغة "اختر الفترة لعرض التقرير" — لا جدول قبل الضغط على "عرض التقرير"، تماماً كما يصفه المرجع.
- **ACC-172** — **Steps**: اضغط "عرض التقرير" (النطاق الافتراضي من بداية السنة إلى اليوم). **Assert**: جدول مجمّع حسب الحساب (كود — اسم)، كل مجموعة تعرض صفوفها مرتبة زمنياً، وصف تحقق "إجمالي المدين = إجمالي الدائن" أعلى الصفحة يساوي فيه الجانبان تماماً (بما أن كل قيد مرحّل متوازن ببنيته).
- **ACC-173** — **Steps**: صدّر Excel بعد التشغيل. **Assert**: الملف يحتوي كل الصفوف (لا حد أقصى صفحة واحدة) — التصدير يأخذ `result.rows` الكاملة وليس صفحة معروضة فقط.
- **ACC-174** — **Steps**: غيّر النطاق ليكون خارج أي نشاط، أعد الضغط على "عرض التقرير". **Assert**: جدول فارغ، والتحقق 0 = 0 لا يزال صحيحاً (لا يفشل على قيم صفرية).

#### تبويب دفتر حساب (حسب الطلب، يتطلب اختيار حساب)

- **ACC-175** — **Steps**: بدّل إلى تبويب "دفتر حساب". **Assert**: حالة فارغة "اختر الحساب والفترة الزمنية لعرض التقرير"؛ زر "عرض التقرير" **معطّل** حتى يُختار حساب من قائمة "الحساب" (تُبنى من دليل الحسابات الفعلي عبر `useAccounts`، تعرض الحسابات القابلة للترحيل فقط — لا حسابات رئيسية).
- **ACC-176** — **Steps**: اختر الحساب "1300‑1 — صندوق نقدي الفرع الرئيسي" (أو ما يعادله)، اترك النطاق الافتراضي، اضغط "عرض التقرير" (يصبح مفعّلاً الآن). **Assert**: بطاقة رأس تعرض اسم/كود الحساب، رصيد أول المدة، رصيد نهاية المدة؛ جدول معاملات بأعمدة التاريخ/رقم القيد/البيان/مدين/دائن/الرصيد الجاري، أول صف هو دوماً "الرصيد الافتتاحي" بلا تاريخ ظاهر في عمود التاريخ.
- **ACC-177** — **Steps (فحص حسابي إلزامي — هذا هو فحص "مطابقة الفرعي مقابل حساب المراقبة" لهذه الشاشة تحديداً)**: تتبّع الرصيد الجاري صفاً صفاً يدوياً: كل صف = الرصيد السابق + مدين − دائن. **Assert**: الرصيد الجاري في آخر صف يساوي بالضبط "رصيد نهاية المدة" المعروض في بطاقة الرأس — وهذا بدوره (حسب تعريف التقرير) يساوي صافي حركة الحساب من دفتر الأستاذ حتى "إلى تاريخ" المُدخل، أي مطابقة فعلية بين حركة السطر بسطر وإجمالي الحساب.
- **ACC-178** — **Steps**: انقر على رقم قيد في أي صف. **Assert**: تُفتح لوحة جانبية بتفاصيل ذلك القيد (نفس مكوّن دفتر اليومية).
- **ACC-179** — **Steps**: بدّل الحساب المختار لحساب آخر بلا أي حركة في الفترة. **Assert**: يظهر فقط صف "الرصيد الافتتاحي" (يساوي الرصيد الختامي أيضاً) — لا صفوف حركة، ولا خطأ.

---

### الخزينة — Treasury Hub

- **ACC-180** — **Pre**: افتح «الخزينة» ← «نظرة عامة». **Assert**: خمسة أزرار بدء سريع: سند نقدي جديد، حسابات الخزينة، تسوية كشف بنك، سجل الشيكات (أربعة أزرار فعلياً في هذا البناء — تحقق العدد الدقيق المعروض مقابل الخمسة التي يصفها المرجع؛ إن كان أقل فوثّق كـ`[NOT IMPLEMENTED]` أي زر بدء سريع مفقود مثل "سند قبض جديد"/"سند صرف جديد"/"تحويل داخلي جديد"/"شيك جديد" كاختصارات منفصلة).
- **ACC-181** — **Steps**: لاحظ بطاقات الإحصاء الأربع. **Assert**: "حسابات خزينة نشطة" تعرض 2 من 2 (كلا حسابي الخزينة نشطان)، "السيولة النقدية" تُقرأ من نفس رقم لوحة القيادة الرئيسية (`/dashboard/summary` gl.cash) — تحقق التطابق بين هذا الرقم ورقم لوحة القيادة الرئيسية في نفس اللحظة، "السندات المسجّلة" = 12، "شيكات قيد التحصيل" = عدد الشيكات بحالة pending/deposited فقط (وليس كل الخمسة).
- **ACC-182** — **Steps**: لاحظ "أحدث السندات". **Assert**: حتى 5 سندات، الأحدث تاريخاً أولاً، كل صف يعرض البيان/رقم السند + التاريخ والمبلغ.
- **ACC-183** — **Steps**: اضغط كل زر بدء سريع على حدة. **Assert**: كل زر ينقل فعلياً للشاشة المقابلة (لا رابط معطل)؛ زر "سند نقدي جديد" تحديداً ينقل لشاشة السندات **في وضع الإنشاء المباشر** (وليس القائمة).

---

### حسابات الخزينة — Treasury Accounts

- **ACC-184** — **Pre**: افتح «الخزينة» ← «حسابات الخزينة». **Assert**: بطاقات إجمالي الحسابات (2)، إجمالي الأرصدة، النقد المتاح، الرصيد البنكي — تحقق أن (النقد المتاح + الرصيد البنكي) = إجمالي الأرصدة بالضبط.
- **ACC-185** — **Steps**: تصفية "الكل/نشط/نقدي/بنكي/غير نشط". **Assert**: اختيار "نقدي" يعرض الحساب النقدي فقط، "بنكي" يعرض الحساب البنكي فقط — كلاهما يظهر مادة واحدة بما أن المستأجر لديه حساب واحد من كل نوع.
- **ACC-186** — **Steps**: ابحث "بحث بالاسم..." عن جزء من اسم أحد الحسابين. **Assert**: تصفية فورية حسب الاسم أو الكود.
- **ACC-187** — **Steps**: اضغط "إضافة حساب". **Assert**: نموذج بحقول اسم الحساب*، الكود* (placeholder "CASH-003")، نوع الحساب* (نقدي/بنكي، افتراضي نقدي)، العملة* (نص حر بالأحرف الكبيرة تلقائياً، افتراضي EGP)، الفرع* (قائمة فروع حقيقية)، حساب دفتر الأستاذ (اختياري، نص حر مع تلميح "لا تحتاج إلى تعبئة هذا الحقل غالباً..."), قسم "الرصيد الافتتاحي (اختياري)" بحقل مبلغ وتاريخ.
- **ACC-188** — **Steps**: أنشئ حساباً بكود مطابق لحساب موجود. **Assert**: `الكود "..." مستخدم بالفعل — اختر كوداً آخر.`
- **ACC-189** — **Steps**: أنشئ حساباً نقدياً برصيد افتتاحي سالب (مثلاً -100). **Assert**: `لا يمكن أن يكون الرصيد الافتتاحي لحساب نقدي رصيداً سالباً.` (القيد لا ينطبق على الحسابات البنكية — جرّب نفس القيمة السالبة لنوع "بنكي" فتُقبل).
- **ACC-190** — **Steps**: اترك الفرع فارغاً (لو أمكن تفريغه)، احفظ. **Assert**: `الفرع مطلوب.`
- **ACC-191** — **Steps**: أنشئ حساباً بنكياً جديداً "بنك الاختبار" برصيد افتتاحي 5,000.00 وتاريخ اليوم. **Assert**: يُحفظ، يظهر في القائمة، بطاقة "الرصيد البنكي" تزداد بمقدار 5,000.00 بالضبط، و"إجمالي الأرصدة" يعكس ذلك أيضاً.
- **ACC-192** — **Steps**: انقر على أي صف حساب. **Assert**: تُفتح لوحة جانبية بعنوان "كشف حساب — {الاسم}"، بطاقة تعرض الكود/العملة/الفرع/حساب دفتر الأستاذ، وبطاقة "الرصيد الختامي" منفصلة تعرض نفس رقم الرصيد المعروض في عمود "الرصيد" بالقائمة.
- **ACC-193** — **Steps**: لاحظ أسفل اللوحة الجانبية. **Assert `[NOT IMPLEMENTED]`** (فجوة رئيسية مقابل المرجع): يظهر نص عنصر نائب ثابت "ستُعرض حركات الحساب هنا فور ربط السندات النقدية بالخزينة (المرحلة الثانية)." — **لا صفحة كشف حساب كاملة منفصلة** (`/treasury/accounts/{id}/statement` في المرجع)، **لا جدول حركات** يربط بالسندات (رغم وجود 12 سنداً فعلياً مرتبطة بهذين الحسابين)، **لا فلتر نطاق تاريخ**، **لا قائمة "المزيد"** بخيارات طباعة/تعديل/إضافة رصيد افتتاحي — الإجراء الوحيد المتاح من اللوحة الجانبية هو زر "تعديل" واحد أعلى الصفحة يفتح نفس نموذج الإنشاء/التعديل.
- **ACC-194** — **Steps**: بما أن "إضافة رصيد افتتاحي" بعد الإنشاء غير متاحة كإجراء منفصل، افتح "تعديل" على حساب موجود وعدّل حقل الرصيد الافتتاحي مباشرة. **Assert**: يُحفظ التعديل ويتحدث الرصيد المعروض في القائمة فوراً — هذا هو المسار الوحيد المتاح لتعديل الرصيد الافتتاحي بعد الإنشاء.
- **ACC-195** — **Pre**: أوقف الشبكة. **Steps**: حمّل الشاشة. **Assert**: بطاقة خطأ + إعادة محاولة.

---

### السندات النقدية — Treasury Vouchers

- **ACC-196** — **Pre**: افتح «الخزينة» ← «السندات النقدية». **Assert**: بطاقات الإجمالي (12)، مؤكد، بحاجة لتخصيص، مسودة — كل الـ12 سنداً "مؤكد" (لا مسودات في هذا المستأجر).
- **ACC-197** — **Steps**: لاحظ رقاقات تفصيل الأنواع أعلى الجدول (تعمل كفلاتر أيضاً). **Assert**: تعرض فقط الأنواع التي لها بيانات فعلياً (على الأقل تحصيل من عميل، دفع لمورد، إيراد/مصروف آخر، تحويل بين الخزائن حسب بذرة الملف treasury.ts) بأعداد صحيحة تجمع إلى 12.
- **ACC-198** — **Steps**: اضغط رقاقة نوع معيّن (مثلاً "تحصيل من عميل"). **Assert**: يُصفّى الجدول لهذا النوع فقط، ورقاقة "كل الأنواع" تفقد حالة التفعيل.
- **ACC-199** — **Steps**: تبويبات الحالة "الكل/بحاجة لتخصيص/مؤكد/مسودة". **Assert**: "بحاجة لتخصيص" تعرض فقط سندات تحصيل/دفع مؤكدة لم تُخصَّص كاملاً على فواتير (`allocationSummary.needsAllocation`)؛ العدد المرافق يطابق العدّ الفعلي.
- **ACC-200** — **Steps**: ابحث "ابحث برقم السند، المرجع، العميل، المورد…" عن اسم عميل معروف جزئياً. **Assert**: تصفية تطابق اسم الطرف (عميل أو مورد) أو رقم السند أو رقم المرجع.
- **ACC-201** — **Steps**: لاحظ عمود "المبلغ". **Assert**: سندات الاستلام (تحصيل، إيراد آخر...) تُعرض بإشارة "+" ولون أخضر؛ سندات الصرف (دفع لمورد، مصروف آخر...) بإشارة "−" ولون أحمر؛ سندات التحويل بلا إشارة ولون محايد.
- **ACC-202** — **Steps**: لاحظ عمود "حساب الخزينة" لسند تحويل بين خزينتين. **Assert**: يُعرض كـ"{من} ← {إلى}" في خلية واحدة.
- **ACC-203** — **Steps**: اضغط "سند جديد". **Assert**: تظهر شبكة اختيار نوع (11 بطاقة)، كل بطاقة بعنوان عربي وجملة توضيحية فرعية مطابقة تماماً للتعريفات: تحصيل من عميل، دفع لمورد، رد مبلغ لعميل، دفعة مقدمة من عميل مقاولات، استرداد من مورد، إيراد آخر، مصروف آخر، ضخ رأس مال من الشريك، سحب شخصي للشريك، دفع لمصلحة الضرائب، تحويل بين الخزائن.
- **ACC-204** — **Steps**: اختر "تحصيل من عميل". **Assert**: نموذج بحقول المبلغ*، طريقة الدفع* (نقدي/بنكي/شيك/بطاقة/محفظة إلكترونية، افتراضي نقدي)، حساب الخزينة*، العميل* (EntityPicker يبحث في العملاء الحقيقيين)، التاريخ*، رقم المرجع، ملاحظات. رابط "تغيير نوع السند" أعلى يعيد لشبكة الاختيار.
- **ACC-205** — **Steps**: اترك "المبلغ" فارغاً واضغط "إنشاء وتأكيد". **Assert**: الزر معطّل (canSubmit يتطلب مبلغاً > 0)، لا استدعاء شبكة.
- **ACC-206** — **Steps**: اختر عميلاً وأدخل مبلغاً، لكن اترك "حساب الخزينة" فارغاً (لو أمكن تفريغه). **Assert**: الزر يبقى معطّلاً.
- **ACC-207** — **Steps**: عبّئ كل الحقول المطلوبة لسند "تحصيل من عميل" بمبلغ 250.00، اضغط "إنشاء وتأكيد". **Assert**: يُنشأ السند **ويُؤكَّد في خطوة واحدة** (لا حفظ كمسودة منفصل على هذا النموذج)، ينتقل تلقائياً لقائمة السندات، السند الجديد يظهر بحالة "مؤكد" ورقم CV تسلسلي جديد؛ بطاقة "الإجمالي" و"مؤكد" تزدادان بمقدار 1.
- **ACC-208** — **Steps**: افتح تفاصيل السند الجديد. **Assert**: قسم "تأثيرات هذا السند" يعرض الجملتين المتوقعتين (استلام المبلغ في الخزينة/تحصيل من العميل)؛ ملخص يعرض النوع/التاريخ/طريقة الدفع/الطرف/المبلغ، وحقل "التخصيص" إضافي (السند قابل للتخصيص) بشارة "بحاجة لتخصيص" حمراء (لم يُخصَّص بعد) والمبلغ غير المخصص يساوي كامل مبلغ السند.
- **ACC-209** — **Steps**: بدّل لتبويب "تخصيص على الفواتير (0)". **Assert**: جدول فارغ "لا توجد تخصيصات بعد"؛ إن كان للعميل فواتير مفتوحة يظهر نموذج "تخصيص مبلغ على فاتورة" بقائمة فواتير حقيقية (رقم الفاتورة — متبقٍ X) وحقل مبلغ.
- **ACC-210** — **Steps**: اختر فاتورة مفتوحة، أدخل مبلغاً يساوي كامل مبلغ السند (250.00)، اضغط "تخصيص". **Assert**: يُضاف صف تخصيص جديد بنفس المبلغ، شارة الحالة تتحول إلى "مخصّص بالكامل" (خضراء)، "المتبقي غير المخصص" يصبح 0.00، وعنوان التبويب يتحدث إلى "(1)".
- **ACC-211** — **Steps**: على صف التخصيص الجديد اضغط "عكس التخصيص". **Assert**: الصف يختفي من الجدول (أو يتحول لحالة غير نشطة)، "المتبقي غير المخصص" يعود لكامل مبلغ السند، شارة الحالة تعود "بحاجة لتخصيص"، وحقول اختيار فاتورة/مبلغ تظهر مجدداً للتخصيص.
- **ACC-212** — **Steps**: بدّل لتبويب "القيود المحاسبية". **Assert `[مبسّط مقارنة بالمرجع]`**: يظهر نص وحيد "رُحّل هذا السند إلى قيد محاسبي متوازن — المعرّف: {رقم السند}" — **لاحظ الخلل النصي**: يعرض `docNo` للسند وليس رقم القيد الفعلي رغم أن التسمية "المعرّف" تلي جملة عن القيد. لا جدول حساب/مدين/دائن كما يصفه المرجع.
- **ACC-213** — **Steps**: ابحث عن أزرار "مشاركة"، "طباعة"، "إلغاء" (المزيد) في رأس تفاصيل السند. **Assert `[NOT IMPLEMENTED]`**: لا توجد — الإجراءات المتاحة فقط "رجوع" و(إن كان مؤكداً) "عكس السند".
- **ACC-214** — **Steps**: من تفاصيل السند المؤكد، اضغط "عكس السند". **Assert**: يُنشأ سند/قيد عكسي فوراً، السند الأصلي يتحول لحالة "معكوس"، يعود تلقائياً لقائمة السندات؛ افتح السند مجدداً: لا زر "عكس السند" (السلوك غير قابل للتفاوض: العكس لا يُعاد مرتين).
- **ACC-215** — **Steps**: افتح تفاصيل سند مُعكوس له تخصيصات كانت نشطة. **Assert**: التخصيصات النشطة انعكست تلقائياً كجزء من عملية عكس السند (المبلغ المتبقي على الفاتورة عاد لقيمته السابقة للسند) — تحقق ذلك من شاشة الفاتورة المرتبطة إن أمكن.
- **ACC-216** — **Pre**: اختر نوع "دفع لمورد" أو أي نوع صرف من حساب خزينة **نقدي** برصيد معروف. **Steps**: أدخل مبلغاً أكبر من رصيد الحساب النقدي الحالي، اضغط "إنشاء وتأكيد". **Assert**: يُرفض الإنشاء/التأكيد بخطأ خادم من فئة "الرصيد النقدي سيصبح سالباً" (`CashBalanceWouldGoNegativeError`) — ما لم تكن سياسة "منع الرصيد السالب" مُعطَّلة من الإعدادات، فوثّق الحالة الفعلية للسياسة في هذا المستأجر قبل الحكم على الفشل/النجاح.
- **ACC-217** — **Steps**: كرر نفس الاختبار السابق (ACC-216) على حساب خزينة **بنكي** بنفس المبلغ الزائد. **Assert**: يُقبل بلا اعتراض — الحارس يستثني الحسابات البنكية صراحة (يُسمح لها بالسحب على المكشوف).
- **ACC-218** — **Steps**: اختر "تحويل بين الخزائن"، اختر نفس الحساب في "من الخزينة" و"إلى الخزينة". **Assert**: الزر "إنشاء وتأكيد" يبقى معطّلاً (`counterTreasuryAccountId !== treasuryAccountId` شرط صريح) — لا يمكن تحويل الحساب لنفسه.
- **ACC-219** — **Steps**: اختر "إيراد آخر"، اختر الحساب المقابل من قائمة حسابات الإيرادات فقط. **Assert**: القائمة تعرض حسابات النوع "إيرادات" حصراً من دليل الحسابات الحقيقي (لا التزامات ولا مصروفات).
- **ACC-220** — **Steps**: اختر "مصروف آخر". **Assert**: القائمة المقابلة تعرض حسابات النوع "مصروفات" حصراً.
- **ACC-221** — **Steps (سيناريو حدّ الموافقة — غير قابل للتفاوض)**: بافتراض توفّر قاعدة موافقة مُعدّة على سندات الخزينة بمبلغ حدّي عبر «الإعدادات ← سير العمل» (خارج نطاق هذه الشاشة، شرط مسبق)، أنشئ سنداً بمبلغ يتجاوز الحد. **Assert**: عند "إنشاء وتأكيد"، السند يُنشأ لكن **حالته تبقى "بانتظار الموافقة" وليس "مؤكد"** رغم أن نص الزر يوحي بتأكيد فوري؛ الجدول ("تخصيص على الفواتير" إن كان قابلاً للتخصيص) لا يظهر تبويب التخصيص طالما لم يُؤكَّد؛ لا زر "تأكيد" يدوي إضافي متاح من هذه الواجهة لإتمام الاعتماد (يتطلب مسار الموافقات المنفصل `/approvals`) — وثّق الفجوة إن لم توجد طريقة لمتابعة الموافقة من هنا.
- **ACC-222** — **Pre**: أوقف الشبكة. **Steps**: حمّل قائمة السندات. **Assert**: بطاقة خطأ + إعادة محاولة.

---

### تسوية كشوف البنك — Bank Reconciliation

- **ACC-223** — **Pre**: افتح «الخزينة» ← «تسوية كشوف البنك». **Assert**: بما أن المستأجر يملك حساب خزينة بنكياً واحداً على الأقل، الشاشة **ليست فارغة بالضرورة** (خلافاً لبيانات المرجع الملتقطة على مستأجر بلا حسابات بنكية) — وثّق الحالة الفعلية (عدد الكشوف = 0 غالباً إن لم يُستورد كشف بعد، رغم وجود حساب بنكي صالح للاستيراد).
- **ACC-224** — **Steps**: اضغط "استيراد كشف بنك". **Assert**: لوحة جانبية بحقول: حساب الخزينة* (EntityPicker يعرض الحسابات البنكية النشطة فقط)، المصدر* (قائمة ثابتة "ملف CSV" فقط — لا خيارات أخرى فعلياً رغم أن التسمية "*" توحي بخيارات)، ملف الكشف* (رافع ملفات `accept=".csv,text/csv"`)، بداية الفترة*، نهاية الفترة*، الرصيد الافتتاحي*، الرصيد الختامي*، رقم الكشف (اختياري).
- **ACC-225** — **Steps**: اضغط "استيراد" بدون اختيار حساب خزينة ولا ملف. **Assert**: الزر معطّل (`canImport` يتطلب حساب خزينة + ملف + كل تواريخ/أرصدة الفترة + تعيين أعمدة مكتمل).
- **ACC-226** — **Steps**: ارفع ملف CSV صالحاً (يحتوي أعمدة تاريخ/بيان/مبلغ). **Assert**: يظهر اسم الملف تحت حقل الرفع، وقسم "تعيين الأعمدة *" يصبح قابلاً للفتح (زر "تعيين الأعمدة" لم يعد معطّلاً).
- **ACC-227** — **Steps**: افتح "تعيين الأعمدة". **Assert**: قوائم منسدلة لكل حقل قياسي (عمود التاريخ*، عمود البيان*، عمود المبلغ بإشارة، عمود المدين، عمود الدائن، عمود المرجع، صيغة التاريخ) وخيارات كل قائمة هي رؤوس أعمدة الملف المرفوع فعلياً (وليست نصاً ثابتاً).
- **ACC-228** — **Steps**: عيّن عمود التاريخ وعمود البيان فقط، بدون عمود المبلغ ولا عمودي مدين/دائن. **Assert**: زر "استيراد" النهائي يبقى معطّلاً — التعيين "مكتمل" يتطلب إما عمود مبلغ بإشارة **أو** عمودَي مدين ودائن معاً.
- **ACC-229** — **Steps**: أكمل التعيين (عمود مبلغ بإشارة)، عبّئ بداية/نهاية الفترة والأرصدة، اضغط "استيراد". **Assert**: يُنشأ كشف جديد بحالة "مستورد" (imported)، تُفتح لوحة مطابقة الكشف تلقائياً (`onImported`)، والكشف يظهر في القائمة الرئيسية.
- **ACC-230** — **Pre**: استورد كشفاً لنفس الحساب البنكي مرة أخرى لاحقاً. **Steps**: افتح "استيراد كشف بنك" واختر نفس الحساب البنكي. **Assert**: حقول التعيين تُعبَّأ تلقائياً من التعيين المحفوظ سابقاً لهذا الحساب (`useStatementColumnMapping`) — لا حاجة لإعادة تعيين الأعمدة يدوياً.
- **ACC-231** — **Steps**: في لوحة مطابقة الكشف المفتوحة، لاحظ بطاقات "الرصيد الافتتاحي/الرصيد الختامي/مطابَق/نسبة المطابقة". **Assert**: "مطابَق" يعرض "N / M" (عدد مطابق من إجمالي السطور)، و"نسبة المطابقة" = N/M مقرّبة كنسبة مئوية.
- **ACC-232** — **Steps**: اضغط "مطابقة تلقائية". **Assert**: يحاول النظام مطابقة السطور غير المطابقة تلقائياً بمعاملات النظام؛ الأرقام في "مطابَق"/"نسبة المطابقة" تتحدث فوراً؛ أي سطر تمت مطابقته يعرض الآن "القيد: {معرّف}" وزر "إلغاء المطابقة" بدلاً من حقل الإدخال اليدوي.
- **ACC-233** — **Steps**: على سطر غير مطابَق، أدخل "معرّف القيد" يدوياً بمعرّف قيد فعلي، اضغط "مطابقة". **Assert**: السطر ينتقل لحالة "مطابَق"، عدّاد "مطابَق N/M" يزداد بمقدار 1.
- **ACC-234** — **Steps**: اضغط "مطابقة" بحقل "معرّف القيد" فارغاً. **Assert**: الزر معطّل (`entryIdDraft.trim() === ""` يمنع الإرسال).
- **ACC-235** — **Steps**: على سطر مطابَق، اضغط "إلغاء المطابقة". **Assert**: يعود السطر لحالة "غير مطابَق" مع حقل الإدخال اليدوي، وعدّاد المطابقة ينقص بمقدار 1.
- **ACC-236** — **Steps**: اضغط "إنهاء التسوية". **Assert**: حالة الكشف تتحول إلى "منتهية" (completed)، والمتغيّر `locked` يصبح صحيحاً.
- **ACC-237** — **Steps**: بعد الإنهاء، حاول "مطابقة تلقائية" أو "إلغاء المطابقة" أو تعديل "معرّف القيد" على أي سطر. **Assert**: كل هذه الإجراءات **معطّلة** الآن (`disabled={locked || ...}`) — كشف "منتهية" مقفل ضد أي تعديل إضافي على المطابقة.
- **ACC-238** — **Steps**: من القائمة الرئيسية، لاحظ عمود "نسبة المطابقة" لكشف لم يُفتح بعد في هذه الجلسة. **Assert**: يعرض "—" (وليس رقماً وهمياً) — النسبة الحقيقية تُعرف فقط للكشف المفتوح حالياً في اللوحة الجانبية؛ افتحه فيظهر الرقم الفعلي.
- **ACC-239** — **Steps**: صفِّ القائمة الرئيسية بـ"حساب الخزينة" لحساب لا كشوف له. **Assert**: القائمة فارغة "لا توجد كشوف بنك بعد".
- **ACC-240** — **Steps**: صفِّ بنطاق تاريخ ("من"/"إلى") لا يشمل أي كشف. **Assert**: القائمة فارغة، دون خطأ.

---

### سجل الشيكات — Cheque Register

- **ACC-241** — **Pre**: افتح «الأوراق المالية» ← «سجل الشيكات». **Assert**: بطاقات إجمالي الشيكات (5)، إجمالي القيمة، قيد الانتظار، مودع — تحقق أن قيد الانتظار = مجموع مبالغ الشيكات بحالة "pending" فقط.
- **ACC-242** — **Steps**: تبويبات الحالة السبعة "الكل/قيد الانتظار/تحت التحصيل/المستحقة اليوم/مودع/محصل/مرتد/مستبدل". **Assert**: كل تبويب يعكس `effectiveStatus` **المحسوب من الخادم** (لا يعاد حسابه في العميل)؛ تحقق أن شيك CHQ-DEMO-3 (رقم 0451238، وارد) يظهر تحديداً تحت تبويب "مرتد".
- **ACC-243** — **Steps**: صفِّ الاتجاه = "واردة". **Assert**: يظهر فقط 3 شيكات واردة (CHQ-DEMO-1/2/3، أرقام 0451236/0451237/0451238)؛ "صادرة" تعرض شيكين (9002014/9002015).
- **ACC-244** — **Steps**: ابحث "بحث برقم الشيك..." عن "0451238". **Assert**: يظهر صف الشيك المرتد فقط.
- **ACC-245** — **Steps**: افتح صف الشيك المرتد (CHQ-DEMO-3) عبر زر "إجراءات". **Assert**: تُفتح لوحة جانبية بعنوان "شيك 0451238"، وسم حالة "مرتد" أحمر، بيانات الجهة/البنك/تاريخ الاستحقاق/المبلغ، ونص "لا توجد إجراءات متاحة على هذا الشيك." — بما أن الاتجاه "واردة"، توقّع بدلاً من ذلك زر "استبدال الشيك" (راجع legalActions: incoming+bounced ⇒ ["replace"]).
- **ACC-246** — **Steps**: على شيك CHQ-DEMO-3 (وارد، مرتد)، اضغط "استبدال الشيك". **Assert**: يُستدعى الاستبدال بإنشاء شيك جديد تلقائياً برقم "{الرقم الأصلي}-R"، بنفس بيانات البنك والفرع، بتاريخ إصدار اليوم واستحقاق +30 يوماً؛ الشيك الأصلي ينتقل لحالة "مستبدل" ("replaced")؛ تُغلق اللوحة الجانبية (`setSelectedId(null)`).
- **ACC-247** — **Steps**: افتح الشيك الجديد الناتج عن الاستبدال. **Assert**: حالته "pending" (تظهر تحت "قيد الانتظار")، رقمه ينتهي بـ"-R"، ومبلغه مطابق تماماً للشيك الأصلي.
- **ACC-248** — **Pre**: أنشئ (أو استخدم) شيكاً **صادراً** مرتداً (خارج بيانات البذرة الحالية، حيث لا شيك صادر مرتد مزروع — يتطلب هذا اختباراً تحضيرياً منفصلاً لإرجاع شيك صادر). **Steps**: افتح تفاصيله بعد الارتداد. **Assert (فجوة سلوكية مقصودة، وثّقها لا تُصلحها)**: `legalActions` تُرجع مصفوفة فارغة للشيكات الصادرة المرتدة (`direction === "outgoing" ⇒ []`) — يظهر نص "لا توجد إجراءات متاحة على هذا الشيك." **دائماً**، بلا أي وسيلة من هذه الشاشة لاستبدال شيك صادر مرتد (خلافاً لما قد يُفهم من حالة "مستبدل" العامة في قائمة الحالات السبع التي تبدو غير مقيّدة بالاتجاه).
- **ACC-249** — **Steps**: على شيك "قيد الانتظار" وارد (CHQ-DEMO-1)، اضغط "إجراءات" ← "إيداع في البنك". **Assert**: ينتقل الشيك مباشرة لحالة "مودع" (لا قيد محاسبي يُرحَّل عند هذه الخطوة تحديداً — "status-only")، ويُربط بأول حساب خزينة بنكي نشط تلقائياً (`bankTreasuryAccounts[0]`، لا اختيار يدوي للحساب من هذه الواجهة!). **Assert `[NOT IMPLEMENTED]` محتمل**: لا يوجد اختيار صريح لحساب البنك المودَع فيه من الواجهة — يُختار أول حساب بنكي نشط تلقائياً دون تأكيد، وإن وُجد أكثر من حساب بنكي نشط فلا سيطرة للمستخدم على أيّهما يُستخدم.
- **ACC-250** — **Steps**: على شيك "مودع" (بعد ACC-249)، اضغط "إجراءات" ← "تأكيد التحصيل". **Assert**: تنتقل الحالة إلى "محصل"، ويُرحّل قيد محاسبي يُدين حساب البنك ويُدائن "شيكات تحت التحصيل" (1320) — تحقق من دليل الحسابات أن رصيد 1320 نقص بمقدار مبلغ الشيك ورصيد 1310 (أو الحساب البنكي) زاد بنفس المقدار بالضبط.
- **ACC-251** — **Steps**: على شيك "مودع" آخر (كرر ACC-249 على شيك آخر إن توفّر، أو أعد الاختبار على بيئة نظيفة)، اضغط "إجراءات" ← "تسجيل ارتداد" (**السيناريو الأهم — غير قابل للتفاوض**). **Assert (فحص حسابي إلزامي)**: قبل الارتداد، سجّل رصيد حساب "1320 شيكات تحت التحصيل" من دليل الحسابات. نفّذ الارتداد. **Assert**: (أ) حالة الشيك تتحول لـ"مرتد"؛ (ب) يُرحّل قيد محاسبي جديد متوازن (Dr 1360 شيكات مرتجعة / Cr 1320 شيكات تحت التحصيل)؛ (ج) رصيد 1320 **يعود بالضبط** إلى ما كان عليه قبل إيداع هذا الشيك تحديداً (الأثر الصافي لدورة إيداع+ارتداد على 1320 = صفر)؛ (د) رصيد 1360 يزداد بمقدار مبلغ الشيك بالضبط — أي أن "رصيد الطرف" الإجمالي (مجموع 1105+1320+1360 المنسوب لهذا العميل) يبقى ثابتاً طوال الدورة (لم يُفقد ولم يُضاعف أي مبلغ)، وهذا هو معنى "الارتداد ينعكس بنظافة ويعيد رصيد الطرف لقيمته السابقة".
- **ACC-252** — **Steps**: على شيك "pending" **بدون** أي حساب خزينة بنكي نشط متاح في المستأجر (حالة افتراضية إن أُلغي تنشيط كل الحسابات البنكية). **Steps**: اضغط "إيداع في البنك". **Assert**: خطأ عميل واضح "لا يوجد حساب خزينة بنكي نشط لإيداع الشيك فيه." يظهر في شريط التنبيه — لا استدعاء شبكة فاشل صامت.
- **ACC-253** — **Steps**: اضغط "شيك جديد". **Assert**: صفحة كاملة (وليست لوحة جانبية) بعنوان "شيك جديد"، بطاقتا اختيار اتجاه كبيرتان "واردة — شيك مستلم من عميل" و"صادرة — شيك صادر لمورد".
- **ACC-254** — **Steps**: اختر "واردة". **Assert**: يظهر حقل "العميل *" (EntityPicker يبحث في العملاء الحقيقيين، وليس الموردين) أسفل بطاقتي الاتجاه مباشرة.
- **ACC-255** — **Steps**: بدّل الاتجاه من "واردة" إلى "صادرة" بعد اختيار عميل. **Assert**: حقل الطرف يتحول لـ"المورّد *" ويُصفَّر الاختيار السابق (`setPartyId("")`) — لا يبقى معرّف عميل محفوظاً بالخطأ في حقل مورد.
- **ACC-256** — **Steps**: عبّئ رقم الشيك، اسم البنك، المبلغ، تاريخ الإصدار، تاريخ الاستحقاق لكن اترك "الفرع" فارغاً، اضغط "حفظ الشيك". **Assert**: الزر معطّل (الفرع مطلوب ضمن `canSubmit`).
- **ACC-257** — **Steps**: أكمل كل الحقول المطلوبة لشيك وارد جديد بمبلغ 750.00، احفظ. **Assert**: يُنشأ الشيك بحالة "pending"، يُرحّل قيد إنشاء يُدين "شيكات تحت التحصيل" (1320) ويُدائن حساب الذمم (1105) بمبلغ 750.00 بالضبط (تحقق من دليل الحسابات).
- **ACC-258** — **Steps**: أنشئ شيكاً صادراً بنفس البيانات. **Assert**: القيد المقابل يُدين الذمم الدائنة (2100) ويُدائن "شيكات صادرة" (2150) — عكس اتجاه الشيك الوارد تماماً.
- **ACC-259** — **Steps**: حاول إنشاء شيك برقم مكرر لشيك وارد موجود بالفعل بنفس الاتجاه (مثلاً "0451236" مجدداً واردة). **Assert**: خطأ خادم `DuplicateChequeNumberError` يظهر في شريط التنبيه — لا يُنشأ الشيك المكرر.
- **ACC-260** — **Steps**: أنشئ شيكاً صادراً بنفس رقم شيك وارد موجود (رقم الشيك مكرر لكن الاتجاه مختلف). **Assert**: يُقبل — التكرار يُفحص لكل زوج (اتجاه، رقم شيك) وليس رقم الشيك وحده عالمياً.
- **ACC-261** — **Steps**: من القائمة، صفِّ بنطاق تاريخ ("من تاريخ"/"إلى تاريخ") لا يشمل أي شيك. **Assert**: القائمة فارغة، البطاقات تعكس فقط الشيكات المصفّاة من الخادم (وليس الإجمالي العام) — تحقق أن الأرقام تتغيّر مع الفلتر وليست ثابتة عند التحميل الأول.
- **ACC-262** — **Pre**: أوقف الشبكة. **Steps**: حمّل القائمة. **Assert**: بطاقة خطأ + إعادة محاولة.

---

### ملخص التغطية

هذا الملف يغطي 18 شاشة (نظرة عامة المحاسبة، دليل الحسابات، مراكز التكلفة، أرباح مراكز
التكلفة، القيود المحاسبية، الفترات المالية، الضرائب، أسعار الصرف، إعادة تقييم العملات
الأجنبية، مطابقة الأرصدة، الفاتورة الإلكترونية، ميزان المراجعة المستقل، التقارير المالية
بتبويباتها السبعة، نظرة عامة الخزينة، حسابات الخزينة، السندات النقدية، تسوية كشوف البنك،
سجل الشيكات) بـ262 سيناريو مرقّماً (ACC-001…ACC-262).

#### فجوات `[NOT IMPLEMENTED]` الموثّقة (مقابل المرجع)

1. **دليل الحسابات**: حركات الحساب وسجل التدقيق في اللوحة الجانبية عنصر نائب ثابت — لا رصيد حقيقي، لا جدول حركات، لا رابط لقيد المصدر (ACC-024/025). لا حقل "التصنيف الفرعي" في نموذج الإضافة (ACC-016). لا زر "فتح في صفحة كاملة" ولا قائمة كباب لكل صف (ACC-027).
2. **مراكز التكلفة**: لا زر "إنشاء من الأقسام" (ACC-033). لا حقلَي "القسم"/"الفرع" في نموذج الإنشاء/التعديل رغم وجودهما في الكيان (ACC-036).
3. **أرباح مراكز التكلفة**: لا فلتر مركز تكلفة فردي، لا تصدير (ACC-049/050).
4. **القيود المحاسبية**: لا فلتر تاريخ/وحدة مصدر على القائمة، لا زر طباعة، لا عمود "الوحدة المصدر"/"بواسطة" (ACC-054/056). حقل "المصدر" في التفاصيل ثابت دوماً على "يدوي" حتى للقيود المولّدة آلياً (ACC-057). لا تبويبَي مرفقات/سجل مراجعة (ACC-060). حقل تاريخ القيد صندوق نص وليس منتقي تاريخ، ولا حقل عملة (ACC-065).
5. **أسعار الصرف**: نموذج الإضافة بلا حقلَي "نوع السعر" و"المصدر" و"ملاحظات" (ACC-106).
6. **مطابقة الأرصدة**: لا صف "الخزينة مقابل دفتر الأستاذ" (فقط مخزون/ذمم عملاء/ذمم موردين)، لا drill-down من الصفوف (ACC-124/125).
7. **الفاتورة الإلكترونية**: لا تبويبات (عام/بيانات الربط/ربط الأصناف/ربط الوحدات) — شاشة واحدة مسطحة؛ لا نموذج لتعديل بيانات التسجيل الضريبي أو بيانات الربط إطلاقاً (ACC-131).
8. **حسابات الخزينة**: لا صفحة/لوحة كشف حساب فعلية (حركات، طباعة، إضافة رصيد افتتاحي لاحق) — عنصر نائب ثابت (ACC-193).
9. **السندات النقدية**: تبويب "القيود المحاسبية" في التفاصيل نص وحيد (لا جدول)، ويعرض `docNo` السند بدل رقم القيد (ACC-212). لا أزرار مشاركة/طباعة/إلغاء في رأس التفاصيل (ACC-213).
10. **سجل الشيكات**: لا اختيار يدوي لحساب البنك عند الإيداع — يُختار أول حساب نشط تلقائياً (ACC-249). لا إجراء "استبدال" متاح لشيك صادر مرتد من هذه الشاشة (ACC-248).
11. **الخزينة (نظرة عامة)**: عدد اختصارات البدء السريع الفعلي أقل من الخمسة التي يصفها المرجع — تحقق العدد الدقيق (ACC-180).
12. **التقارير المالية**: لا فلتر "الفرع" ولا "مقارنة بالعام الماضي" على تبويب الميزانية العمومية والتدفقات النقدية وقائمة الدخل (الأخيرة لديها مقارنة لكن بلا فلتر فرع) (ACC-149/156/166).

#### فروق إيجابية (البناء أشمل من التقاط المرجع، وليست عيوباً)

- كل السبعة تبويبات في التقارير المالية تُصدِّر CSV **و** Excel دائماً (المرجع رصد جزئياً فقط بسبب عدم تشغيل تبويبَي دفتر الأستاذ العام ودفتر حساب في تلك الجلسة).
- تسوية كشوف البنك مطبّقة بالكامل (استيراد CSV، تعيين أعمدة محفوظ لكل حساب، مطابقة تلقائية/يدوية، إنهاء وقفل) — المرجع لم يتمكن من رصدها لعدم وجود حسابات بنكية في بيانات التقاطه.
- «المحاسبة» و«الخزينة» كصفحتي نظرة عامة (Hub) مرتبطتان فعلياً من الشريط الجانبي في هذا البناء (`accounting-hub`/`treasury-hub` ضمن `nav-config.ts`)، خلافاً لملاحظة المرجع أنهما غير مرتبطتين.

#### عيوب معروفة أُشير إليها فقط (لا تُعَد اكتشافاً جديداً)

- **D1** (مطابقة الأرصدة تُظهر عدم تطابق ذمم العملاء بسبب سند تحصيل لا يحدّث `amountPaid`): ACC-120/121.
- **D5** (قائمة إرسال الفاتورة الإلكترونية بلا مُنتِج — فارغة دوماً): ACC-132.

---

# 9. HR and payroll


Sources: `docs/archive/catalog/06-crm-hr.md` (HR half, captured from the reference product on an
almost-empty tenant) cross-checked against the actual build —
`apps/web/src/screens/{Employees,Departments,JobTitles,Contracts,Attendance,Holidays,
LeaveRequests,LeavePolicies,LeaveBalances,LeaveAccrualBatches,PayrollRuns,
EmployeeAdvances,HrDashboard,MyLeave}Screen.tsx`, `apps/web/src/nav-config.ts`, and the
domain layer (`packages/domain/src/hr/*.ts`) that backs every rule asserted below.
Every screen in this file is reached from the **الموارد البشرية** nav group except
إجازاتي (`my-leave`), which is in the same nav group but is the logged-in user's own
self-service view, not an admin list.

**Seed reference** (`packages/backend/src/demo-seed/hr.ts`, "today" = 2026-08-24):
6 departments (`الإدارة العامة` parent, 5 children), 8 job titles, 9 employees, 10
contracts, 12 holidays, 8 leave policies (preset `EG_LABOUR_LAW_14_2025` + 2 manual
rows), 11 leave requests, 4 accrual batches, 5 advances, 3 payroll runs × 7 payslips.
Employee codes below (`EMP-0001`..`EMP-0009`) assume strict creation order (the two
core salespeople first, then `EMP-DEMO-3..9`) — confirm against the live system if a
different seed profile changed that order.

| Internal id | Code (assumed) | Name | Dept / title | Status | Contract |
|---|---|---|---|---|---|
| EMP-DEMO-1 | EMP-0001 | كريم عادل | مبيعات / مشرف مبيعات | نشط | ECT-DEMO-1, غير محدد المدة، 9,000 |
| EMP-DEMO-2 | EMP-0002 | سلمى فؤاد | مبيعات / مندوب مبيعات | نشط | ECT-DEMO-2 (منتهي، مفسوخ فعلياً بالتاريخ) + ECT-DEMO-3 (الساري)، 7,800 |
| EMP-DEMO-3 | EMP-0003 | محمد الشهابي | الإدارة العامة / مدير عام | نشط | ECT-DEMO-4، 18,000، إجازة سنوية override 30 يوم |
| EMP-DEMO-4 | EMP-0004 | هدى مصطفى | الموارد البشرية / أخصائي موارد بشرية | **في إجازة** | ECT-DEMO-5، 7,500 |
| EMP-DEMO-5 | EMP-0005 | أحمد الشناوي | الحسابات / محاسب | نشط | ECT-DEMO-6، 8,200 |
| EMP-DEMO-6 | EMP-0006 | مصطفى رزق | الإنتاج / مشرف إنتاج | نشط (تجربة انتهت 2026-04-30) | ECT-DEMO-7 محدد المدة حتى 2027-01-31، 6,800 |
| EMP-DEMO-7 | EMP-0007 | ياسمين حجازي | المخازن / أمين مخزن | نشط، **تجربة تنتهي 2026-08-31** | ECT-DEMO-8 تجريبي حتى 2026-08-31، 5,600 |
| EMP-DEMO-8 | EMP-0008 | عمرو الديب | الإنتاج / عامل إنتاج | **موقوف** | ECT-DEMO-9 موسمي، **بالساعة**، حتى 2026-11-09، 4,200 |
| EMP-DEMO-9 | EMP-0009 | نورهان سليم | مبيعات / مندوب مبيعات | **منتهية خدمته** | ECT-DEMO-10 مفسوخ |

Payroll runs: June 2026 = **مصروف** (7 موظف، 70,950.00 إجمالي، 1,200.00 استقطاعات،
69,750.00 صافي). July 2026 = **معتمد** (70,950.00 إجمالي، صافي ≈ 69,282.26 بعد خصم
إجازة عمرو... لا، **مصطفى رزق** بدون أجر ليومين). August 2026 = **محتسب** فقط
(70,950.00 إجمالي، 2,200.00 استقطاعات، 68,750.00 صافي). All three exclude عمرو الديب
(hourly contract) with a named warning; all three show 7 payslips.

Advances: ADV-DEMO-1 (كريم، 6,000/6، **مصروفة**، 2/6 مسدد، متبقي 4,000.00) · ADV-DEMO-2
(أحمد، 4,000/4، **مصروفة**، 0/4 مسدد) · ADV-DEMO-3 (سلمى، 2,400/2، **معتمدة**) ·
ADV-DEMO-4 (هدى، 3,000/3، **بانتظار الاعتماد**) · ADV-DEMO-5 (مصطفى، 10,000/10،
**مرفوضة**). No advance in the seed currently reaches **مسددة** — see AD-01.

Money is scaled-integer everywhere; no scenario below asserts a computed tax or
insurance figure — the engine computes none (see PR-01..PR-12). Screens run
Arabic-first RTL by default; an English/LTR toggle exists at the app-shell level and
is not re-tested per HR screen. `ROADMAP.md` §5 has no currently-open HR-specific
defect (D1–D6 are Treasury/Inventory/Manufacturing/E-invoicing/Webhooks) — none of the
scenarios below cite a D-number.

---

### 1. لوحة الموارد البشرية — HR Dashboard (`hr-dashboard`)

`HrDashboardScreen.tsx` is a pure read-only dashboard: no filters, no buttons besides
retry, no forms.

- **HR-01 — KPI tiles render from the live employee roster.**
  Pre: seeded tenant, "today" 2026-08-24. Steps: افتح «الموارد البشرية → لوحة الموارد
  البشرية». Assert: «الموظفون النشطون» = **6** (نشط فقط: كريم، سلمى، محمد، أحمد،
  مصطفى، ياسمين — لا يشمل هدى «في إجازة» ولا عمرو «موقوف»)؛ «في إجازة» = **1** (هدى)؛
  «التعيينات هذا الشهر» و«إنهاء الخدمة هذا الشهر» يعتمدان على تاريخ اليوم الفعلي —
  تحقق أنهما رقمان غير سالبين متسقان مع عدد من `hireDate`/`terminatedAt` يقعان داخل
  الشهر الحالي، لا رقماً ثابتاً.

- **HR-02 — Contracts-expiring-soon tile, danger tone, matches the 30-day window.**
  Pre: كما سبق. Steps: انظر بطاقة «عقود تنتهي خلال 30 يوماً». Assert: القيمة = **1**
  (فقط ECT-DEMO-8 — ينتهي 2026-08-31، بعد 7 أيام؛ ECT-DEMO-2 منتهٍ فعلاً فلا يُحتسب
  «قريب الانتهاء»، وECT-DEMO-7/ECT-DEMO-9 بعيدان)؛ لون القيمة **أحمر (danger)** لأن
  العدد > 0.

- **HR-03 — Probation-ending-soon tile, danger tone.**
  Steps: انظر بطاقة «انتهاء الفترة التجريبية قريباً». Assert: القيمة = **1** (ياسمين
  حجازي، `probationEndDate` 2026-08-31؛ مصطفى رزق تجربته انتهت بالفعل في 2026-04-30
  فلا يُحتسب)؛ لون أحمر.

- **HR-04 — Department donut chart.**
  Steps: انظر مخطط «الموظفون حسب القسم». Assert: 6 قطاعات بعدد الأقسام الفعلي (كل قسم
  يظهر بعدد الموظفين غير المنتهية خدمتهم فيه: الإدارة العامة=1، المبيعات=2، الموارد
  البشرية=1، الحسابات=1، الإنتاج=2، المخازن=1)؛ التسمية المركزية = عدد الموظفين
  النشطين الظاهر في HR-01، وليس مجموع الأقسام (8 غير-منتهي).

- **HR-05 — Branch donut chart.**
  Steps: انظر مخطط «الموظفون حسب الفرع». Assert: قطاع واحد لكل فرع مسجَّل عليه موظفون؛
  اسم الفرع يُحل عبر `useBranches()` لا يظهر كمعرّف خام.

- **HR-06 — Leave-consumption table columns.**
  Steps: انظر جدول «استهلاك الإجازات» أسفل الصفحة. Assert: الأعمدة **نوع الإجازة /
  المستخدم / قيد الانتظار** فقط — لا يوجد عمود «المستحق» ولا عمود «%» رغم أن الكتالوج
  وصف أربعة أعمدة؛ **`[NOT IMPLEMENTED]`** بالمقارنة مع الكتالوج: عمودا المستحق و%.

- **HR-07 `[NOT IMPLEMENTED]` — Absence rate / lateness / overtime KPI tiles.**
  Assert: لا توجد بطاقة «معدل الغياب»، ولا «حالات التأخر»، ولا «ساعات الإضافي» في أي
  مكان بالشاشة، رغم ورودها في الكتالوج كأربع بطاقات إضافية.

- **HR-08 `[NOT IMPLEMENTED]` — Payroll trend chart.**
  Assert: لا يوجد مخطط «تطور الرواتب (آخر 6 أشهر)» في الشاشة المطبَّقة.

- **HR-09 `[NOT IMPLEMENTED]` — "No attendance this week" alert & clickable alert chips.**
  Assert: لا توجد بطاقة «موظفون بدون حضور هذا الأسبوع». الأربع بطاقات الموجودة
  (الموظفون النشطون / في إجازة / التعيينات / إنهاء الخدمة) وبطاقتا التنبيه ليست قابلة
  للنقر — لا `onClick` على أي `StatCard`، خلافاً لوصف الكتالوج لها كـ"filter chips"
  قابلة للنقر تنقل لعرض مُصفّى.

- **HR-10 — Load-error path.**
  Pre: أوقف/أفشل `GET /api/hr/dashboard` (محاكاة انقطاع الشبكة). Steps: افتح لوحة
  الموارد البشرية. Assert: بطاقة حمراء «تعذّر تحميل بيانات لوحة الموارد البشرية.» +
  زر «إعادة المحاولة»؛ الضغط عليه يعيد `query.refetch()`؛ باقي الصفحة (البطاقات) تُظهر
  أصفاراً بدل الانهيار.

---

### 2. الموظفون — Employees (`employees`)

`EmployeesScreen.tsx`. List + search + status chips + department filter + a create
side panel (no create-employee **full page**, contra the catalog — see EM-27) + a
combined detail/action side panel (no tabs — see EM-24).

#### List & filters

- **EM-01 — Default list load.** Pre: تسجيل دخول. Steps: افتح «الموارد البشرية →
  الموظفون». Assert: 9 صفوف؛ عمود «اسم الموظف» يعرض الاسم العربي متبوعاً بالكود بخط
  أصغر؛ لا عمود قابل للفرز (لا سهم ترتيب على أي عنوان عمود).

- **EM-02 — Free-text search by name.** Steps: اكتب «رزق» في «بحث بالاسم أو الرقم...».
  Assert: يتبقى صف مصطفى رزق فقط؛ البحث غير حسّاس لحالة الأحرف ويطابق الاسم العربي أو
  الكود.

- **EM-03 — Free-text search by code, no match.** Steps: اكتب «EMP-9999». Assert:
  الجدول فارغ، رسالة «لا توجد بيانات».

- **EM-04 — Status chip «الكل».** Assert: العدّاد = 9، مطابق لعدد الصفوف.

- **EM-05 — Status chip «نشط».** Steps: اضغط تبويب «نشط». Assert: 6 صفوف (كريم، سلمى،
  محمد، أحمد، مصطفى، ياسمين)؛ لا هدى ولا عمرو ولا نورهان.

- **EM-06 — Status chip «في إجازة».** Assert: صف واحد — هدى مصطفى فقط.

- **EM-07 — Status chip «موقوف».** Assert: صف واحد — عمرو الديب فقط.

- **EM-08 — Status chip «منتهية خدمته».** Assert: صف واحد — نورهان سليم فقط.

- **EM-09 — Department filter «القسم».** Steps: اختر «الإنتاج» من قائمة الأقسام.
  Assert: صفّان — مصطفى رزق وعمرو الديب؛ الفلتر يعمل بالـAND مع فلتر الحالة والبحث.

- **EM-10 — Department filter default.** Assert: القيمة الافتراضية «جميع الأقسام».

- **EM-11 — Summary strip counts.** Assert: «إجمالي الموظفين»=9، «الموظفون
  النشطون»=6، «في إجازة»=1، «موقوفون»=1، «المنتهية خدمتهم»=1؛ الأرقام لا تتغير مع
  الفلاتر (تُحسب من كامل القائمة غير المصفّاة).

- **EM-12 — Pagination is inert.** Assert: `page=1 pageCount=1` مضروبان بثبات — لا
  يظهر أي عنصر ترقيم صفحات مهما كان عدد الصفوف؛ نص «عرض 9 من 9 موظف» أسفل الجدول.

- **EM-13 — List load error.** Pre: أفشل `GET /api/hr/employees`. Assert: بطاقة حمراء
  «تعذّر تحميل الموظفين.» + «إعادة المحاولة».

#### Create employee (side panel «موظف جديد»)

- **EM-14 — Header action opens the panel.** Steps: اضغط «إضافة موظف». Assert: لوحة
  جانبية بعنوان «موظف جديد» ووصف «بيانات الموظف الأساسية» تنزلق من الحافة اليمنى
  (RTL)؛ `role="dialog"`.

- **EM-15 — Required-field guard.** Steps: اترك الاسم الأول/اسم العائلة/الفرع/تاريخ
  التعيين فارغة، اضغط «حفظ». Assert: لا إرسال؛ شريط أحمر «الاسم الأول واسم العائلة
  والفرع وتاريخ التعيين مطلوبة.» (رسالة واحدة مجمّعة، لا أخطاء لكل حقل).

- **EM-16 — Personal-info section fields.** Steps: املأ الاسم الأول «سارة»، اسم
  العائلة «محمود»، الاسم الأول (عربي) «سارة»، اسم العائلة (عربي) «محمود»، البريد
  الإلكتروني (نوع `email`)، الهاتف (نوع `tel`)، تاريخ الميلاد (نص حر بصيغة
  `YYYY-MM-DD` بدون تحقق فعلي)، رقم الهوية، الجنس «أنثى»، الحالة الاجتماعية «أعزب».
  Assert: كل حقل يقبل القيمة ويُحفظ عبر `PUT`/`POST` كما أُدخل — لا رفض على تاريخ
  ميلاد غير صالح شكلياً (مثل `99-99-9999`) لأنه حقل نصي بلا تحقق.

- **EM-17 — Department → job-title dependency.** Steps: اختر القسم «الإنتاج» من حقل
  «القسم» (EntityPicker). Assert: حقل «المسمى الوظيفي» يعرض فقط «مشرف إنتاج» و«عامل
  إنتاج» (مسميات قسم الإنتاج)؛ عند تغيير القسم إلى «المبيعات» يُعاد ضبط المسمى
  الوظيفي المختار سابقاً إلى فارغ تلقائياً.

- **EM-18 — Job-title picker empty before department chosen.** Steps: افتح نموذج
  جديد، لا تختر قسماً، افتح قائمة «المسمى الوظيفي». Assert: القائمة فارغة، نص «لا
  توجد نتائج» — الحقل ليس معطّلاً شكلياً (`disabled`) لكنه عملياً بلا خيارات.

- **EM-19 — Manager / branch pickers.** Steps: اختر «المدير المباشر» = محمد الشهابي؛
  اختر «الفرع *». Assert: قائمة المدير تضم كل الموظفين التسعة (بلا استثناء نفسه أو
  الموظفين المنتهية خدمتهم)؛ الفرع مطلوب فعلياً (يُحجب الحفظ بدونه، EM-15).

- **EM-20 — Employment-info selects and numeric fields.** Steps: تحقق من «فئة العامل»
  (افتراضي «موظف»)، «نوع التوظيف» (افتراضي «دوام كامل»)، «احتساب العمل الإضافي»
  (افتراضي «حسب القسم» مع نص توضيحي عن الوراثة)، «ساعات العمل القياسية» (فارغة
  افتراضياً، تلميح «حسب القسم / المنشأة»)، «نهاية فترة التجربة» (نص حر)، «سنوات
  الخدمة السابقة» (رقمي، `min=0`، افتراضي 0، تلميح يذكر «المادة 47»). Assert: كل حقل
  يحمل القيمة الافتراضية الموصوفة؛ إدخال رقم سالب في «سنوات الخدمة السابقة» غير
  مرفوض من الواجهة (الـ`min` سمة HTML فقط، لا تحقق JS إضافي) — تحقق من سلوك المتصفح
  الفعلي وليس افتراض الرفض.

- **EM-21 — Attendance-security toggles.** Steps: بدّل «طلب صورة شخصية عند تسجيل
  الحضور» و«طلب التحقق بالبصمة عند تسجيل الحضور» (كلاهما إيقاف افتراضياً). Assert:
  التبديل يعمل ويُرسل `true`/`false` في الحمولة.

- **EM-22 — Address section — all-or-nothing submission.** Steps: املأ حقلاً واحداً
  فقط من «الشارع/المدينة/المحافظة/الرمز البريدي» (مثلاً المدينة فقط)، احفظ. Assert:
  الحمولة ترسل كائن `address` كاملاً (بقية الحقول فارغة داخله)؛ إن تُركت الأربعة
  فارغة تُرسل `address: null` تماماً لا كائن فارغ.

- **EM-23 — Emergency-contact section — same all-or-nothing rule.** Steps: كرر EM-22
  على قسم «جهة الاتصال في حالات الطوارئ». Assert: نفس السلوك — `emergencyContact:
  null` إن تُركت الحقول الأربعة فارغة بالكامل.

#### Employee detail panel

- **EM-24 `[NOT IMPLEMENTED]` — No tabbed hub.** Pre: من قائمة الموظفين. Steps: اضغط
  صف «محمد الشهابي». Assert: لوحة جانبية واحدة غير مبوّبة (لا `tablist`) تعرض بطاقة
  ملخص + قسم «المعلومات الشخصية» + قسم «العقود» فقط. **لا وجود** لعلامات التبويب
  الست التي وصفها الكتالوج (الإجازات / كشوف الرواتب / سلف الموظفين / الحضور /
  المرفقات / السجل) — أي بيانات إجازات/رواتب/سلف/حضور لهذا الموظف لا تُرى إلا من
  شاشاتها المستقلة، مصفّاة يدوياً باسم الموظف.

- **EM-25 — Detail panel content.** Steps: (كما سبق) على محمد الشهابي. Assert: شارة
  حالة «نشط»؛ بطاقة 2×3 تعرض القسم «الإدارة العامة»، المسمى «مدير عام»، الفرع، تاريخ
  التعيين «2023-01-02»، فئة العامل، احتساب العمل الإضافي؛ قسم معلومات شخصية (تاريخ
  الميلاد، الجنس، الحالة الاجتماعية، نوع التوظيف، نهاية فترة التجربة «—»، سنوات
  الخدمة السابقة «11»)؛ قسم العقود يعرض ECT-DEMO-4 برقمه وراتبه 18,000.00 ج.م.

- **EM-26 — Contracts sub-list empty state.** Pre: افتح موظفاً بلا عقود (لا يوجد في
  البذرة — استخدم موظفاً جديداً تم إنشاؤه في EM-14 قبل ربط عقد). Assert: نص «لا توجد
  عقود مرتبطة بهذا الموظف.»

- **EM-27 `[NOT IMPLEMENTED]` — Full-page create form / dedicated detail route.**
  Assert: لا يوجد تنقّل كامل الصفحة `/hr/employees/new` ولا `/hr/employees/{id}` كما
  وصف الكتالوج — كل شيء يحدث داخل لوحات جانبية (`SidePanel`) فوق شاشة القائمة نفسها.

- **EM-28 — Quick-view side panel from other screens.** `[NOT IMPLEMENTED]` — اسم
  الموظف في شاشات العقود/السلف/الرواتب نص ثابت غير قابل للنقر؛ لا توجد لوحة عرض سريع
  للموظف تُفتح من هناك رغم وصف الكتالوج لها.

#### Status transitions & termination

- **EM-29 — Valid transitions from «نشط».** Pre: افتح كريم عادل (نشط). Assert: يظهر
  زرا «في إجازة» و«موقوف» فقط ضمن كتلة الإجراءات — لا زر ينقله مباشرة إلى «منتهية
  خدمته» (ذلك عبر «إنهاء الخدمة» المستقل فقط).

- **EM-30 — Transition active → on_leave.** Steps: اضغط «في إجازة». Assert: الحالة
  تتحول فوراً، **بلا أي مربع تأكيد**؛ الشارة تتحدث لـ«في إجازة» (لون تحذيري)؛ الأزرار
  المتاحة الآن تصبح «نشط» و«موقوف».

- **EM-31 — Transition on_leave → suspended, then suspended → active only.** Pre:
  موظف «في إجازة». Steps: اضغط «موقوف»، ثم من نفس اللوحة اضغط على الموظف مجدداً.
  Assert: من حالة «موقوف» يظهر زر «نشط» فقط — لا زر يعيده مباشرة لـ«في إجازة» (يجب
  المرور بـ«نشط» أولاً).

- **EM-32 — Terminated employee has no action buttons.** Pre: نورهان سليم (منتهية
  خدمته). Steps: افتح لوحتها. Assert: كتلة الأزرار بالكامل غير ظاهرة — لا انتقال ولا
  «إنهاء الخدمة» (حالة نهائية).

- **EM-33 — «إنهاء الخدمة» — no confirmation dialog.** Pre: موظف نشط تجريبي (ليس أحد
  موظفي البذرة الأساسيين لتفادي كسر بذور أخرى). Steps: من قائمة «المزيد»/زر «إنهاء
  الخدمة»، اضغطه. Assert: الطلب يُرسل فوراً بلا أي `confirm()` أو حوار تأكيد؛ الحالة
  تتحول إلى «منتهية خدمته» وتصبح نهائية (EM-32).

- **EM-34 — Concurrent-click guard.** Steps: اضغط بسرعة زرّي انتقال متتاليين (أو نفس
  الزر مرتين) قبل استجابة الخادم. Assert: كل الأزرار تصبح `disabled` أثناء الطلب
  الأول (`pendingAction`)؛ لا طلب ثانٍ يُطلق حتى ينتهي الأول.

- **EM-35 — Transition/terminate error path.** Pre: أفشل نقطة الانتقال. Assert: شريط
  أحمر داخل اللوحة برسالة الخادم أو الافتراضي «تعذّر تحديث حالة الموظف.» / «تعذّر
  إنهاء خدمة الموظف.»؛ الحالة على الشاشة لا تتغير.

---

### 3. الأقسام — Departments (`departments`)

`DepartmentsScreen.tsx`. No standalone detail page — edit dialog doubles as detail
view, consistent with the catalog's own note that this is intentional thin
master-data.

- **DP-01 — List load.** Steps: افتح «الأقسام». Assert: 6 صفوف بالترتيب المُدرج
  (الإدارة العامة، المبيعات، الموارد البشرية، الحسابات، الإنتاج، المخازن)؛ عمود
  «الموظفون» يعرض عدد الموظفين غير المنتهية خدمتهم فقط (الإنتاج=2 يشمل عمرو الموقوف).

- **DP-02 — Search matches English code/name only, not Arabic.** Steps: اكتب
  «الإنتاج» في البحث. Assert: **لا نتائج** — البحث يطابق `name`/`code` الإنجليزيين
  فقط (`Production`/`DEP-500`)، وليس `nameAr`؛ اكتب «Production» بدلاً منه فيظهر الصف.

- **DP-03 — Status chips.** Assert: «الكل»=6، «نشط»=6، «غير نشط»=0 (لا قسم معطّل في
  البذرة).

- **DP-04 — Manager column resolution.** Steps: انظر عمود «المدير» لقسم الإنتاج.
  Assert: يعرض «مصطفى رزق» (اسم عربي محلول)، وليس معرّف `EMP-DEMO-6` الخام.

- **DP-05 — Create department, required fields.** Steps: اضغط «إضافة قسم»، اترك
  «كود القسم» و«اسم القسم» فارغين، احفظ. Assert: شريط أحمر «كود القسم والاسم
  مطلوبان.»

- **DP-06 — Create department, manager as free-text ID (not a picker).** Steps: أضف
  قسماً جديداً واكتب أي نص عشوائي في «مدير القسم (معرّف الموظف)» بدل معرّف موظف حقيقي.
  Assert: الحقل نص حر عادي — لا EntityPicker، لا تحقق من وجود المعرّف من جهة العميل؛
  الحفظ يُرسل النص كما هو (قد يُرفض من الخادم لاحقاً، لكن لا رفض فوري في الواجهة).

- **DP-07 — Create toggles/number defaults.** Assert: «احتساب العمل الإضافي» مفعّل
  افتراضياً؛ «ساعات العمل القياسية» فارغة بتلميح «اتركه فارغاً لاستخدام إعداد
  المنشأة (8 ساعات)».

- **DP-08 — Edit panel: code is locked.** Steps: اضغط صف «المبيعات». Assert: لوحة
  «تعديل القسم» تفتح مباشرة (لا لوحة عرض منفصلة)؛ حقل «كود القسم» معطّل (`disabled`)
  ويعرض `DEP-200` دون إمكانية تعديله.

- **DP-09 — Deactivate via edit form, no confirmation.** Steps: افتح تعديل قسم
  اختباري، بدّل «نشط» لإيقاف، اضغط «حفظ التعديلات». Assert: يُحفظ فوراً بلا أي حوار
  تأكيد؛ الشارة تتحول إلى «غير نشط» (لون محايد) في القائمة.

- **DP-10 — Edit required-field guard.** Steps: امسح «اسم القسم» بالكامل في نموذج
  التعديل، احفظ. Assert: شريط أحمر «اسم القسم مطلوب.»

- **DP-11 — Parent department hierarchy.** Steps: افتح تعديل «المبيعات»، تحقق من حقل
  «القسم الأب». Assert: يعرض «الإدارة العامة» كقيمة محفوظة (`parentDepartmentId:
  DEPT-DEMO-1`)؛ EntityPicker قابل للتغيير لأي قسم آخر أو «بدون قسم أب».

- **DP-12 — Summary strip totals.** Assert: «إجمالي الأقسام»=6، «نشط»=6، «إجمالي
  الموظفين»=9 (غير مصفّى بالحالة — يشمل المنتهية خدمتهم أيضاً هنا خلافاً لعمود
  «الموظفون» بالجدول).

- **DP-13 — Empty state / list error.** Assert: فارغ → «لا توجد أقسام — أضف أول قسم
  لبدء تنظيم الموظفين»؛ فشل التحميل → «تعذّر تحميل الأقسام.» + «إعادة المحاولة».

---

### 4. المسميات الوظيفية — Job Titles (`job-titles`)

`JobTitlesScreen.tsx`. Same thin master-data pattern as Departments, but the
department **cannot** be edited after creation (locked forever), and search **does**
match the Arabic name (unlike Departments).

- **JT-01 — List load.** Steps: افتح «المسميات الوظيفية». Assert: 8 صفوف؛ عمود
  «الموظفون» = عدد الموظفين غير المنتهية خدمتهم بهذا المسمى (مثلاً «مندوب مبيعات» = 1،
  لأن نورهان منتهية الخدمة لا تُحتسب رغم أنها تحمل هذا المسمى).

- **JT-02 — Search matches Arabic name.** Steps: اكتب «أمين» في البحث. Assert: صف
  «أمين مخزن» يظهر — البحث يطابق `nameAr` هنا خلافاً لشاشة الأقسام.

- **JT-03 — Status chips «الكل/نشط/غير نشط».** Assert: 8/8/0 (لا مسمى معطّل بالبذرة).

- **JT-04 — Create job title: department required and locked forever after.**
  Steps: اضغط «إضافة مسمى وظيفي»، اختر القسم «الحسابات»، اسم «مراجع داخلي»، احفظ. ثم
  افتح الصف الناتج للتعديل. Assert: عند الإنشاء «القسم *» EntityPicker قابل للاختيار
  ومطلوب؛ في لوحة التعديل اللاحقة يظهر كحقل نصي **معطّل** يعرض «الحسابات» فقط — لا
  طريقة لنقل المسمى لقسم آخر بعد الإنشاء.

- **JT-05 — Create required-field guard.** Steps: اترك القسم أو الاسم فارغاً، احفظ.
  Assert: شريط أحمر «القسم واسم المسمى الوظيفي مطلوبان.»

- **JT-06 — Edit required-field guard.** Steps: امسح الاسم في نموذج التعديل، احفظ.
  Assert: شريط أحمر «اسم المسمى الوظيفي مطلوب.»

- **JT-07 — Deactivate via edit toggle, no confirmation.** كما DP-09 لكن على مسمى
  وظيفي؛ Assert: نفس السلوك — حفظ فوري بلا تأكيد.

- **JT-08 — Summary strip.** Assert: «إجمالي المسميات»=8، «نشط»=8 (بطاقتان فقط، لا
  توجد بطاقة ثالثة كما في شاشات أخرى).

- **JT-09 — Empty state / list error.** Assert: «لا توجد مسميات وظيفية — أضف أول
  مسمى وظيفي» / «تعذّر تحميل المسميات الوظيفية.» + إعادة المحاولة.

---

### 5. العقود — Contracts (`contracts`)

`ContractsScreen.tsx`. Create + terminate only — **no edit form** for an existing
contract's own fields.

- **CT-01 — List load, 10 rows.** Steps: افتح «العقود». Assert: 10 صفوف تشمل
  ECT-DEMO-1..10؛ عمود «الراتب الأساسي» يعرض `MoneyDisplay` (مثال: كريم 9,000.00
  ج.م، محمد 18,000.00 ج.م).

- **CT-02 — Lapsed contract still shows «ساري».** Pre: ECT-DEMO-2 (سلمى، محدد المدة،
  انتهى 2026-01-14) لم يُفسخ يدوياً قط. Steps: ابحث عن ECT-DEMO-2 في القائمة. Assert:
  شارة الحالة تقرأ **«ساري»** رغم أن تاريخ الانتهاء 2026-01-14 مضى منذ أكثر من 7
  أشهر — الحالة لا تنقلب تلقائياً بمرور تاريخ الانتهاء، فقط عبر «إنهاء العقد» اليدوي.
  هذا يفسّر لماذا لا يظهر ضمن أي عدّاد «قريبة الانتهاء» (تلك مشتقة من تاريخ + حالة
  نشطة، وحالته لا تزال نشطة لكن تاريخه فات نافذة الـ30 يوماً أصلاً).

- **CT-03 — Renewal contract picked automatically by payroll, not by this screen.**
  Pre: ECT-DEMO-2 (سلمى، لاحق) وECT-DEMO-3 (لاحقتها) كلاهما ظاهر كصفّين مستقلّين.
  Assert: هذه الشاشة لا تُظهر أي ربط مرئي بين العقدين (لا "تجديد لـ")؛ فقط عند حساب
  الرواتب (PR-04) يُختار ECT-DEMO-3 تلقائياً لأن تاريخه أحدث ويغطي الفترة.

- **CT-04 — Search matches contract number or employee name.** Steps: اكتب «CTR-
  DEMO-4» ثم امسح واكتب «الشهابي». Assert: كلا البحثين يُرجع صف محمد الشهابي.

- **CT-05 — Status chips «الكل/ساري/مفسوخ».** Assert: «مفسوخ» = 1 فقط (ECT-DEMO-10،
  نورهان) رغم أن ECT-DEMO-2 منتهي التاريخ فعلياً — يبقى محسوباً ضمن «ساري» (CT-02).

- **CT-06 `[NOT IMPLEMENTED]` — «قريبة الانتهاء» stat/filter on this screen.**
  Assert: لا توجد بطاقة إحصاء ولا شريحة فلترة باسم «قريبة الانتهاء» على شاشة العقود
  نفسها — فقط بطاقتان («إجمالي العقود»=10، «عقود سارية»=9)؛ هذا العدّاد موجود فقط في
  لوحة الموارد البشرية (HR-02) وليس هنا رغم وصف الكتالوج له كبطاقة على هذه الشاشة.

- **CT-07 — Create contract: type default & end-date lock.** Steps: اضغط «إضافة
  عقد». Assert: «نوع العقد *» افتراضي «غير محدد المدة»؛ حقل «تاريخ الانتهاء» معطّل
  فوراً بتلميح «العقد غير محدد المدة لا يحتوي على تاريخ انتهاء».

- **CT-08 — Conditional required end date.** Steps: غيّر «نوع العقد» إلى «محدد
  المدة»، اترك «تاريخ الانتهاء» فارغاً، احفظ. Assert: حقل تاريخ الانتهاء يصبح
  قابلاً للتحرير؛ الحفظ يُرفض بشريط أحمر «تاريخ الانتهاء مطلوب للعقود محددة
  المدة/الموسمية/التجريبية.»

- **CT-09 — Switching back to indefinite discards a typed end date.** Steps: اختر
  «محدد المدة»، اكتب تاريخ انتهاء، ثم غيّر النوع رجوعاً إلى «غير محدد المدة»، احفظ.
  Assert: الحمولة المُرسلة تحمل `endDate: null` — القيمة المكتوبة سابقاً لا تُرسل حتى
  لو بقيت ظاهرة في حقل معطّل.

- **CT-10 — Pay basis / pay frequency defaults.** Assert: «أساس الدفع *» افتراضي
  «راتب شهري»؛ «تكرار الدفع *» افتراضي «شهري».

- **CT-11 — Money input currency-suffix mismatch.** Steps: غيّر «العملة *» إلى
  «USD»، لاحظ لاصقة حقل «الراتب الشهري». Assert: لاصقة العملة داخل حقل الراتب تبقى
  **«ج.م»** ثابتة بصرف النظر عن اختيار «العملة *» — عدم اتساق بصري يستحق ملاحظة عند
  الاختبار البصري.

- **CT-12 — Required-field guard (base).** Steps: اترك الموظف أو تاريخ البداية أو
  الراتب الشهري فارغاً، احفظ. Assert: شريط أحمر «الموظف وتاريخ البداية والراتب
  الشهري مطلوبة.»

- **CT-13 — Currency options.** Steps: افتح قائمة «العملة *». Assert: 11 خياراً
  (EGP افتراضي، SAR، AED، QAR، KWD، BHD، OMR، JOD، USD، EUR، GBP) — مطابقة لقائمة
  عملاء المبيعات.

- **CT-14 — Leave-entitlement overrides, optional, employee-level example.**
  Pre: ECT-DEMO-4 (محمد) يحمل `annualLeaveDays: 30` override. Steps: افتح تفاصيل
  ECT-DEMO-4. Assert: قسم «استحقاق الإجازات» يعرض «السنوية: 30»، «المرضية: —»،
  «الشخصية: —» — الحقول غير المحدَّدة تُعرض شرطة، لا صفر.

- **CT-15 — Allowances / deductions detail lists.** Steps: افتح تفاصيل ECT-DEMO-1
  (كريم). Assert: قسم «البدلات» يعرض «بدل انتقال 800.00» و«بدل هاتف 200.00»؛ قسم
  «الاستقطاعات» يعرض «اشتراك صندوق الزمالة 100.00».

- **CT-16 — Empty allowances/deductions state.** Steps: افتح تفاصيل ECT-DEMO-2
  (بدون استقطاعات). Assert: قسم الاستقطاعات يعرض «لا توجد خصومات».

- **CT-17 — Terminate contract, active only, no confirmation.** Pre: ECT-DEMO-1
  (ساري). Steps: افتح تفاصيله، اضغط «إنهاء العقد». Assert: الزر ظاهر فقط لأن الحالة
  «active»؛ الطلب يُرسل فوراً بلا حوار تأكيد؛ الحالة تتحول إلى «مفسوخ» وزر «إنهاء
  العقد» يختفي بعدها.

- **CT-18 — Terminated contract has no terminate button.** Pre: ECT-DEMO-10 (مفسوخ).
  Assert: لا زر «إنهاء العقد» ظاهر في لوحته.

- **CT-19 — Hourly contract flagged for exclusion (context for PR-08).** Pre:
  ECT-DEMO-9 (عمرو، بالساعة). Steps: افتح تفاصيله. Assert: «أساس الدفع» يعرض
  «بالساعة»؛ هذه الشاشة نفسها لا تحذّر من أي استبعاد من الرواتب — التحذير يظهر فقط
  داخل شاشة الرواتب عند الحساب (PR-08).

---

### 6. الإجازات الرسمية — Public Holidays (`holidays`)

`HolidaysScreen.tsx`. Year-tabbed, has full edit + delete (the catalog only
speculated these existed since its tenant was empty — confirmed present here).

- **HO-01 — Year chips, 2026 default.** Steps: افتح «الإجازات الرسمية». Assert: ثلاث
  شرائح سنة فقط: 2025 / **2026 (نشطة افتراضياً)** / 2027 — لا حقل سنة حر، لا خيار
  «كل السنوات».

- **HO-02 — 2026 shows all 12 seeded holidays.** Assert: 12 صفاً، مرتبة بالتاريخ؛
  أول صف «2026-01-07 — عيد الميلاد المجيد».

- **HO-03 — 2025/2027 are empty.** Steps: اضغط شريحة «2025». Assert: «لا توجد إجازات
  رسمية لهذا العام» + زر «إضافة إجازة».

- **HO-04 — Recurring vs one-time type pill.** Assert: عيد الميلاد المجيد وعيد
  الشرطة وعيد سيناء وعيد العمال وثورة يوليو وعيد القوات المسلحة (6 إجازات)
  `recurringAnnual: true` → شارة «سنوية» (لون معلوماتي)؛ الباقي (عيد الفطر ويومه
  الثاني، شم النسيم، عيد الأضحى، رأس السنة الهجرية، المولد النبوي — 6 إجازات) → شارة
  «لمرة واحدة» (لون محايد).

- **HO-05 — Stat tiles.** Assert: «إجمالي الإجازات»=12، «سنوية»=6، «لمرة واحدة»=6
  (لعام 2026 المحدد).

- **HO-06 — Create holiday, required fields.** Steps: اضغط «إضافة إجازة»، اترك
  التاريخ أو الاسم الإنجليزي فارغاً، احفظ. Assert: شريط أحمر «التاريخ والاسم
  بالإنجليزية مطلوبان.» — الاسم العربي **اختياري** فعلاً (لا يُطلب).

- **HO-07 — Create holiday, defaults.** Steps: افتح النموذج مجدداً. Assert: التاريخ
  الافتراضي `{السنة النشطة}-01-01`؛ «إجازة سنوية متكررة» موقوفة افتراضياً.

- **HO-08 — Edit holiday.** Steps: اضغط أيقونة القلم على «عيد الأضحى المبارك»، غيّر
  الاسم العربي، احفظ. Assert: لوحة «تعديل إجازة»؛ التغيير ينعكس فوراً في الجدول.

- **HO-09 — Delete holiday, no confirmation.** Steps: اضغط أيقونة السلة على أي صف.
  Assert: الحذف يُنفَّذ **فوراً بلا أي حوار تأكيد**؛ الصف يختفي من الجدول.

- **HO-10 — Delete-in-flight disables every delete button, not just the row's.**
  Steps: احذف صفاً، وقبل اكتمال الطلب حاول الضغط على سلة صف آخر. Assert: كل أزرار
  «حذف» في الجدول معطّلة أثناء أي حذف واحد قيد التنفيذ (`disabled={deletingId !==
  null}`) — ليس فقط زر الصف قيد الحذف.

- **HO-11 — Delete error.** Pre: أفشل `DELETE`. Assert: شريط أحمر مشترك (غير مرتبط
  بصف بعينه) أعلى شرائح السنة: «تعذّر حذف الإجازة.» أو رسالة الخادم.

- **HO-12 — List load error.** Assert: «تعذّر تحميل الإجازات الرسمية.» + «إعادة
  المحاولة».

---

### 7. الحضور والانصراف — Attendance (`attendance`)

`AttendanceScreen.tsx` — a **filtered list**, not the calendar/grid the catalog
described; the "monthly summary" is an inline card, not a dialog (see AT-11..AT-12).

- **AT-01 — Default month & row count.** Steps: افتح «الحضور والانصراف». Assert:
  حقل «الشهر» نصي بصيغة `YYYY-MM` يبدأ على الشهر الحالي؛ اضبطه على `2026-08` لرؤية
  سجلات أغسطس المزروعة (نافذة 2026-08-02..2026-08-13 لخمسة موظفين).

- **AT-02 — Employee filter.** Steps: اختر «الموظف» = «كريم عادل». Assert: يتبقى
  سجلات كريم فقط لشهر 2026-08 (يشمل يومَي التأخير 08-04 وغياب بدون إذن 08-05).

- **AT-03 — Status filter, each of the 7 codes.** Steps: كرر لكل قيمة في «الحالة»:
  حاضر/تأخير/نصف يوم/غائب/في إجازة/إجازة رسمية/إجازة أسبوعية. Assert: كل قيمة تُصفّي
  الصفوف لنفس الحالة فقط؛ القيم السبع تغطي كامل مجموعة الحالات المزروعة (72 سجلاً
  عبر النوافذ الزمنية المزروعة).

- **AT-04 — Malformed month string.** Steps: اكتب `2026-13` أو `abc` في حقل الشهر.
  Assert: لا تحقق شكلي من جهة العميل — الحقل نصي حر بلا حراسة؛ لاحظ سلوك الاستعلام
  الناتج (قد يعيد نطاقاً فارغاً/غير متوقع) وسجّله كسلوك غير محروس بدل افتراض الرفض.

- **AT-05 — Columns.** Assert: التاريخ / الموظف / الحضور / الانصراف / ساعات العمل
  (`H:MM`) / الحالة / إجراء (قلم فقط، **لا زر حذف** لسجل الحضور).

- **AT-06 — Weekend scores «إجازة أسبوعية» without a check-in.** Pre: يوم جمعة/سبت
  ضمن النافذة المزروعة، لا استثناء له. Assert: الحالة «إجازة أسبوعية» تلقائياً — لا
  سجل حضور بلا سبب لهذا اليوم.

- **AT-07 — Holiday overrides absence.** Pre: 2026-07-23 (يوم ضمن نافذة يوليو) —
  استثناء `checkIn: null` لثلاثة موظفين، ويقع في تاريخ إجازة (23 يوليو ثورة). Assert:
  الحالة المحسوبة «إجازة رسمية»، وليست «غائب»، لأن التحقق من التقويم الرسمي يسبق
  الغياب.

- **AT-08 — Approved leave overrides absence.** Pre: كريم عادل (EMP-DEMO-1) لديه
  إجازة سنوية موافقة LR-DEMO-1 (2026-07-06..09)، ضمن نافذة يوليو المزروعة (07-20..23)
  — استخدم بدلاً موظفاً/تاريخاً متداخلاً فعلياً إن توفر، أو تحقق من المبدأ على
  هدى مصطفى (LR-DEMO-6، إجازة سنوية موافقة 2026-08-20..27) إن كانت ضمن نطاق حضور
  مسجَّل. Assert: أي يوم بلا تسجيل حضور يتقاطع مع إجازة **موافَق عليها** يُحتسب
  «في إجازة»، لا «غائب» — الترتيب: حضور فعلي > تقويم رسمي > إجازة موافقة > عطلة
  أسبوعية > غائب.

- **AT-09 — Explicit absence with no leave/holiday cover.** Pre: `EMP-DEMO-1|2026-
  08-05: { checkIn: null, notes: "غياب بدون إذن" }`. Assert: الحالة «غائب»، والملاحظة
  «غياب بدون إذن» ظاهرة عند فتح تعديل السجل.

- **AT-10 — Late arrival past grace period.** Pre: `EMP-DEMO-1|2026-08-04: checkIn
  09:35` مقابل بداية الوردية 09:00 وسماحية 10 دقائق (أي حد التأخير 09:10). Assert:
  الحالة «تأخير» (وليس «حاضر») لأن 09:35 > 09:10.

- **AT-11 `[NOT IMPLEMENTED as a dialog]` — "Monthly summary" is inline, not a
  dialog, and only appears with an employee selected.** Steps: صفِّ الشهر
  `2026-08` بلا اختيار موظف. Assert: لا بطاقة ملخص شهري تظهر أبداً بلا تحديد موظف
  واحد — خلافاً لوصف الكتالوج لها كنافذة منبثقة تُفتح بزر لكل صف بغضّ النظر عن الفلتر.

- **AT-12 — Monthly summary card for a selected employee.** Steps: اختر الموظف
  «كريم عادل» والشهر `2026-08`. Assert: بطاقة «الملخص الشهري للحضور» تظهر أسفل
  الجدول بأربع مربّعات (أنصاف الأيام، أيام الإجازات، الإجازات الرسمية، ساعات
  العمل)، بالإضافة لأربع بطاقات علوية (أيام العمل، أيام الحضور، أيام التأخير، أيام
  الغياب) وخامسة (نسبة الحضور %)؛ كل الأرقام قادمة من الخادم مباشرة (`GET
  /hr/attendance/summary`) — لا حساب من جهة العميل يقارن بالتقويم أو الإجازات هنا.

- **AT-13 `[NOT IMPLEMENTED]` — `weeklyOffDays` fetched but never rendered.**
  Assert: استجابة الملخص تحمل حقل `weeklyOffDays` لكنه لا يظهر في أي بطاقة أو نص —
  لا في الشريط العلوي ولا في بطاقة الملخص.

- **AT-14 — Record attendance side panel: employee/date locked on edit.** Steps:
  اضغط «تسجيل حضور»، ثم لاحقاً افتح تعديل سجل موجود عبر أيقونة القلم. Assert: عند
  الإنشاء «الموظف *» و«التاريخ *» قابلان للاختيار؛ عند التعديل كلاهما **معطّل**.

- **AT-15 — Expected-check-in field drives lateness.** Steps: أنشئ سجلاً بـ«وقت
  الحضور» 09:20 و«بداية الوردية» فارغة. Assert: الحالة المحسوبة «حاضر» لا «تأخير» —
  بلا وقت بداية وردية، لا يمكن استنتاج التأخير (تلميح الحقل يوضح هذا صراحة).

- **AT-16 — Status override select.** Steps: أنشئ/عدّل سجلاً واختر «تجاوز الحالة» =
  «في إجازة» يدوياً رغم وجود وقت حضور مسجَّل. Assert: الحالة المحفوظة تُجبر على
  القيمة المختارة يدوياً بدل الاحتساب التلقائي؛ القيمة الافتراضية للحقل «احتساب
  تلقائي» (فارغة).

- **AT-17 — Required-field guard.** Steps: احفظ بدون موظف أو تاريخ. Assert: شريط
  أحمر «الموظف والتاريخ مطلوبان.»

- **AT-18 — Half-day toggle default derivation on edit.** Steps: افتح تعديل سجل
  `halfDay` سابق (مثل `EMP-DEMO-4|2026-08-06`). Assert: مفتاح «نصف يوم» يظهر مفعّلاً
  لأن الحالة المخزَّنة `half_day` — القيمة مشتقة من الحالة لا من علم منفصل مخزَّن.

- **AT-19 — Empty state / list error.** Assert: «لا توجد سجلات حضور لهذه الفترة» /
  «تعذّر تحميل سجل الحضور.» + إعادة المحاولة.

- **AT-20 — Pagination inert.** Assert: `page=1 pageCount=1` — لا يظهر ترقيم صفحات
  مهما بلغ عدد السجلات (72 سجلاً في البذرة).

---

### 8. الرواتب — Payroll Runs & Payslips (`payroll`)

`PayrollRunsScreen.tsx`. **This is the single most important surface in this
document** — every net figure must carry the scope qualifier, and the engine
deliberately computes no tax, no insurance, no seniority bonus, no overtime, and no
end-of-service gratuity.

#### Run list

- **PR-01 — List shows all three seeded runs with correct totals.** Steps: افتح
  «الرواتب». Assert: 3 صفوف — يونيو 2026 (7 موظفين، إجمالي 70,950.00، صافي
  69,750.00، **مصروف**)، يوليو 2026 (7 موظفين، إجمالي 70,950.00، صافي ≈69,282.26
  بعد خصم إجازة مصطفى رزق بدون أجر، **معتمد**)، أغسطس 2026 (7 موظفين، إجمالي
  70,950.00، صافي 68,750.00، **محتسب**).

- **PR-02 — Status chips.** Assert: «الكل»=3، «مسودة»=0، «محتسب»=1، «معتمد»=1،
  «مصروف»=1، «ملغى»=0.

- **PR-03 — Year-to-date stat tiles.** Assert: «إجمالي عمليات التشغيل»=3؛ «إجمالي
  رواتب السنة»=مجموع الإجمالي الثلاثة (70,950×3=212,850.00)؛ «صافي رواتب السنة»=
  مجموع الصافي الثلاثة (≈207,782.26)؛ «الصافي المصروف هذا العام»=صافي يونيو فقط
  (69,750.00 — الشهر الوحيد الذي بلغ «مصروف»).

- **PR-04 — Employee count excludes the hourly contract.** Pre: 9 موظفون إجمالاً، 1
  منتهي الخدمة (نورهان)، 1 بعقد بالساعة (عمرو). Steps: افتح أي دورة. Assert:
  `employeeCount = 7` — ليس 8 (لأن عمرو مُستبعد) وليس 9 (لأن نورهان منتهية الخدمة
  أصلاً غير مشمولة في القوائم النشطة).

#### Create run

- **PR-05 — Create dialog fields.** Steps: اضغط «تشغيل رواتب جديد». Assert: حقلان
  فقط — «السنة *» (رقمي، افتراضي السنة الحالية) و«الشهر *» (قائمة بالأشهر العربية
  الاثني عشر، افتراضي الشهر الحالي).

- **PR-06 — Duplicate period is refused.** Pre: يونيو 2026 موجودة بالفعل وغير ملغاة.
  Steps: أنشئ دورة جديدة لسنة 2026 وشهر يونيو. Assert: رفض من الخادم؛ رسالة الخطأ
  تُعرض في شريط النموذج الأحمر (عبر `ApiError.message` أو الافتراضي «تعذّر إنشاء
  دورة الرواتب.»).

- **PR-07 — New run opens straight into its detail panel.** Steps: أنشئ دورة لشهر
  غير مستخدم (مثل سبتمبر 2026). Assert: عند النجاح تُغلق لوحة الإنشاء وتُفتح لوحة
  تفاصيل الدورة الجديدة مباشرة بحالة «مسودة»، بلا كشوف رواتب بعد («لم تُحتسب الدورة
  بعد»).

#### The scope notice — every net figure, everywhere

- **PR-08 — Hourly employee excluded with a named warning, not a zero payslip.**
  Pre: أي من الدورات الثلاث (خذ أغسطس «محتسب» كمثال حيّ يمكن إعادة حسابه). Steps:
  افتح تفاصيل الدورة، انظر قسم «ملاحظات الاحتساب». Assert: يظهر سطر يسمّي عمرو الديب
  صراحة، بصيغة قريبة من: **«عمرو الديب (EMP-0008): أساس الدفع "hourly" يحتاج
  بيانات حضور — تم استبعاده.»** — لاحظ أن القيمة `"hourly"` تظهر **بالإنجليزية
  الخام غير مترجمة** داخل جملة عربية، وليست "بالساعة"؛ وتحقق أن **لا يوجد** أي كشف
  راتب باسم عمرو الديب في قائمة «كشوف الرواتب» أدناه — لا سطر بصافي صفر، لا سطر
  فارغ، غياب تام من القائمة.

- **PR-09 — Run-level scope notice lists all five universal gaps and matches the
  employee count.** Steps: افتح تفاصيل أي دورة. Assert: صندوق أزرق «نطاق الاحتساب —
  بنود لم تُحتسب في هذه الدورة» يعرض بالضبط **5 بنود** — ضريبة كسب العمل، التأمينات
  الاجتماعية، علاوة الأقدمية (المادة 47)، أجر العمل الإضافي، مكافأة نهاية الخدمة —
  كل بند بشرحه الكامل من الكود (مثال ضريبة كسب العمل: «لا تُحتسب الشرائح ولا
  الإعفاءات ولا التسوية السنوية، ولا يظهر أي بند ضريبي في كشف الراتب.»)؛ العدد
  المذكور في نص «وتنطبق على جميع موظفي هذه الدورة (N موظف)» يساوي **7**، مطابقاً
  `employeeCount` تماماً.

- **PR-10 — Situational-gaps paragraph appears whenever a situational rule
  applies.** Pre: الدورة تستبعد فعلياً موظفاً بالساعة (عمرو). Assert: تحت قائمة
  البنود الخمسة يظهر فقرة إضافية تذكر «بنود أخرى غير محتسبة تنطبق فقط على موظفين
  محددين... الأجر بالساعة أو باليوم، تكرار الدفع غير الشهري، اختلاف عملة العقد، أو
  القروض والحجوزات القضائية — ومذكورة عند حدوثها في «ملاحظات الاحتساب» أدناه.» —
  وفعلاً حالة عمرو مذكورة هناك (PR-08).

- **PR-11 — Every payslip's net carries the qualifier badge — no exceptions.**
  Steps: افتح تفاصيل يونيو 2026 (مصروف)، تفقد كل كشف راتب من السبعة. Assert: **بلا
  استثناء واحد**، السطر «الصافي» في كل كشف يحمل مباشرة بجواره الشارة «قبل الضريبة
  والتأمينات وبنود قانونية أخرى»؛ لا كشف واحد يعرض «الصافي» عارياً بلا الشارة —
  كشف بصافي واثق بلا مؤهِّل هو عيب بحد ذاته وفق نطاق هذه المهمة.

- **PR-12 — The same qualifier appears on the run-level net total, not just per
  payslip.** Steps: انظر بطاقة «صافي الرواتب» في الشبكة العلوية لتفاصيل الدورة.
  Assert: نفس الشارة تظهر بجوار عنوان «صافي الرواتب» على مستوى الدورة الكاملة، لا
  فقط على مستوى كل كشف فردي.

- **PR-13 — No scenario computes a tax/insurance figure — assert their absence
  instead.** Steps: افحص كل سطر ضمن كل كشف راتب في الدورات الثلاث. Assert: لا يوجد
  أي سطر بعنوان يحتوي «ضريبة» أو «تأمين» أو «أقدمية» أو «إضافي» أو «نهاية خدمة» في
  أي كشف — فقط: الراتب الأساسي، بدلات العقد المسمّاة، استقطاعات العقد المسمّاة،
  استقطاع إجازة بدون أجر (إن وُجد)، وسداد سلف (إن وُجد).

#### Payslip line-by-line detail

- **PR-14 — كريم عادل's payslip, June (concrete figures).** Steps: افتح كشف راتب
  كريم عادل ضمن دورة يونيو. Assert: سطرا استحقاق «الراتب الأساسي 9,000.00» و«بدل
  انتقال 800.00» و«بدل هاتف 200.00» = إجمالي 10,000.00؛ سطرا استقطاع «اشتراك صندوق
  الزمالة 100.00» و«سداد سلفة ADV-DEMO-1 1,000.00»؛ **الصافي = 8,900.00** + الشارة.

- **PR-15 — محمد الشهابي's payslip, no deductions at all.** Steps: افتح كشفه ضمن أي
  من الدورات الثلاث. Assert: استحقاقات «الراتب الأساسي 18,000.00» + «بدل سكن
  2,500.00» + «بدل انتقال 1,500.00» = 22,000.00؛ **لا سطر استقطاع واحد**؛ الصافي =
  22,000.00 + الشارة، ثابت في الأشهر الثلاثة.

- **PR-16 — هدى مصطفى: «في إجازة» employee status does NOT by itself reduce pay.**
  Pre: هدى بحالة موظف «في إجازة» طوال الفترة، لكن إجازاتها الموافقة (مرضية، سنوية)
  ليست من نوع «بدون أجر». Steps: افتح كشفها في يونيو ويوليو وأغسطس. Assert: الصافي
  = 8,100.00 (7,500 + 600 بدل انتقال، بلا استقطاع) في **الأشهر الثلاثة على حدّ
  سواء** — حالة «في إجازة» الوظيفية لا تُخصم من الراتب من تلقاء نفسها؛ فقط إجازة من
  نوع «بدون أجر» تفعل ذلك (PR-17).

- **PR-17 — مصطفى رزق: an approved *unpaid*-type leave IS deducted, prorated by
  overlap days.** Pre: LR-DEMO-8 (مصطفى، بدون أجر، موافَق عليها، 2026-07-13..14،
  يومان) يقع بالكامل داخل فترة يوليو. Steps: افتح كشف مصطفى ضمن دورة يوليو. Assert:
  سطر استقطاع إضافي بعنوان **«إجازة بدون أجر (2 يوم)»** بمبلغ ≈467.74 ج.م (حصة
  يومين من إجمالي 7,250.00 على 31 يوماً، موزَّعة بخوارزمية الباقي الأكبر بحيث يبقى
  المجموع مطابقاً تماماً)؛ الصافي ≈6,782.26 — أقل من راتبه المعتاد 7,250.00 في
  يونيو/أغسطس حيث لا إجازة بدون أجر واقعة.

- **PR-18 — أحمد الشناوي: advance recovery appears only once its instalment falls
  due.** Pre: ADV-DEMO-2 (أحمد، 4,000/4، أول خصم 2026-08-01) مصروفة بالفعل قبل حساب
  الدورات الثلاث. Steps: قارن كشوفه ليونيو ويوليو وأغسطس. Assert: يونيو ويوليو —
  لا سطر سداد سلفة (القسط الأول لم يستحق بعد)، الصافي = 9,100.00 (9,200 إجمالي −
  100 اشتراك)؛ أغسطس — يظهر سطر «سداد سلفة ADV-DEMO-2 1,000.00»، الصافي = 8,100.00.

- **PR-19 — سلمى فؤاد: the renewal contract's allowance is picked, not the lapsed
  one's.** Steps: افتح كشفها ضمن أي دورة. Assert: الراتب الأساسي 7,800.00 (من
  ECT-DEMO-3) + بدل انتقال 600.00 (من ECT-DEMO-3 أيضاً) = 8,400.00 — وليس 6,500 +
  500 من ECT-DEMO-2 المنتهي.

- **PR-20 — Proration rule (no seeded example in these 3 runs — assert the rule
  directly).** Assert (من الكود، `calculate-payroll-run.ts`): موظف يبدأ عقده أو
  يُعيَّن منتصف الشهر يُحتسب له فقط عدد الأيام التي كان العقد سارياً فيها ضمن
  الفترة، بالتناسب الدقيق على السطرين (الراتب الأساسي والبدلات)، عبر خوارزمية الباقي
  الأكبر بحيث يبقى المجموع مطابقاً تماماً — الاستقطاعات الثابتة **لا تُناسَب**،
  تُخصم كاملة بصرف النظر عن عدد أيام الاستحقاق. لا يوجد كشف مُناسَب في دورات يونيو/
  يوليو/أغسطس المزروعة (كل العقود السبعة سارية طوال الفترة)؛ للتحقق الفعلي أنشئ عقداً
  يبدأ منتصف شهر واحتسب دورة له.

#### Lifecycle — مسودة → محتسب → معتمد → مصروف

- **PR-21 — Draft run: only «احتساب الرواتب» and «إلغاء الدورة» available.** Pre:
  دورة بحالة «مسودة» (أنشئها إن لزم، PR-07). Assert: زر «احتساب الرواتب» ظاهر؛ لا
  زر «اعتماد وترحيل القيد»؛ زر «إلغاء الدورة» ظاهر؛ لا خيار صرف.

- **PR-22 — Calculate a draft run.** Steps: اضغط «احتساب الرواتب». Assert: الحالة
  تتحول إلى «محتسب»؛ قسم «كشوف الرواتب» يمتلئ بسبعة كشوف؛ قسم «ملاحظات الاحتساب»
  يظهر بتحذير عمرو (PR-08)؛ زر «احتساب الرواتب» يبقى متاحاً (لإعادة الحساب من حالة
  «محتسب» نفسها) وزر «اعتماد وترحيل القيد» يظهر الآن أيضاً.

- **PR-23 — Recalculating a محتسب run replaces its payslips wholesale.** Pre: دورة
  «محتسب». Steps: عدّل بيانات مصدر (مثلاً استقطاعاً في عقد أحد الموظفين السبعة) ثم
  اضغط «احتساب الرواتب» مجدداً. Assert: الكشوف السابقة تُحذف بالكامل وتُستبدل
  بمجموعة جديدة تعكس التعديل — لا تراكم لكشوف مكرّرة لنفس الموظف.

- **PR-24 — Approve a calculated run: posts one balanced journal entry.** Pre: دورة
  «محتسب» بسبعة كشوف. Steps: اضغط «اعتماد وترحيل القيد». Assert: الحالة تتحول إلى
  «معتمد»؛ حقل «القيد المحاسبي» في بطاقة الملخص يتحول من «—» إلى معرّف قيد فعلي؛
  زرا «احتساب الرواتب» و«إلغاء الدورة» يختفيان؛ يظهر قسم «صرف الرواتب».

- **PR-25 — Approval also applies advance-recovery lines to the underlying
  advances.** Pre: قبل اعتماد دورة تحتوي سطر سداد سلفة (مثل يونيو لكريم). Steps:
  لاحظ حالة السلفة ADV-DEMO-1 في شاشة السلف قبل الاعتماد وبعده. Assert: قبل اعتماد
  يونيو، المتبقي على ADV-DEMO-1 = 6,000.00 (لا شيء استُرد بعد رغم ظهور سطر السداد في
  المعاينة)؛ بعد اعتماد يونيو، المتبقي ينخفض إلى 5,000.00 والأقساط تصبح 1/6 — أي أن
  **الاسترداد الفعلي يُطبَّق فقط عند الاعتماد**، لا عند الحساب فقط.

- **PR-26 — Approve is refused from the wrong state.** Pre: دورة «مسودة» أو
  «مصروف» أو «ملغى». Steps: حاول استدعاء الاعتماد (لا يوجد زر ظاهر أصلاً لهذه
  الحالات — تحقق من غيابه، وإن اختبرت مباشرة عبر واجهة برمجية فتحقق من رفض الخادم).
  Assert: لا زر «اعتماد» يظهر إطلاقاً إلا لحالة «محتسب» فقط؛ استدعاء مباشر من حالة
  أخرى يُرفض برسالة من نمط: `Cannot transition payroll run from "draft" to
  "approved".` — **بالإنجليزية**، رغم أن بقية الواجهة عربية بالكامل؛ لاحظ هذا التبايُن
  اللغوي عند الاختبار.

- **PR-27 — Disburse requires treasury account and branch.** Pre: دورة «معتمد»
  (يوليو 2026). Steps: اضغط «صرف» دون اختيار «الخزينة» أو «الفرع». Assert: شريط
  أحمر «اختر الخزينة والفرع قبل الصرف.» — تحقق من جهة العميل قبل أي طلب شبكة.

- **PR-28 — Disburse: balanced journal entry, treasury account reduced.** Pre:
  دورة معتمدة، اختر خزينة بنكية وفرعاً. Steps: اضغط «صرف». Assert: نص القسم يوضح
  مسبقاً «يصدر سند صرف نقدي: مدين رواتب مستحقة (2170) / دائن الخزينة.»؛ بعد النجاح
  تتحول الحالة إلى «مصروف»؛ رصيد حساب الخزينة المختار ينخفض بمقدار «صافي الرواتب»
  بالضبط (69,750.00 ليونيو)؛ القيد المُرحّل عند الصرف متوازن (مدين=دائن).

- **PR-29 — Disburse is refused when net pay is zero or the run isn't approved.**
  Assert (من الكود، `hr-disbursement.ts`): الصرف يُرفض إن `totalNet <= 0` برسالة
  «صافي الرواتب يجب أن يكون أكبر من صفر للصرف»، وإن حاولت الصرف من حالة غير «معتمد»
  فلا زر «صرف» يظهر أصلاً (القسم مشروط بـ`status === "approved"`).

- **PR-30 — Cancel a draft/calculated run, no confirmation.** Pre: دورة «مسودة» أو
  «محتسب». Steps: اضغط «إلغاء الدورة». Assert: يُنفَّذ فوراً بلا حوار تأكيد؛ الحالة
  تتحول إلى «ملغى»؛ أي كشوف رواتب محسوبة تُحذف بالكامل (`employeeCount`/الإجماليات
  تعود لصفر)؛ لا زر إجراء آخر يظهر بعدها (حالة نهائية).

- **PR-31 — Cancel is unavailable once approved.** Pre: دورة «معتمد» أو «مصروف».
  Assert: لا زر «إلغاء الدورة» يظهر إطلاقاً لهاتين الحالتين.

- **PR-32 — Empty payslip section before first calculation.** Pre: دورة «مسودة»
  حديثة الإنشاء. Assert: قسم «كشوف الرواتب» يعرض «لم تُحتسب الدورة بعد» بدل قائمة
  فارغة صامتة.

- **PR-33 — Concurrent-action guard.** Steps: اضغط بسرعة زرّين إجرائيين متتاليين
  (مثل «احتساب» ثم «إلغاء») قبل استجابة الأول. Assert: كل الأزرار الإجرائية معطّلة
  أثناء أي طلب واحد قيد التنفيذ (`pendingId`).

- **PR-34 — Action error path.** Pre: أفشل أياً من `calculate/approve/cancel/
  disburse`. Assert: شريط أحمر داخل اللوحة برسالة الخادم أو الافتراضي المناسب
  («تعذّر تنفيذ العملية.» / «تعذّر صرف الرواتب.»)؛ الحالة المعروضة لا تتغير.

- **PR-35 — Search & list-level error.** Steps: ابحث «PR» في «ابحث برقم التشغيل أو
  الفترة...». Assert: يطابق رقم الدورة أو `"{year}-{month}"`؛ فشل تحميل القائمة →
  «تعذّر تحميل دورات الرواتب.» + إعادة المحاولة.

---

### 9. سلف الموظفين — Employee Advances (`advances`)

`EmployeeAdvancesScreen.tsx`. Lifecycle بانتظار الاعتماد → معتمدة → مصروفة →
(مسددة عبر خصم الرواتب فقط، لا إجراء يدوي).

- **AD-01 — List reflects the seeded five, and none is currently «مسددة».** Steps:
  افتح «سلف الموظفين». Assert: 5 صفوف — ADV-DEMO-1 (كريم، 6,000.00، متبقي
  **4,000.00**، أقساط **2/6**، **مصروفة**)، ADV-DEMO-2 (أحمد، 4,000.00، متبقي
  4,000.00، أقساط 0/4، **مصروفة**)، ADV-DEMO-3 (سلمى، 2,400.00، **معتمدة**)،
  ADV-DEMO-4 (هدى، 3,000.00، **بانتظار الاعتماد**)، ADV-DEMO-5 (مصطفى، 10,000.00،
  **مرفوضة**). لا صف واحد بحالة «مسددة» في الحالة الراهنة للبذرة — بعد اعتماد
  دورتي يونيو ويوليو فقط، لم يُسترد بعد كامل مبلغ أي سلفة.

- **AD-02 — Status chips (5, not 4 — «مرفوضة» has no chip).** Assert: الشرائح
  الظاهرة بالضبط: الكل(5) / في انتظار الاعتماد(1) / معتمدة(1) / مصروفة(2) /
  مسددة(0) — **لا توجد شريحة «مرفوضة»** رغم وجود سلفة بهذه الحالة في القائمة؛
  السلفة المرفوضة (ADV-DEMO-5) تظهر فقط تحت شريحة «الكل».

- **AD-03 — Search by number or employee name.** Steps: اكتب «مصطفى» في البحث.
  Assert: يظهر ADV-DEMO-5 فقط.

- **AD-04 — Stat tiles.** Assert: «الإجمالي»=5، «في انتظار الاعتماد»=1، «مصروفة»=2،
  «إجمالي المتبقي»=مجموع outstanding عبر كل السلف المصروفة فقط (4,000.00 +
  4,000.00 = 8,000.00 — السلف المعتمدة/المعلّقة/المرفوضة لا تدخل هذا المجموع).

- **AD-05 — Request advance: required fields.** Steps: اضغط «طلب سلفة»، اترك
  الموظف أو المبلغ أو تاريخ أول خصم فارغاً، احفظ. Assert: شريط أحمر «الموظف والمبلغ
  وتاريخ أول خصم مطلوبة.»

- **AD-06 — Installment count validation.** Steps: أدخل «عدد الأقساط» = 0 أو رقماً
  عشرياً. Assert: شريط أحمر «عدد الأقساط يجب أن يكون رقماً صحيحاً أكبر من صفر.» —
  الحد الأدنى الافتراضي في الحقل هو 3.

- **AD-07 — Equal-instalment schedule sums exactly to the advance.** Pre: مثال
  ADV-DEMO-1 (6,000.00 على 6 أقساط). Assert: كل قسط 1,000.00 بالضبط، مجموع الستة =
  6,000.00 تماماً — لا فائض ولا نقص كسري ولو بوحدة واحدة، بفضل خوارزمية الباقي
  الأكبر (`buildInstallmentSchedule`).

- **AD-08 — Uneven amount still sums exactly (largest-remainder check).** Steps:
  اطلب سلفة بمبلغ 1,000.00 على 3 أقساط. Assert: الأقساط الثلاثة تجمع 1,000.00
  تماماً (مثلاً 333.34 + 333.33 + 333.33) — لا خطأ تقريب متراكم.

- **AD-09 — Approve a pending advance.** Pre: ADV-DEMO-4 (هدى، بانتظار الاعتماد).
  Steps: افتح تفاصيلها، اضغط «اعتماد». Assert: الحالة تتحول إلى «معتمدة»؛ زرا
  «اعتماد»/«رفض» يختفيان ويظهر قسم «صرف السلفة».

- **AD-10 — Reject a pending advance, terminal.** Pre: سلفة اختبارية بانتظار
  الاعتماد. Steps: اضغط «رفض». Assert: الحالة تتحول إلى «مرفوضة»؛ لا أي إجراء آخر
  متاح بعدها (حالة نهائية، مطابقة لـADV-DEMO-5).

- **AD-11 — Disburse requires treasury + branch, posts the debt-asset entry.**
  Pre: ADV-DEMO-3 (سلمى، معتمدة). Steps: افتح تفاصيلها، اضغط «صرف» بلا اختيار خزينة/
  فرع أولاً. Assert: شريط أحمر «اختر الخزينة والفرع قبل الصرف.»؛ بعد اختيارهما
  والضغط «صرف»: النص التوضيحي يؤكد «يصدر سند صرف نقدي: مدين سلف الموظفين (1160) /
  دائن الخزينة.» — **أصل، وليس مصروفاً** — الحالة تتحول إلى «مصروفة»، حقل «سند
  الصرف» يظهر بمعرّف السند.

- **AD-12 — Recovery through payroll: installment count and outstanding move
  together.** Pre: ADV-DEMO-1 قبل اعتماد أي دورة رواتب = 6,000.00 متبقي، 0/6.
  Steps: (سياق تاريخي من بذرة الاختبار) بعد اعتماد دورتَي يونيو ويوليو. Assert:
  المتبقي = 4,000.00، الأقساط = **2/6** — أول قسطين يظهران «مسدد» في جدول الأقساط
  داخل اللوحة، والباقي يظهر «مسدد منه 0».

- **AD-13 — Reaching «مسددة» only when fully recovered — assert the rule, not a
  live example.** Assert (من الكود، `advance.ts`): `applyAdvanceRecovery` تقلب
  الحالة إلى «مسددة» فقط عندما يصبح `advanceOutstanding` صفراً أو أقل بعد تطبيق
  الاسترداد — أي بعد اعتماد الدورة الشهرية السادسة لـADV-DEMO-1 (لن تصل قبل ديسمبر
  2026 بمعدل قسط واحد شهرياً). لا سلفة تبلغ هذه الحالة ضمن الدورات الثلاث المزروعة
  حالياً — للتحقق الفعلي، اعتمد دورات رواتب متتالية حتى استرداد كامل ADV-DEMO-1 أو
  ADV-DEMO-2 وراقب الانتقال التلقائي.

- **AD-14 — Recovery never exceeds the outstanding balance.** Assert (من الكود):
  `applyAdvanceRecovery` يرفض أي مبلغ استرداد يتجاوز `advanceOutstanding` برسالة
  إنجليزية من نمط «Recovery amount (...) exceeds the advance's outstanding balance
  (...).» — الرواتب لا تسترد أكثر مما هو مستحق فعلياً.

- **AD-15 — Advance in a currency different from the run's is skipped with a
  named warning.** Assert (من الكود، `calculate-payroll-run.ts`): إن اختلفت عملة
  سلفة مصروفة عن عملة الدورة، يُضاف تحذير باسم الموظف ورقم السلفة «...بعملة {عملة} —
  لم تُخصم.» ولا يُخصم أي مبلغ منها في تلك الدورة. لا حالة كهذه في البذرة الحالية
  (كل شيء EGP) — سيناريو قاعدة فقط.

- **AD-16 — Employee-level outstanding aggregate (side panel field).** Pre: افتح
  تفاصيل أي سلفة لكريم عادل. Assert: بطاقة «إجمالي رصيد سلف الموظف» تُجمع كل سلف
  كريم المصروفة (وليس فقط السلفة المفتوحة حالياً) — لموظف بسلفة واحدة فقط، القيمتان
  متطابقتان.

- **AD-17 — Empty state / list error.** Assert: «لا توجد سلف — ابدأ بتسجيل طلب سلفة
  لموظف» / «تعذّر تحميل السلف.» + إعادة المحاولة.

- **AD-18 — Concurrent-action guard & error banner.** Steps: اضغط بسرعة «اعتماد» ثم
  «رفض» على نفس السلفة قبل استجابة الأولى. Assert: الأزرار معطّلة أثناء أي طلب واحد
  (`pendingId`)؛ عند فشل أي إجراء يظهر شريط أحمر برسالة الخادم أو الافتراضي المناسب.

---

### 10. طلبات الإجازات — Leave Requests, admin review (`leave-requests`)

`LeaveRequestsScreen.tsx`. **Pure review/decision list — no create form on this
screen at all** (creation lives only on إجازاتي, self-service — see ML-04 and the
gap note LR-01).

- **LR-01 `[NOT IMPLEMENTED]` — No admin-side "create a request on behalf of an
  employee".** Assert: لا يوجد زر «طلب إجازة جديد» ولا أي نموذج إنشاء على هذه
  الشاشة، رغم أن الكتالوج وصف صفحة كاملة `/hr/leave/requests/new`. المسؤول الذي
  يريد تقديم طلب نيابةً عن موظف لا يملك مساراً من هذه الشاشة؛ إجازاتي تعمل فقط
  للمستخدم المسجَّل دخوله ومربوط بسجل موظف.

- **LR-02 — List load, 11 rows.** Steps: افتح «طلبات الإجازات». Assert: 11 صفاً
  (LR-DEMO-1..11)؛ عمود «الفترة» بصيغة `{بداية} — {نهاية}`؛ عمود «عدد الأيام» يعرض
  0.5 لطلب هدى النصف-يوم (LR-DEMO-7).

- **LR-03 — Status chips: الكل(11) / بانتظار الموافقة(3) / موافق عليه(6) /
  مرفوض(1) / ملغى(1).** Assert: الأعداد مطابقة تماماً لتوزيع البذرة (6 موافَق،
  3 معلّق: LR-2/LR-7/LR-11، 1 مرفوض: LR-4، 1 ملغى: LR-10).

- **LR-04 — Chip counts are computed from the currently *filtered* set, not a
  global tally.** Steps: اختر «الموظف» = «محمد الشهابي» (له 3 طلبات: LR-9 موافق،
  LR-10 ملغى، LR-11 معلّق)، ثم انظر شرائح الحالة. Assert: «الكل»=3، «موافق عليه»=1،
  «ملغى»=1، «بانتظار الموافقة»=1 — الشرائح تعيد الحساب على الطلبات المصفّاة فقط،
  خلافاً لبطاقات الإحصاء العلوية (LR-05) التي تبقى ثابتة غير الرقم الإجمالي.

- **LR-05 — Top stat tiles are a SEPARATE, unfiltered global count.** Pre: نفس
  فلتر LR-04 (محمد الشهابي فقط) لا يزال مفعّلاً. Assert: بطاقات «الإجمالي/بانتظار
  الموافقة/موافق عليه/مرفوض/ملغى» العلوية تبقى **11/3/6/1/1** — غير متأثرة بفلتر
  الموظف، لأنها تأتي من `GET /hr/leave-requests/counts` المستقل، لا من القائمة
  المعروضة. هذا التبايُن المتعمَّد بين البطاقات والشرائح يستحق اختباراً صريحاً.

- **LR-06 — Employee filter.** Steps: اختر «مصطفى رزق». Assert: صف واحد فقط
  (LR-DEMO-8، بدون أجر، موافق عليه).

- **LR-07 — Leave-type filter (all 8, global list, not policy-scoped).** Steps:
  اختر «إجازة أبوة» (paternity) من «نوع الإجازة» رغم عدم وجود أي طلب أبوة في
  البذرة. Assert: القائمة فارغة («لا توجد نتائج مطابقة للفلتر الحالي») — القائمة
  تعرض الأنواع الثمانية كافة بصرف النظر عن سياسة أي موظف بعينه؛ لا تصفية سياسية من
  جهة العميل.

- **LR-08 — Date-range filter, no from≤to guard.** Steps: اضبط «من تاريخ» بعد «إلى
  تاريخ» (مثلاً من 2026-09-01 إلى 2026-01-01). Assert: لا رفض أو تحذير من جهة
  العميل — الحقلان نصّان حرّان بلا تحقق تسلسل؛ لاحظ سلوك النتائج الفعلي (على
  الأرجح فارغ) بدل افتراض رسالة خطأ.

- **LR-09 — Row actions appear only for «بانتظار الموافقة».** Pre: صف LR-DEMO-9
  (موافق عليه بالفعل). Assert: خانة الإجراءات فارغة تماماً — لا أزرار موافقة/رفض
  لأي طلب غير معلَّق. صف LR-DEMO-2 (معلَّق) يُظهر زرَي «موافقة»/«رفض».

- **LR-10 — Approve a pending request.** Pre: LR-DEMO-2 (كريم، إجازة عارضة، معلَّق).
  Steps: اضغط «موافقة». Assert: الحالة تتحول إلى «موافق عليه»؛ أزرار الصف تختفي؛
  الشريط «موافق عليه» في شارة الصف يتحول للون النجاح.

- **LR-11 — Reject a pending request with the exact server comment recorded.**
  Pre: طلب معلَّق اختباري. Steps: اضغط «رفض». Assert: الحالة تتحول إلى «مرفوض»؛ لا
  واجهة إدخال تعليق على هذه الشاشة — الحمولة المُرسلة دائماً `{decision: "reject",
  comment: null}`، بصرف النظر عن أي تعليق قد يكون مسجَّلاً في البذرة (مثل LR-DEMO-4
  الذي زُرع بتعليق «الفترة تتزامن مع الجرد السنوي» عبر واجهة برمجية مباشرة، لا عبر
  هذه الشاشة).

- **LR-12 — Approving a leave request that exceeds the employee's available
  balance is ACCEPTED, not refused.** Pre: اختر موظفاً برصيد منخفض متعمَّد (أنشئ
  طلباً بعدد أيام أكبر من «المتاح» الظاهر له في شاشة أرصدة الإجازات — LB). Steps:
  قدّم الطلب عبر إجازاتي (بصفتك ذلك الموظف)، ثم وافق عليه من هذه الشاشة. Assert:
  **لا رفض من جهة العميل ولا من الخادم** — الموافقة تنجح بلا أي تحذير مرئي على هذه
  الشاشة؛ الرصيد يصبح **سالباً** في شاشة أرصدة الإجازات (LB-06) بدل أن يُمنع الطلب.
  هذا سلوك موثّق في الكود (`consumeLeaveBalance`: «الرصيد يذهب سلباً ببساطة، وتُظهره
  المصفوفة») — تحقّق أن الرصيد السالب **يُعرض** فعلاً في LB (وليس مخفياً) كدليل على
  أن التجاوز «مُعلَّم» لا «صامت»، لكنه أيضاً **غير مرفوض**.

- **LR-13 — Workflow-hold banner when a leave-type approval chain is
  configured.** Pre: سلسلة موافقات مفعّلة لنوع إجازة معيّن (إعداد خارج نطاق هذه
  الشاشة). Steps: وافق على طلب من ذلك النوع. Assert: بدل تغيّر فوري، يظهر شريط
  محايد (`role="status"`) بنص «الطلب {رقم} بانتظار سلسلة الموافقات» مع لاحقة «—
  الدور المطلوب: {دور}» إن أعادها الخادم؛ حالة الطلب تبقى «بانتظار الموافقة» ظاهرياً
  حتى تكتمل السلسلة.

- **LR-14 — Concurrent-decision guard.** Steps: اضغط «موافقة» على صف، وقبل استجابة
  الخادم حاول الضغط «رفض» على صف آخر. Assert: كل أزرار القرار في **كل الصفوف**
  معطّلة أثناء أي قرار واحد قيد التنفيذ — تعطيل على مستوى الجدول كله، لا الصف
  المتأثر فقط.

- **LR-15 — Decision error path.** Pre: أفشل نقطة القرار. Assert: شريط أحمر برسالة
  الخادم أو الافتراضي «تعذّر اتخاذ القرار على طلب الإجازة.»

- **LR-16 — Empty state.** Steps: صفِّ بمجموعة لا تُرجع نتائج (مثل نوع «أبوة»).
  Assert: «لا توجد نتائج مطابقة للفلتر الحالي.»

- **LR-17 — Pagination inert / list load error.** Assert: `page=1 pageCount=1`
  دائماً؛ فشل التحميل → «تعذّر تحميل طلبات الإجازات.» + إعادة المحاولة.

---

### 11. أرصدة الإجازات — Leave Balances (`leave-balances`)

`LeaveBalancesScreen.tsx` — **not documented in the original catalog at all**;
genuinely new relative to that capture. Manual settlement only — no "recalculate"
action anywhere.

- **LB-01 — Year chips, current year default.** Steps: افتح «أرصدة الإجازات».
  Assert: ثلاث شرائح 2025/2026/2027، **2026 نشطة افتراضياً**، بلا عدّادات على
  الشرائح نفسها.

- **LB-02 — 2025 shows the four explicit closing-position rows.** Steps: اضغط
  «2025». Assert: 4 صفوف (كريم، سلمى، محمد، أحمد — إجازة سنوية فقط)؛ محمد الشهابي
  يعرض المستحق=30، المستخدم=25، المتاح=`30+0-25=5` (بلا ترحيل مسجَّل صراحة لعام
  2025 نفسه).

- **LB-03 — 2026 combines explicit carry-over rows with accrual-batch credits.**
  Steps: اختر «2026». Assert: صفوف أكثر من 2025 — تشمل الترحيل الصريح (مثلاً كريم
  carriedOver=6) مضافاً إليه أي استحقاق شهري/سنوي من دورات الاستحقاق الأربع
  (LA-01..04)، لكل نوع إجازة له سياسة نشطة، لكل موظف غير منتهي الخدمة.

- **LB-04 — Employee filter.** Steps: اختر «هدى مصطفى». Assert: صفوفها فقط، عبر
  كل أنواع الإجازة التي تراكم لها رصيد.

- **LB-05 — Columns and «المتاح» is server-computed, not client-derived.** Assert:
  الأعمدة الموظف / نوع الإجازة / المستحق / المرحّل / المستخدم / المتاح (بارز) —
  «المتاح» قيمة قادمة من الـDTO مباشرة، لا حساب `entitled+carriedOver-used` من جهة
  العميل (وإن كانت النتيجة الحسابية متطابقة عملياً).

- **LB-06 — A negative balance IS displayed, not hidden (companion to LR-12).**
  Pre: طلب إجازة موافق تجاوز الرصيد المتاح (LR-12). Steps: افتح صف الموظف/النوع
  المعنيّ لعام 2026. Assert: عمود «المتاح» يعرض قيمة **سالبة** بوضوح (مثال:
  `-2.5`) — لا تقريب إلى صفر، لا إخفاء الصف.

- **LB-07 — Manual settlement side panel («تسوية رصيد إجازة»).** Steps: اضغط
  «تسوية رصيد» من الرأس. Assert: نفس عنوان اللوحة يظهر سواء فُتحت من الرأس أو من زر
  «تعديل» أي صف — «تسوية رصيد إجازة» ثابت؛ الحقول: الموظف*، نوع الإجازة*، المستحق،
  المرحّل، المستخدم (الثلاثة الأخيرة نصوص حرة بلا تحقق رقمي من جهة العميل).

- **LB-08 — Required-field guard.** Steps: احفظ بلا اختيار موظف. Assert: شريط
  أحمر «الموظف مطلوب.»

- **LB-09 — Upsert semantics: editing a row while a different year chip is
  active targets the WRONG year.** Steps: اختر شريحة «2026»، اضغط «تعديل» على صف
  ينتمي فعلياً لعام 2025 (إن كان معروضاً بطريق الخطأ ضمن فلتر آخر)، عدّل واحفظ.
  Assert: القيمة المحفوظة تُكتب على `(employeeId, leaveType, year=2026)` — أي على
  سنة مختلفة عن سجل 2025 الأصلي — تحقق من عدم تسرّب هذا الخلل بمقارنة صفَّي 2025
  و2026 قبل وبعد الحفظ.

- **LB-10 `[NOT IMPLEMENTED]` — No "recalculate" or bulk-recompute action.**
  Assert: لا زر ولا رابط لإعادة احتساب الأرصدة على هذه الشاشة — الطريقة الوحيدة
  لتغيير رصيد هي التسوية اليدوية هنا أو تشغيل دورة استحقاق من شاشة الاستحقاقات.

- **LB-11 — Stat tile & pageSummary.** Assert: «عدد الأرصدة» = عدد الصفوف المصفّاة
  الحالية فقط؛ نص «عرض N رصيد لعام 2026».

- **LB-12 — Empty state / list error.** Assert: «لا توجد أرصدة إجازات — شغّل دورة
  استحقاق لإنشائها» (يوجّه المستخدم صراحة نحو شاشة الاستحقاقات كمصدر الإنشاء
  الطبيعي) / «تعذّر تحميل أرصدة الإجازات.» + إعادة المحاولة.

---

### 12. استحقاقات الإجازات — Leave Accrual Batches (`leave-accrual-batches`)

`LeaveAccrualBatchesScreen.tsx`. Append-only — no row action of any kind, no
detail drill-down despite the DTO carrying per-employee lines.

- **LA-01 — List shows all four seeded batches.** Steps: افتح «استحقاقات
  الإجازات». Assert: 4 صفوف — 2026-01-01 (سنوي، يدوي، «استحقاق سنوي — بداية
  ٢٠٢٦»)، 2026-06-30 (شهري، مجدول)، 2026-07-31 (شهري، مجدول)، 2026-08-31 (شهري،
  يدوي، «تشغيل يدوي بعد إضافة موظفي الإنتاج»).

- **LA-02 — Filter tabs الكل/مجدول/يدوي.** Steps: اضغط «مجدول». Assert: صفّان فقط
  (2026-06-30، 2026-07-31)؛ اضغط «يدوي» → صفّان (2026-01-01، 2026-08-31).

- **LA-03 — Run-type pill & notes column.** Assert: عمود «نوع التشغيل» شارة «يدوي»
  (محايدة) أو «مجدول» (معلوماتية)؛ عمود «ملاحظات» يعرض «—» للدفعتين المجدولتين
  (`notes: null`).

- **LA-04 — Stat tiles.** Assert: «عدد الدورات» = عدد الصفوف حسب التبويب النشط
  (4 على «الكل»)؛ «إجمالي الأيام» = مجموع `totalDays` عبر الدفعات المصفّاة، محسوب
  من جهة العميل لا من الخادم.

- **LA-05 — Run-now dialog fields & defaults.** Steps: اضغط «تشغيل استحقاق الآن».
  Assert: فقرة توضيحية ثابتة عن ترحيل قيد محاسبي وتحديث فوري للأرصدة؛ «تاريخ
  التشغيل *» نص حر افتراضي تاريخ اليوم بتوقيت UTC؛ «وتيرة الاستحقاق *» خياران فقط
  (شهرياً/سنوياً — **لا خيار «بدون استحقاق»** رغم وجوده على مستوى السياسة نفسها)
  افتراضي «شهرياً» مع تلميح «تُحتسب السياسات ذات نفس الوتيرة فقط»؛ «ملاحظات»
  اختياري.

- **LA-06 — Required-field guard.** Steps: امسح «تاريخ التشغيل»، احفظ. Assert:
  شريط أحمر «تاريخ التشغيل مطلوب.»

- **LA-07 — Running a NEW period credits balances and reports success.** Steps:
  شغّل دورة يدوية بتاريخ لم يُشغَّل من قبل (مثلاً 2026-09-30، شهري). Assert: شريط
  أخضر/محايد `role="status"` بنص «تم تشغيل دورة الاستحقاق {رقم} لفترة {الفترة}.»؛
  الدفعة الجديدة تظهر في الجدول؛ أرصدة الموظفين المؤهلين ترتفع فوراً في شاشة أرصدة
  الإجازات لنفس نوع الإجازة/التردد.

- **LA-08 — Idempotency: re-running an already-run period adds zero days.**
  Pre: دورة 2026-08-31 (شهرية) مُشغَّلة بالفعل. Steps: شغّل دورة يدوية جديدة بنفس
  الشهر (أي تاريخ يقع ضمن 2026-08) وبتردد «شهرياً». Assert: شريط الحالة يعرض النص
  البديل بالضبط: «فترة {الفترة} سبق تشغيلها في الدورة {الرقم} — لم تُضف أي أيام.»؛
  **لا صف جديد** يُضاف للجدول؛ لا تغيّر في أي رصيد إجازة.

- **LA-09 — Frequency scoping: a monthly run skips annual/none policies.** Pre:
  سياسة «إجازة مرضية» بتردد `annual`. Steps: شغّل دورة يدوية بتردد «شهرياً» لشهر لم
  يُشغَّل من قبل. Assert: رصيد الإجازة المرضية لا يتغيّر لأي موظف من هذه الدورة —
  فقط أنواع الإجازة بتردد `monthly` (مثل السنوية) تتأثر.

- **LA-10 `[NOT IMPLEMENTED]` — No row click / detail drill-down despite the API
  carrying per-employee lines.** Steps: اضغط أي صف دفعة. Assert: لا شيء يحدث — لا
  لوحة جانبية، لا صفحة تفصيلية؛ عقد `LeaveAccrualBatchDTO` يحمل مصفوفة `lines`
  (موظف/نوع إجازة/أيام) لكن الواجهة لا تعرضها في أي مكان — لا طريقة لمعرفة "من
  اعتُمد له كم يوماً" في دفعة بعينها من هذه الشاشة.

- **LA-11 — Empty state / list error.** Assert: «لا توجد دورات استحقاق بعد —
  ستظهر هنا كل دورات الاستحقاق المجدولة واليدوية» / «تعذّر تحميل دورات الاستحقاق.»
  + إعادة المحاولة.

- **LA-12 — Pagination inert.** Assert: `page=1 pageCount=1` دائماً.

---

### 13. سياسات الإجازات — Leave Policies (`settings/leave-policies`, HR-grouped)

`LeavePoliciesScreen.tsx`. Matrix table + two dated Egyptian-law presets. The seed
already applied `EG_LABOUR_LAW_14_2025` plus two manual rows — this is the one HR
screen that does **not** start from an empty state in the demo tenant.

- **LP-01 — Table shows 8 policy rows, not the catalog's "ships empty" state.**
  Steps: افتح «سياسات الإجازات». Assert: 8 صفوف (annual/sick/casual/maternity/
  paternity/unpaid من الإعداد + personal/emergency اليدويين) — الجدول **ليس
  فارغاً** رغم أن الكتالوج وصف الحالة الافتراضية كجدول فارغ ينتظر أول تطبيق إعداد.

- **LP-02 — Annual-leave row matches the 14/2025 preset exactly.** Steps: انظر صف
  «إجازة سنوية». Assert: الرصيد الأساسي=21، وتيرة الاستحقاق=شهرياً، الترحيل=نعم
  (بلا حد أقصى → «نعم» لا «حتى N يوم»)، صرف عند الإنهاء=نعم، إجباري قانوناً=شارة
  «إجباري».

- **LP-03 — Casual-leave row reflects the 2025 law's 7 days (not 2003's 6).**
  Assert: صف «إجازة عارضة» الرصيد الأساسي=7 — القيمة الخاصة بقانون 2025، لا 2003.

- **LP-04 — Paternity row exists only because 14/2025 was applied.** Assert: صف
  «إجازة أبوة» موجود (1 يوم، بدون استحقاق تلقائي، صرف عند الإنهاء=لا، إجباري
  قانوناً=إجباري) — هذا الصف غير موجود إطلاقاً في إعداد 12/2003.

- **LP-05 — Manual rows (personal, emergency) are NOT legally mandated and have
  no preset code.** Assert: صفا «الإجازة الشخصية» (5 أيام) و«إجازة طارئة» (3 أيام)
  يحملان شارة «اختياري» (غير إجباري)، والترحيل=لا لكليهما.

- **LP-06 — Applying a preset button disabled until one is chosen.** Steps:
  افتح قائمة «الإعداد»، لاحظ زر «تطبيق إعداد جاهز» قبل الاختيار. Assert: الزر
  معطّل بينما القيمة `""`؛ يتفعّل فقط بعد اختيار «مصر — قانون 12 لسنة 2003» أو «مصر
  — قانون 14 لسنة 2025».

- **LP-07 — Re-applying the OLDER preset (12/2003) overwrites matching rows,
  leaves paternity untouched.** Steps: اختر «مصر — قانون 12 لسنة 2003»، اضغط
  «تطبيق إعداد جاهز». Assert: شريط حالة «تم تطبيق الإعداد "مصر — قانون 12 لسنة
  2003".»؛ صف «إجازة عارضة» يرتد إلى 6 أيام؛ صف «إجازة أمومة» يرتد إلى 90 يوماً؛
  **صف «إجازة أبوة» يبقى كما هو دون حذف** (غير مذكور في إعداد 2003)؛ صفَّا الشخصية/
  الطارئة اليدويان يبقيان دون تغيير (خارج نطاق أي من الإعدادين).

- **LP-08 — Edit panel: leave type locked after creation.** Steps: اضغط أيقونة
  القلم على أي صف. Assert: «نوع الإجازة *» معطّل في وضع التعديل — لا تغيير النوع
  بعد الإنشاء؛ حقل «مفعّلة» يظهر فقط في وضع التعديل (غائب تماماً عند الإنشاء).

- **LP-09 — Conditional carry-over cap field.** Steps: في نموذج إنشاء/تعديل، فعِّل
  «ترحيل الرصيد للسنة التالية». Assert: يظهر فوراً حقل «حد الترحيل (أيام)» بتلميح
  «اتركه فارغاً لترحيل بدون حد»؛ إيقاف المفتاح يُخفي الحقل فوراً ويجبر القيمة
  المُرسلة `null` بصرف النظر عمّا كُتب فيه سابقاً.

- **LP-10 — Required-field guard.** Steps: أنشئ سياسة جديدة، امسح «الرصيد الأساسي»،
  احفظ. Assert: شريط أحمر «الرصيد الأساسي مطلوب.»

- **LP-11 — Negative entitlement rejected server-side, not client-side.** Steps:
  أدخل رصيداً أساسياً سالباً واحفظ. Assert: لا رفض فوري من الواجهة (الحقل نص حر
  بلا تحقق موجب/سالب)؛ الخادم يرفضه لاحقاً وتظهر رسالته في شريط الخطأ.

- **LP-12 — Delete a policy row, no confirmation, whole-table disable during
  any one delete.** Steps: احذف صف «الإجازة الشخصية»، وحاول حذف صفّ آخر فوراً قبل
  اكتمال الأول. Assert: الحذف الأول يُنفَّذ بلا تأكيد؛ كل أزرار الحذف الأخرى
  معطّلة أثناء تنفيذه.

- **LP-13 — Stat tiles.** Assert: «عدد السياسات»=8، «إجباري قانوناً»=عدد الصفوف
  `legallyMandated=true` (annual/sick/casual/maternity/paternity=5)، «قابلة
  للترحيل»=عدد `carryOver=true` (annual فقط=1).

- **LP-14 — Empty-preset selection is impossible without ready-made data.**
  `[NOT IMPLEMENTED as an empty-state test]` — بما أن الجدول ليس فارغاً في هذه
  البذرة (LP-01)، فإن نص الحالة الفارغة «لا توجد سياسات إجازات معدة حالياً...» لا
  يمكن ملاحظته إلا في مستأجر جديد بلا أي سياسة — وثّق النص فقط، لا تفترض ظهوره هنا.

- **LP-15 — List load error.** Assert: «تعذّر تحميل سياسات الإجازات.» + إعادة
  المحاولة.

---

### 14. إجازاتي — My Leave, self-service (`my-leave`)

`MyLeaveScreen.tsx`. Hand-rolled table (not `DocumentList`) — no stat tiles, no
filters, no pagination, no sorting, no search. The logged-in seed admin ends the
seeding script linked to **محمد الشهابي** (EMP-DEMO-3), so its own three requests
(LR-DEMO-9/10/11) are what this screen shows on login.

- **ML-01 — Linked account sees its own three requests.** Pre: تسجيل دخول بحساب
  المسؤول المزروع (مرتبط حالياً بمحمد الشهابي). Steps: افتح «إجازاتي». Assert: 3
  صفوف — إجازة طارئة (24–25 يونيو، موافق عليه)، إجازة عارضة (15 يوليو، **ملغى**)،
  إجازة سنوية (10–17 سبتمبر، بانتظار الموافقة).

- **ML-02 — Not-linked gate: exact copy, button and table both suppressed.**
  Pre: مستخدم غير مربوط بسجل موظف (`employeeId: null`). Steps: افتح «إجازاتي».
  Assert: لا زر «طلب إجازة»؛ لا جدول ولا حالة فارغة للجدول؛ بطاقة وحيدة بعنوان
  «غير مرتبط بموظف» ونص «حسابك غير مرتبط بسجل موظف. تواصل مع المسؤول.» — لا شيء
  آخر على الصفحة تحت العنوان.

- **ML-03 — Gate does not flash during initial load.** Steps: راقب الشاشة لحظة
  التحميل الأول لمستخدم غير مربوط (شبكة بطيئة). Assert: بطاقة «غير مرتبط بموظف»
  لا تظهر إلا بعد `!query.isLoading` — لا وميض للرسالة قبل استلام البيانات.

- **ML-04 — Request-leave side panel fields.** Pre: حساب مربوط. Steps: اضغط «طلب
  إجازة». Assert: «نوع الإجازة *» (قائمة الأنواع الثمانية كافة، افتراضي «سنوية»)؛
  «نصف يوم» (مفتاح، موقوف افتراضياً، تلميح «حدد يوماً واحداً وسيتم احتساب نصف يوم
  (0.5)»)؛ «تاريخ البداية *»؛ «تاريخ النهاية *»؛ «السبب» (اختياري).

- **ML-05 — Half-day toggle forces and locks the end date.** Steps: اكتب تاريخ
  بداية 2026-09-10 وتاريخ نهاية 2026-09-15، ثم فعِّل «نصف يوم». Assert: حقل تاريخ
  النهاية يصبح **معطّلاً** وقيمته المعروضة تُستبدل بتاريخ البداية (2026-09-10)؛ عند
  إلغاء تفعيل «نصف يوم» لاحقاً، تحقق مما إذا كانت القيمة المخزَّنة سابقاً
  (2026-09-15) تعود للظهور أو تبقى مقفلة على تاريخ البداية — الحالة الداخلية تحتفظ
  بالقيمة الأصلية فتحتاج تحققاً مباشراً من السلوك الفعلي بدل افتراضه.

- **ML-06 — Required-field guard.** Steps: احفظ بلا تاريخ بداية أو نهاية. Assert:
  شريط أحمر «تاريخ البداية والنهاية مطلوبان.»

- **ML-07 — No client-side balance check on submission — mirrors LR-12.** Steps:
  قدّم طلباً بعدد أيام يتجاوز الرصيد المتاح الظاهر لك في شاشة أرصدة الإجازات (لو
  كانت متاحة لحسابك). Assert: النموذج **لا يرفض الإرسال** بسبب تجاوز الرصيد — أي
  رفض، إن حدث، يأتي فقط من الخادم ويظهر نص رسالته الحرفي في الشريط الأحمر.

- **ML-08 — Successful submission, no page reload.** Steps: أرسل طلباً صالحاً.
  Assert: اللوحة تُغلق؛ الجدول يتحدّث في مكانه (بلا إعادة تحميل الصفحة) ليضم الطلب
  الجديد بحالة «بانتظار الموافقة».

- **ML-09 — Cancel button visible for BOTH pending and approved requests (wider
  than the admin screen).** Pre: طلب موافق عليه (LR-DEMO-9، إجازة طارئة). Steps:
  افتح إجازاتي. Assert: زر «إلغاء» ظاهر على هذا الطلب **الموافق عليه** — خلافاً
  لشاشة المسؤول (LR-09) التي تعرض إجراءات فقط للطلبات المعلَّقة، الموظف هنا يمكنه
  إلغاء طلب سبقت الموافقة عليه أيضاً.

- **ML-10 — Cancel a pending/approved request, no confirmation.** Steps: اضغط
  «إلغاء» على LR-DEMO-11 (بانتظار الموافقة). Assert: الحالة تتحول فوراً إلى «ملغى»
  بلا حوار تأكيد؛ زر الإلغاء يختفي (مطابق لحالة LR-DEMO-10 المزروعة أصلاً بهذه
  الطريقة).

- **ML-11 — Cancel button absent for rejected/cancelled requests.** Pre: طلب
  بحالة «ملغى» (LR-DEMO-10) بالفعل. Assert: لا زر «إلغاء» يظهر — حالة نهائية.

- **ML-12 — Concurrent-cancel guard.** Steps: اضغط «إلغاء» على صف، وقبل استجابة
  الخادم حاول الضغط «إلغاء» على صف آخر. Assert: كل أزرار الإلغاء معطّلة أثناء أي
  طلب واحد قيد التنفيذ.

- **ML-13 — Cancel error path.** Pre: أفشل نقطة الإلغاء. Assert: شريط أحمر برسالة
  الخادم أو الافتراضي «تعذّر إلغاء طلب الإجازة.»

- **ML-14 — Empty state for a linked employee with zero requests.** Pre: موظف
  مربوط بلا أي طلب إجازة (رابط حساباً اختبارياً بموظف جديد لم يُقدّم شيئاً). Assert:
  «لا توجد طلبات إجازة — لم تقدم أي طلب إجازة بعد.»

- **ML-15 — List load error is independent of the linked/not-linked gate.**
  Pre: أفشل `GET /hr/leave-requests/me`. Assert: بطاقة حمراء «تعذّر تحميل
  إجازاتي.» + إعادة المحاولة — تظهر بصرف النظر عن حالة الربط.

- **ML-16 `[NOT IMPLEMENTED]` — No stat tiles, filters, sort, search, or
  pagination.** Assert: الشاشة جدول خام فقط — لا شريط إحصاء، لا شرائح حالة، لا
  فلاتر تاريخ/نوع، لا بحث، لا ترقيم صفحات، بخلاف كل شاشات القوائم الإدارية الأخرى
  في هذا المستند التي تستخدم `DocumentList`.

---

### Cross-cutting notes carried into the scenarios above

- **No screen in the HR module shows a `confirm()`/modal dialog before a
  destructive or state-changing action** (deactivate, delete, terminate,
  transition, approve, reject, cancel, disburse) — every one fires on the single
  click. This is verified per-screen above (EM-33, DP-09, JT-07, HO-09, CT-17,
  PR-30, AD-10, LR-10/11, ML-10) rather than asserted once globally, since a
  regression could land on any one screen independently.
- **Transition/state-machine refusals surface in English** inside an otherwise
  Arabic-first UI (`Cannot transition payroll run from "draft" to "approved".`,
  `Cannot transition employee advance from "pending" to "disbursed".`, etc.) —
  worth a language-consistency note wherever a wrong-state action is forced
  through directly against the API rather than through the gated UI buttons.
- **Every list screen in HR hardcodes `page=1 pageCount=1`** — pagination
  controls never render anywhere in this module regardless of row count, and no
  column on any HR screen is sortable, even though the underlying `DocumentList`
  component supports both. Tested once per screen above rather than assumed.
- **No HR list screen shows a loading skeleton** — while a query is in flight,
  every screen renders as if the result were already an empty list, so the
  "empty state" text can flash transiently before real data arrives. Relevant
  wherever an empty-state scenario is asserted above.

---

# 10. CRM, projects, assets, field sales, installments


Sources: `docs/archive/catalog/06-crm-hr.md` (CRM half only — HR is out of scope here),
`docs/archive/catalog/07-mfg-projects-assets.md` (Projects / Fixed Assets / Field
Sales sections only — Manufacturing is out of scope), `docs/archive/catalog/05-pos-installments.md`
(Installments half only — POS is out of scope), cross-checked against the
actual code in `apps/web/src/screens/` (`LeadsScreen`, `OpportunitiesScreen`,
`PipelineScreen`, `PipelineStagesScreen`, `ActivitiesScreen`, `ProjectsScreen`,
`AssetRegisterScreen`, `AssetCategoriesScreen`, `DepreciationRunsScreen`,
`VanTripsScreen`, `InstallmentPlansScreen`, `InstallmentFollowUpsScreen`, the
two hub screens) and their domain logic under `packages/domain/src/{crm,projects,fixed-assets,field-sales,installments}`.

**This app has no per-screen URLs** — it is a single-page shell where the
sidebar sets an in-memory screen key (`navigate("leads")` etc.), not a router
with addressable paths. "Steps" below describe the sidebar click path, not a
URL. Nav groups used: **إدارة علاقات العملاء** (`crm`: نظرة عامة، العملاء
المحتملون، الفرص، خط المبيعات، مراحل خط المبيعات، الأنشطة), **المشاريع**
(`projects`: المشاريع والمقاولات), **الأصول الثابتة** (`assets`: نظرة عامة،
سجل الأصول، الإهلاك، تصنيفات الأصول), **المبيعات الميدانية** (`field`: رحلات
المندوبين), **الأقساط** (`installments`: خطط الأقساط، متابعة التحصيل).

The catalog was captured against an **empty tenant** (0 leads, 0 opportunities,
0 projects, 0 assets) and, in places, against an **earlier build** — several
catalog-documented fields/filters/tabs do not exist in the code read for this
pass. Every such gap is called out inline and rolled up in §7.

**Seed reference** (`packages/backend/src/demo-seed/crm.ts` +
`packages/backend/src/demo-seed/treasury.ts`, run via `MEZAN_SEED_DEMO=1`):

- Leads: LEAD-DEMO-1..6 (محمد سامي/جديد, هالة عبد الرحمن/تم التواصل, أحمد
  جلال/مؤهل, منى إبراهيم/محول → CUST-DEMO-LEAD4 + OPP-DEMO-7, كريم لطفي/غير
  مؤهل, سارة يوسف/خسارة).
- Opportunities: OPP-DEMO-1..7 across all 7 pipeline stages (عميل محتمل ×1,
  تواصل أولي ×1, عرض سعر ×2, تفاوض ×1, مراجعة نهائية ×0, تم الإغلاق ×1 مكسوبة,
  خسارة ×1 خسارة). Total expected value 710,000.00 ج.م; won value 95,000.00 ج.م.
- Activities: ACT-DEMO-1..6 — 3 pending, 2 completed, 1 cancelled; types call
  ×2, meeting ×2, todo ×1, email ×1.
- Projects: PRJ-DEMO-1..5, one per status (TOWER-A/active, WH-EXP/planned,
  FITOUT-BR2/completed, MAINT-Q3/on_hold, OLD-SITE/cancelled).
- Asset categories: FA-01 (Equipment & Machinery, 60mo/10%), FA-02 (Vehicles,
  96mo/15%), FA-03 (Computers & Office, 36mo/5%) — all three share GL accounts
  5400 (depreciation expense) / 1590 (accumulated depreciation).
- Assets: AST-0001..0006 across all 3 categories, acquired 2022-05-20 through
  2026-02-01, total acquisition cost 1,631,000.00 ج.م, **zero depreciation runs
  seeded** — all 6 start `active` with 0 accumulated depreciation.
- Van trips: TRIP-DEMO-1 (settled: opening float 1,000.00 + one 200.00 cash
  sale = expected 1,200.00; counted 950.00 → variance **-250.00**; loaded
  20×ITEM-DEMO-1/30×ITEM-DEMO-3, counted 18/30 → stock variance **-2 / 0**),
  TRIP-DEMO-2 (ongoing, opening float 1,500.00, no movements yet).
- Installments: IPLAN-DEMO-1 (docNo `IP-000001`, customer مجموعة الفجر
  التجارية, source invoice INV-000003 total 6,634.80 ج.م, down payment 995.22
  = 15%, 6 monthly installments of 939.93 each starting 18/08/2026, confirmed,
  overdue batch already run once) — installment #1 (due 18/08/2026) is
  overdue; #2–#6 (due 18/09/2026 → 18/01/2027) are pending.

Money is scaled-integer everywhere; displayed figures below are the exact
computed values (verified against the domain math), not approximations.
`ROADMAP.md` §5 open defects are cited as **D1**–**D6** where a scenario
hits one — only **D1** (collection vouchers never move `amountPaid`) is
reachable from this file's five domains.

---

### 1. إدارة علاقات العملاء — CRM

#### 1.1 نظرة عامة — CRM Hub (`crm-hub`)

**CRM-01 — Hub loads live KPIs**
- Pre: seeded tenant.
- Steps: افتح مجموعة "إدارة علاقات العملاء" من الشريط الجانبي (تفتح على "نظرة عامة" تلقائياً).
- Assert: بطاقة "عملاء محتملون جدد" = 1 من 6 (LEAD-DEMO-1 هو الوحيد بحالة "جديد")؛ "الفرص المفتوحة" = 5؛ "القيمة المتوقعة للفرص المفتوحة" = مجموع الفرص المفتوحة فقط (60,000+150,000+85,000+220,000+60,000 = 575,000.00 ج.م، بدون الفرصتين المغلقتين)؛ "أنشطة قيد الانتظار" = 3.

**CRM-02 — Recent activities list, newest first, capped at 5**
- Pre: 6 seeded activities.
- Steps: انظر بطاقة "أحدث الأنشطة".
- Assert: تظهر 5 عناصر فقط (وليس 6) مرتبة تنازلياً حسب `createdAt`؛ كل سطر يعرض النوع (مكالمة/اجتماع/مهمة/بريد) والحالة (قيد الانتظار/منجزة/ملغاة) لا رمز الحالة الخام.

**CRM-03 — Quick actions navigate to the right screen**
- Steps: اضغط "عميل محتمل جديد"، ثم ارجع للـHub واضغط "فرصة جديدة"، ثم "خط المبيعات"، ثم "نشاط جديد" (بالترتيب، كل مرة ترجع للـHub).
- Assert: كل زر ينقل فعلياً للشاشة المطابقة (العملاء المحتملون / الفرص / خط المبيعات / الأنشطة) — لا يوجد أي مربع حوار منبثق من الـHub نفسه.

**CRM-04 — Empty-activities state** `[requires a fresh/zero-record tenant]`
- Assert: عند عدم وجود أي نشاط، تظهر رسالة "لا توجد أنشطة بعد — ستظهر هنا فور تسجيل أول نشاط." بدل القائمة.

---

#### 1.2 العملاء المحتملون — Leads (`leads`)

**CRM-05 — List columns and seeded rows**
- Steps: افتح "العملاء المحتملون".
- Assert: الأعمدة الاسم/الشركة/المصدر/الحالة/القيمة المتوقعة/تاريخ الإنشاء؛ 6 صفوف؛ صف محمد سامي بحالة "جديد" وقيمة متوقعة 45,000.00 ج.م؛ صف كريم لطفي بحالة "غير مؤهل" وقيمة متوقعة "—" (لا توجد قيمة).

**CRM-06 — Status chips filter with live counts**
- Steps: افتح شريط الفلاتر أعلى الجدول.
- Assert: الرقاقات الكل(6)/جديد(1)/تم التواصل(1)/مؤهل(1)/محول(1)/خسارة(1)/غير مؤهل(1) — كل قيمة صحيحة على البيانات المزروعة.
- Steps: اضغط رقاقة "محول".
- Assert: يظهر صف منى إبراهيم فقط.

**CRM-07 — Search by name and by company**
- Steps: اكتب "الدلتا" في مربع البحث "بحث بالاسم أو الشركة...".
- Assert: يظهر صف أحمد جلال فقط (يطابق اسم الشركة "مؤسسة الدلتا للتوريدات").
- Steps: امسح البحث واكتب "سامي".
- Assert: يظهر صف محمد سامي فقط (يطابق الاسم).

**CRM-08 — Create lead: only name is required**
- Steps: اضغط "عميل محتمل جديد" ثم "إضافة" بدون تعبئة أي حقل.
- Assert: رسالة خطأ "الاسم مطلوب." تحت الحقل، والنافذة تبقى مفتوحة.

**CRM-09 — Create lead: full field set and defaults**
- Steps: اضغط "عميل محتمل جديد". لاحظ القيم الافتراضية.
- Assert: الحقول المتاحة بالضبط: الاسم*، الشركة، البريد الإلكتروني، الهاتف، المصدر (قائمة منسدلة تبدأ على "أخرى")، القيمة المتوقعة (حقل مبلغ)، الاهتمام، ملاحظات. **لا يوجد** منتقي كود دولة للهاتف ولا قائمة دول كاملة كما وصفها الكتالوج القديم — الهاتف حقل نصي بسيط `[NOT IMPLEMENTED]`.
- Steps: عبّئ الاسم "عميل اختبار"، اضغط "إضافة".
- Assert: يُنشأ العميل المحتمل بحالة "جديد" ويظهر أعلى/داخل القائمة فوراً.

**CRM-10 — Lead detail panel: read-only fields**
- Steps: اضغط صف "أحمد جلال".
- Assert: تُفتح لوحة جانبية بعنوان اسم العميل المحتمل، وتعرض شارة الحالة "مؤهل" وبطاقات الشركة/المصدر/البريد/الهاتف والقيمة المتوقعة (85,000.00 ج.م) والاهتمام ("عقد توريد سنوي") والملاحظات.

**CRM-11 — Status transition buttons match the state machine exactly**
- Pre: LEAD-DEMO-1 (محمد سامي) بحالة "جديد".
- Steps: افتح لوحته الجانبية.
- Assert: تظهر بالضبط 3 أزرار انتقال: "تم التواصل"، "غير مؤهل"، "خسارة" — لا زر "مؤهل" مباشرة من "جديد" (يجب المرور بـ"تم التواصل" أولاً).
- Steps: اضغط "تم التواصل".
- Assert: الحالة تتحول فوراً إلى "تم التواصل"؛ الأزرار المتاحة الآن تصبح "مؤهل"/"غير مؤهل"/"خسارة".

**CRM-12 — Terminal statuses show no actions**
- Pre: LEAD-DEMO-5 (كريم لطفي) بحالة "غير مؤهل" أو LEAD-DEMO-6 (سارة يوسف) بحالة "خسارة".
- Steps: افتح لوحة أي منهما.
- Assert: نص "لا توجد إجراءات متاحة على هذا العميل المحتمل." بدل أي زر — لا يوجد أي مسار للرجوع لحالة سابقة.

**CRM-13 — Qualified lead: transition options are just "خسارة" plus "تحويل"**
- Pre: LEAD-DEMO-3 (أحمد جلال) بحالة "مؤهل".
- Steps: افتح لوحته.
- Assert: يظهر زر انتقال واحد فقط "خسارة"، بالإضافة إلى زر منفصل "تحويل" (وليس ضمن قائمة الانتقالات) — مطابق لكون "مؤهل → محول" فعل تحويل منفصل لا انتقال حالة عادي.

**CRM-14 — Convert a qualified lead creates both a customer and an opportunity** (Behaviour hint)
- Pre: LEAD-DEMO-3 (أحمد جلال، الشركة "مؤسسة الدلتا للتوريدات"، قيمة متوقعة 85,000.00 ج.م) بحالة "مؤهل".
- Steps: افتح لوحته، اضغط "تحويل". لاحظ الافتراضات: "إنشاء عميل" مفعّل، كود العميل الافتراضي = "أحمد جلال" (مأخوذ من الاسم لا اسم الشركة، لأول 20 حرفاً)، "إنشاء فرصة" مفعّل، عنوان الفرصة الافتراضي = "أحمد جلال — فرصة"، المرحلة الافتراضية = أول مرحلة نشطة ("عميل محتمل")، القيمة المتوقعة = 85,000.00 ج.م (منسوخة من العميل المحتمل)، الاحتمالية % الافتراضية = **50** (ثابتة، وليست احتمالية المرحلة الافتراضية 10%).
- Steps: اضغط "تحويل" لتنفيذ العملية.
- Assert: يُنشأ عميل جديد بالكود "أحمد جلال" واسم عربي = اسم الشركة "مؤسسة الدلتا للتوريدات"؛ تُنشأ فرصة جديدة بعنوان "أحمد جلال — فرصة" بمرحلة "عميل محتمل"، **احتمالية 50%** (وليس 10% رغم أن هذا هو الافتراضي لتلك المرحلة — التحويل لا يمر عبر نفس منطق `moveOpportunityStage` الذي تستخدمه لوحة "خط المبيعات")، حالة "مفتوحة"؛ العميل المحتمل يتحول لحالة "محول" وتختفي كل أزرار الإجراء.
- Steps: افتح شاشة "الفرص" وابحث عن "أحمد جلال — فرصة".
- Assert: الفرصة موجودة فعلاً وتشير لنفس العميل الذي أُنشئ للتو — لا مرجع معلّق (dangling reference).

**CRM-15 — Converted lead detail does NOT show a link to what it became** `[gap]`
- Pre: LEAD-DEMO-4 (منى إبراهيم) بحالة "محول" (زُرع محوَّلاً بالفعل إلى العميل CUST-DEMO-LEAD4 والفرصة OPP-DEMO-7).
- Steps: افتح صف منى إبراهيم.
- Assert: اللوحة تعرض شارة "محول" فقط ونص "لا توجد إجراءات متاحة..." — **لا يوجد أي نص أو رابط يعرض اسم العميل أو الفرصة التي نتجت عن التحويل**، رغم أن الـAPI (`convertedCustomerId`/`convertedOpportunityId`) يخزّن هذا الربط فعلياً. `[NOT IMPLEMENTED]` — لا يوجد مسار نقر واحد من شاشة العملاء المحتملين لرؤية ما تحوّل إليه عميل محتمل.
- Steps (تحقق غير مباشر): افتح شاشة "الفرص" وابحث عن "تعاقد توريد مكونات غذائية - الواحة".
- Assert: الفرصة موجودة، بعميل حقيقي غير معلّق — الربط سليم في البيانات، الفجوة في العرض فقط.

**CRM-16 — Convert form: unchecking "إنشاء عميل"/"إنشاء فرصة" narrows validation**
- Pre: أي عميل محتمل بحالة "مؤهل" غير محوَّل بعد (استخدم عميلاً محتملاً جديداً حُوِّل حالته يدوياً إلى "مؤهل" إن نفد LEAD-DEMO-3).
- Steps: افتح "تحويل"، أطفئ مفتاح "إنشاء عميل".
- Assert: يختفي حقل "كود العميل *".
- Steps: أطفئ أيضاً "إنشاء فرصة"، ثم اضغط "تحويل".
- Assert: العملية تنجح — لا عميل ولا فرصة يُنشآن، والعميل المحتمل ينتقل مباشرة لحالة "محول" مع `customerId`/`opportunityId` كليهما فارغين.

**CRM-17 — Convert form validation: opportunity fields required when creating an opportunity**
- Steps: افتح "تحويل"، اترك "إنشاء فرصة" مفعّلاً، امسح حقل "عنوان الفرصة *" بالكامل، اضغط "تحويل".
- Assert: رسالة "عنوان الفرصة والمرحلة مطلوبان لإنشاء فرصة جديدة." والنافذة تبقى مفتوحة.

**CRM-18 — Pagination summary line**
- Assert: أسفل الجدول "عرض 6 من 6 عميل محتمل" (نص عربي مرقّم، بدون صفحات فعلية لأن كل شيء ≤ 25).

---

#### 1.3 الفرص — Opportunities (`opportunities`)

**CRM-19 — List columns and KPIs**
- Steps: افتح "الفرص".
- Assert: بطاقات الإجمالي=7، مفتوحة=5، مكسوبة=1، القيمة المتوقعة=710,000.00 ج.م (مجموع كل الفرص السبع، وليس المفتوحة فقط)؛ الأعمدة العنوان/العميل/المرحلة/الاحتمالية/القيمة المتوقعة/تاريخ الإغلاق المتوقع/الحالة.

**CRM-20 — Status chips**
- Steps: اضغط رقاقة "مكسوبة".
- Assert: يظهر صف واحد فقط: "تجديد تعاقد التوريد السنوي" بمرحلة "تم الإغلاق" واحتمالية 100%.
- Steps: اضغط رقاقة "خسارة".
- Assert: يظهر صف واحد: "توريد مواد تعبئة وتغليف" بمرحلة "خسارة" واحتمالية 0%.

**CRM-21 — Rows are NOT clickable — no detail view** `[gap]`
- Steps: اضغط على أي صف فرصة (مثلاً "توسعة تعاقد سنوي").
- Assert: **لا شيء يحدث** — لا لوحة جانبية ولا صفحة تفاصيل تُفتح. `[NOT IMPLEMENTED]` تعديل المرحلة أو أي حقل آخر لفرصة قائمة من هذه الشاشة؛ التعليق في الكود نفسه يقول "Stage moves happen from the Pipeline board" — أي مسار الوحيد لتغيير مرحلة فرصة هو شاشة "خط المبيعات" (انظر §1.4).

**CRM-22 — Create opportunity: required fields**
- Steps: اضغط "فرصة جديدة"، اضغط "إضافة" فوراً بدون تعبئة شيء.
- Assert: رسالة "العنوان مطلوب." (أول رسالة تحقق تُعرض حسب ترتيب الفحص في الكود).
- Steps: عبّئ العنوان فقط، اضغط "إضافة".
- Assert: رسالة "العميل مطلوب."

**CRM-23 — Create opportunity: full field set and submit**
- Steps: اضغط "فرصة جديدة". عبّئ العنوان "فرصة اختبار"، اختر العميل "مجموعة الفجر التجارية" عبر منتقي العميل (يظهر الاسم مع الكود C-0003 كنص فرعي)، اترك المرحلة على الافتراضي (أول مرحلة نشطة "عميل محتمل")، اضبط القيمة المتوقعة 10,000، غيّر الاحتمالية % إلى 25، اترك تاريخ الإغلاق فارغاً، اضغط "إضافة".
- Assert: تُنشأ فرصة جديدة بحالة "مفتوحة"، احتمالية 25% (القيمة المُدخلة يدوياً، وليست احتمالية المرحلة الافتراضية 10% — إنشاء فرصة لا يستدعي `moveOpportunityStage` إطلاقاً)، وتاريخ الإغلاق "—".

**CRM-24 — Search by title only**
- Steps: اكتب "تعبئة" في مربع البحث "بحث بالعنوان...".
- Assert: يظهر صف "توريد مواد تعبئة وتغليف" فقط — البحث لا يطابق اسم العميل أو المرحلة.

---

#### 1.4 خط المبيعات — Sales Pipeline (`pipeline`)

**CRM-25 — Board renders all 7 stages as columns, including the loss stage inline**
- Steps: افتح "خط المبيعات".
- Assert: 7 أعمدة بنفس ترتيب مراحل §1.5 بالضبط: عميل محتمل(1)، تواصل أولي(1)، عرض سعر(2)، تفاوض(1)، مراجعة نهائية(0 — "لا توجد فرص")، تم الإغلاق(1)، خسارة(1). عمود "خسارة" **عمود عادي بجانب البقية** — لا يوجد فصل بصري منفصل كما وصفه الكتالوج القديم.

**CRM-26 — KPI strip**
- Assert: "إجمالي الفرص"=7، "القيمة المتوقعة"=710,000.00 ج.م، "فرص مكسوبة"=1، "قيمة المكسوب"=95,000.00 ج.م.

**CRM-27 — No filters panel, no stale-deal KPI, no board/list view toggle** `[gap]`
- Assert: لا يوجد أي من التالي رغم وصف الكتالوج له: لوحة "تصفية النتائج" (لا فلتر عميل ولا نطاق قيمة)، مربع "الراكدة فقط"، مؤشر "فرص راكدة"، أو مبدّل "عرض مراحل / عرض كلوحة". `[NOT IMPLEMENTED]` — الشاشة الفعلية عرض كانبان واحد ثابت فقط.

**CRM-28 — Move an open opportunity via the per-card select (no drag-and-drop)**
- Pre: OPP-DEMO-1 "توريد أرز وسكر بالجملة" في عمود "عميل محتمل"، احتمالية 10%، مفتوحة.
- Steps: في بطاقة الفرصة داخل عمود "عميل محتمل"، افتح القائمة المنسدلة "نقل إلى" واختر "تفاوض".
- Assert: البطاقة تختفي من عمود "عميل محتمل" وتظهر في عمود "تفاوض"؛ احتمالية الفرصة تتحدث تلقائياً إلى **60%** (احتمالية مرحلة "تفاوض" الافتراضية، وليست القيمة اليدوية السابقة 10%) — الفرصة تبقى "مفتوحة" لأن "تفاوض" ليست مرحلة فوز ولا خسارة.

**CRM-29 — Opportunity status follows the destination stage's win/loss flag** (Behaviour hint)
- Pre: أي فرصة مفتوحة (مثال: OPP-DEMO-2 "عقد توريد مواد بناء لموقع جديد"، احتمالية 20%).
- Steps: انقلها عبر "نقل إلى" مباشرة إلى "تم الإغلاق".
- Assert: تنتقل فوراً لعمود "تم الإغلاق"، احتمالية تصبح **100%**، الحالة تتحول من "مفتوحة" إلى **"مكسوبة"** تلقائياً — بدون أي خطوة إضافية أو تأكيد منفصل لتغيير الحالة.
- Steps: انقل فرصة مفتوحة أخرى مباشرة إلى "خسارة".
- Assert: احتمالية تصبح 0%، الحالة تتحول تلقائياً إلى **"خسارة"**.

**CRM-30 — Won/lost opportunities lose their move control**
- Pre: OPP-DEMO-5 (مكسوبة) وOPP-DEMO-6 (خسارة).
- Steps: افتح عمودي "تم الإغلاق" و"خسارة".
- Assert: بطاقات هاتين الفرصتين **لا تحتوي على قائمة "نقل إلى"** — لا مسار للتراجع عن حالة مغلقة من لوحة الخط.

**CRM-31 — Moving to the same stage is a no-op**
- Steps: في فرصة مفتوحة، اختر من "نقل إلى" نفس المرحلة الحالية.
- Assert: لا يُرسل أي طلب شبكة ولا يتغير شيء (الكود يمنع الاستدعاء عندما `stageId === opportunity.stageId`).

**CRM-32 — "إضافة فرصة" opens the same shared create form**
- Steps: اضغط "إضافة فرصة".
- Assert: تُفتح لوحة جانبية بعنوان "إضافة فرصة" بنفس حقول نموذج §1.3 CRM-23 بالضبط (نموذج مشترك `CreateOpportunityForm`).

**CRM-33 — Empty column copy**
- Assert: عمود "مراجعة نهائية" (0 فرص) يعرض "لا توجد فرص" داخل صندوق متقطع الحدود.

---

#### 1.5 مراحل خط المبيعات — Pipeline Stages (`pipeline-stages`)

**CRM-34 — Seeded 7 stages, order and type**
- Steps: افتح "مراحل خط المبيعات".
- Assert: 7 صفوف بالترتيب 1–7: عميل محتمل(10%، مفتوحة)، تواصل أولي(20%، مفتوحة)، عرض سعر(40%، مفتوحة)، تفاوض(60%، مفتوحة)، مراجعة نهائية(80%، مفتوحة)، تم الإغلاق(100%، مرحلة فوز)، خسارة(0%، مرحلة خسارة). كل الصفوف "نشطة".
- Assert (بطاقات الملخص): إجمالي المراحل=7، مراحل نشطة=7، مرحلة الفوز="تم الإغلاق"، مرحلة الخسارة="خسارة".

**CRM-35 — Reorder: boundary arrows are disabled**
- Steps: افحص صف "عميل محتمل" (الأول).
- Assert: زر "نقل للأعلى" معطّل.
- Steps: افحص صف "خسارة" (الأخير).
- Assert: زر "نقل للأسفل" معطّل.

**CRM-36 — Reorder a middle stage**
- Steps: في صف "تواصل أولي" (الترتيب 2)، اضغط "نقل للأعلى".
- Assert: تتبادل مع "عميل محتمل" — "تواصل أولي" يصبح الترتيب 1 والعكس؛ الجدول يعيد الترتيب فوراً.

**CRM-37 — No edit or delete/deactivate action exists** `[gap]`
- Steps: افحص عمود الإجراءات لأي صف.
- Assert: يوجد فقط سهما إعادة الترتيب — **لا يوجد زر "تعديل" ولا "حذف"/"تعطيل"** رغم أن الكتالوج القديم وصفهما. تعليق الكود صريح: "This MVP's API only supports create + up/down reorder (no edit/deactivate endpoint)". `[NOT IMPLEMENTED]`

**CRM-38 — Create stage: win/loss toggles are mutually exclusive**
- Steps: اضغط "إضافة مرحلة"، فعّل "مرحلة فوز".
- Assert: مفتاح "مرحلة خسارة" يبقى مطفأ ولا يمكن الجمع.
- Steps: الآن فعّل "مرحلة خسارة" (بدلاً من فوز).
- Assert: مفتاح "مرحلة فوز" ينطفئ تلقائياً — لا يمكن أبداً أن يكون الاثنان مفعّلين معاً من الواجهة.

**CRM-39 — Create stage: required field and defaults**
- Steps: اضغط "إضافة مرحلة"، اضغط "إضافة" فوراً.
- Assert: "اسم المرحلة مطلوب."
- Steps: عبّئ "مرحلة اختبار"، لاحظ القيم الافتراضية: الاحتمالية 50%، اللون `#3b82f6`.
- Steps: اضغط "إضافة".
- Assert: مرحلة جديدة تُضاف في نهاية الترتيب (الرقم 8)، نشطة، نوعها "مفتوحة" (بما أن كلا مفتاحي الفوز/الخسارة أُبقيا فارغين).

---

#### 1.6 الأنشطة — Activities (`crm-activities`)

**CRM-40 — List columns, KPIs, and status chips**
- Steps: افتح "الأنشطة".
- Assert: بطاقات الإجمالي=6، معلق=3، مكتمل=2، ملغى=1؛ رقاقات الكل(6)/معلق(3)/مكتمل(2)/ملغى(1)؛ الأعمدة الموضوع/النوع/الحالة/تاريخ الاستحقاق — **بعنوان عربي حقيقي "الموضوع"**، وليس مفتاح i18n خام كما رصد الكتالوج القديم (`crm.activitySubject`) — تلك مشكلة مُصلحة في هذا البناء.

**CRM-41 — Create activity form has NO lead/opportunity linking field** `[gap]`
- Steps: اضغط "نشاط جديد".
- Assert: الحقول بالضبط: الموضوع*، النوع (مكالمة/اجتماع/مهمة/بريد إلكتروني، افتراضي "مكالمة")، تاريخ الاستحقاق، ملاحظات. **لا يوجد أي حقل لربط النشاط بعميل محتمل أو فرصة** — رغم أن نموذج البيانات يدعم ذلك (الأنشطة المزروعة مرتبطة فعلاً)، أي نشاط يُنشأ من هذه الشاشة سيكون دائماً بلا `relatedLeadId`/`relatedOpportunityId`. `[NOT IMPLEMENTED]`

**CRM-42 — Create activity: required field**
- Steps: اضغط "نشاط جديد"، اضغط "إضافة" فوراً.
- Assert: "الموضوع مطلوب."
- Steps: عبّئ "نشاط اختبار"، اضغط "إضافة".
- Assert: نشاط جديد بحالة "معلق" يظهر في القائمة.

**CRM-43 — Complete a pending activity**
- Pre: ACT-DEMO-1 "مكالمة متابعة أولى" (معلق).
- Steps: في صف النشاط، اضغط "إكمال".
- Assert: الحالة تتحول فوراً إلى "مكتمل"؛ أزرار الإجراء تختفي من الصف (تصبح "—").

**CRM-44 — Cancel a pending activity**
- Pre: ACT-DEMO-2 "اجتماع عرض المنتج" (معلق).
- Steps: اضغط "إلغاء" في صفه.
- Assert: الحالة تتحول إلى "ملغى".

**CRM-45 — Completed/cancelled activities show no action buttons**
- Pre: ACT-DEMO-3 (مكتمل) وACT-DEMO-6 (ملغى).
- Assert: عمود الإجراءات لكليهما يعرض "—" فقط — لا مسار للتراجع عن إكمال أو إلغاء نشاط.

**CRM-46 — Search by subject**
- Steps: اكتب "توقيع" في "بحث بالموضوع...".
- Assert: يظهر صف "اجتماع توقيع نهائي" فقط.

**CRM-47 — Concurrent action guard**
- Pre: قائمة تحتوي عدة صفوف معلقة.
- Steps: اضغط "إكمال" على صف، وقبل استقرار الاستجابة حاول الضغط على "إلغاء" في صف آخر بسرعة.
- Assert: الزر الثاني معطّل أثناء معالجة الأول (`pendingId` واحد للشاشة كلها يمنع أي إجراء متزامن ثانٍ) — طبقاً لقاعدة "لا تعطيل كل الصفوف، بل امنع التزامن فقط"، لكن التنفيذ الفعلي هنا **يعطّل كل أزرار "إكمال"/"إلغاء" في كل الصفوف** أثناء معالجة أي صف واحد (علم `pendingId` عام لا لكل صف) — سلوك أوسع من المطلوب مثالياً، لكنه يمنع التزامن فعلياً.

---

### 2. المشاريع والمقاولات — Projects (`projects`)

**PRJ-01 — List columns, KPIs, status chips**
- Steps: افتح مجموعة "المشاريع" ← "المشاريع والمقاولات".
- Assert: بطاقات إجمالي المشاريع=5، نشط=1، مخطط=1، مكتمل=1؛ رقاقات الكل(5)/مخطط(1)/نشط(1)/متوقف مؤقتاً(1)/مكتمل(1)/ملغي(1) — تغطية شاملة، كل حالة ممثلة مرة واحدة بالضبط.
- Assert (الأعمدة): كود المشروع/اسم المشروع/العميل/مدير المشروع/الميزانية/الحالة.

**PRJ-02 — Manager name resolves against login users, not HR employees** `[gap]`
- Pre: PRJ-DEMO-1 "برج الأمل السكني" — `managerId` مزروع كمعرّف موظف موارد بشرية `EMP-DEMO-1` (كريم عادل).
- Steps: انظر عمود "مدير المشروع" لهذا الصف.
- Assert: يعرض على الأرجح **المعرّف الخام "EMP-DEMO-1"** بدل اسم "كريم عادل" — لأن `managerName()` يبحث داخل قائمة `/users` (حسابات الدخول)، بينما القيمة المزروعة هي معرّف موظف من `/hr/employees` — نوعان مختلفان من الكيانات لا يتطابقان. تحقق أيضاً في اللوحة الجانبية (PRJ-06) لنفس الصف.
- Steps: افتح نموذج "مشروع جديد" وانظر خيارات منتقي "مدير المشروع".
- Assert: القائمة مبنية من `/users` فقط — **لا يمكن اختيار موظف موارد بشرية كمدير مشروع من الواجهة إطلاقاً**، فقط حسابات دخول للنظام.

**PRJ-03 — Search by code or name**
- Steps: اكتب "TOWER" في "ابحث بالكود أو الاسم...".
- Assert: يظهر صف "برج الأمل السكني" (الكود TOWER-A) فقط.
- Steps: امسح، واكتب "توسعة".
- Assert: يظهر صف "توسعة مستودع الوادي الأخضر" فقط.

**PRJ-04 — Create project: code uniqueness validation**
- Steps: اضغط "مشروع جديد"، اكتب الكود "TOWER-A" (مستخدم بالفعل من PRJ-DEMO-1)، عبّئ الاسم، اضغط "حفظ".
- Assert: رسالة `الكود "TOWER-A" مستخدم بالفعل — اختر كوداً آخر.` والنموذج لا يُغلق.

**PRJ-05 — Create project: required fields and full form**
- Steps: اضغط "مشروع جديد"، اضغط "حفظ" فوراً بدون شيء.
- Assert: "كود المشروع مطلوب."
- Steps: عبّئ الكود "PRJ-TEST"، اضغط "حفظ".
- Assert: "اسم المشروع مطلوب."
- Steps: عبّئ الاسم "مشروع اختبار"، اترك العميل ومدير المشروع على "بدون عميل"/"بدون مدير"، اترك الميزانية 0، اضغط "حفظ".
- Assert: يُنشأ مشروع جديد بحالة **"مخطط"** (الحالة الافتراضية دائماً عند الإنشاء، بغض النظر عن أي حقل حالة في النموذج — النموذج لا يحتوي أصلاً على منتقي حالة عند الإنشاء).
- Assert (تلميح الحقل): حقل "كود المشروع" يعرض نص توضيحي "يستخدم لإنشاء مركز تكلفة المشروع (PRJ-الكود)".

**PRJ-06 — Detail panel shows the linked cost center id, which does NOT match the field's own hint text** `[gap]`
- Pre: PRJ-DEMO-1 (الكود TOWER-A).
- Steps: افتح صف "برج الأمل السكني".
- Assert: اللوحة تعرض "مركز التكلفة" = `cc-prj-PRJ-DEMO-1` (معرّف المشروع الداخلي) — **وليس** `PRJ-TOWER-A` كما يوحي نص المساعدة في نموذج الإنشاء ("PRJ-الكود"). النمط الفعلي في الكود هو `cc-prj-{id}` دوماً، لا علاقة له بالكود المُدخل من المستخدم.

**PRJ-07 — Detail panel: full field set**
- Steps: افتح صف "تجهيز فرع جديد" (PRJ-DEMO-3، عميل CUST-DEMO-3).
- Assert: تُعرض شارة الحالة "مكتمل"، وبطاقة معلومات: كود المشروع FITOUT-BR2، الاسم بالإنجليزية "New Branch Fit-Out"، العميل "مجموعة الفجر التجارية"، مدير المشروع (نفس فجوة PRJ-02)، تاريخ البدء 2026-04-01، تاريخ الانتهاء 2026-07-15، عنوان الموقع "الإسكندرية، سموحة"، مركز التكلفة؛ بطاقة الميزانية 180,000.00 ج.م؛ بطاقة الملاحظات "تم تسليم الفرع وتشغيله بالكامل."

**PRJ-08 — Status change control offers ALL five statuses regardless of current status — no state-machine guard** (Behaviour hint, contradicts assumed transition rules)
- Pre: PRJ-DEMO-3 "تجهيز فرع جديد" بحالة **"مكتمل"**.
- Steps: افتح لوحته، انظر قسم "تغيير الحالة".
- Assert: القائمة المنسدلة "الحالة" تعرض **كل الحالات الخمس** (مخطط/نشط/متوقف مؤقتاً/مكتمل/ملغي) كخيارات متاحة دوماً — لا تعتمد على الحالة الحالية إطلاقاً.
- Steps: اختر "مخطط" (رجوع من "مكتمل" لحالة سابقة منطقياً) واضغط "حفظ".
- Assert: **العملية تنجح بدون أي رفض أو رسالة خطأ** — الحالة تتحول فعلياً من "مكتمل" إلى "مخطط". لا يوجد حارس (guard) لا في الواجهة ولا في الخادم (`updateProject`/`PATCH /projects/:id` يقبلان أي قيمة حالة صالحة من التعداد بلا قيد على التسلسل) — على عكس ما يوحي به وصف "دورة حياة المشروع" في الكتالوج، **لا يوجد رفض من الحالة الخاطئة في هذا البناء**؛ أي انتقال (بما فيه الرجوع للخلف أو القفز، مثل "ملغي" مباشرة إلى "نشط") ينجح دائماً.
- Steps (تكرار إثبات): من مشروع "ملغي" (PRJ-DEMO-5 OLD-SITE)، غيّر الحالة إلى "نشط" مباشرة واحفظ.
- Assert: ينجح كذلك بلا رفض.

**PRJ-09 — Status pill tone per status**
- Assert: مخطط=info (أزرق)، نشط=success (أخضر)، متوقف مؤقتاً=warning (أصفر)، مكتمل=success (أخضر أيضاً — نفس لون "نشط")، ملغي=danger (أحمر).

**PRJ-10 — Pagination summary**
- Assert: "عرض 5 من 5 مشروع" أسفل الجدول.

**PRJ-11 — No tasks/costing/billing tabs exist on the project detail** `[gap]`
- Steps: افتح أي مشروع.
- Assert: اللوحة الجانبية بطاقات معلومات ثابتة + قسم تغيير الحالة فقط — **لا توجد ألسنة (tabs) لتكاليف المشروع، فوترته، أو مهامه** كما أوحى الكتالوج ("no tasks list, no project detail/costing/billing tabs" — هذا صحيح ولا يزال كذلك في هذا البناء). `[NOT IMPLEMENTED]`

---

### 3. الأصول الثابتة — Fixed Assets

#### 3.1 نظرة عامة — Assets Hub (`assets-hub`)

**AST-01 — Hub KPIs**
- Steps: افتح مجموعة "الأصول الثابتة" (تفتح على "نظرة عامة").
- Assert: "عدد الأصول"=6، "أصول نشطة"=6، "إجمالي تكلفة الاقتناء"=1,631,000.00 ج.م، "إجمالي الإهلاك المتراكم"=0.00 ج.م (لم يُرحَّل أي إهلاك بعد).
- Assert: بطاقة "أحدث عمليات الإهلاك" تعرض "لا توجد عمليات إهلاك بعد — ستظهر هنا فور تشغيل أول عملية." (0 عمليات مزروعة).

**AST-02 — Quick actions navigate correctly**
- Steps: اضغط "أصل جديد"، ثم ارجع واضغط "تشغيل إهلاك جديد"، ثم "تصنيفات الأصول".
- Assert: كل زر ينقل للشاشة المطابقة تماماً.

---

#### 3.2 سجل الأصول — Asset Register (`asset-register`)

**AST-03 — List columns, KPIs, seeded rows**
- Steps: افتح "سجل الأصول".
- Assert: بطاقات إجمالي الأصول=6، نشط=6، مهلك بالكامل=0. الأعمدة: الأصل/التصنيف/تاريخ الاقتناء/تكلفة الاقتناء/القيمة الدفترية/الحالة.
- Assert: صف "رافعة شوكية كهربائية" (AST-0001) — تكلفة 180,000.00 ج.م، قيمة دفترية **180,000.00 ج.م** (تساوي التكلفة تماماً لأن الإهلاك المتراكم = 0 حالياً)، تصنيف "FA-01 — معدات وآلات"، تاريخ اقتناء 2024-03-15، الحالة "نشط".

**AST-04 — No status filter chips; filters are search + category + branch only** `[gap]`
- Steps: افحص شريط الفلاتر أعلى الجدول.
- Assert: **لا توجد رقاقات حالة** (الكل/نشط/تحت الصيانة/إلخ) رغم وصف الكتالوج لها — فقط مربع بحث "بحث في الأصول..." بالإضافة لمنتقيَي "التصنيف" و"الفرع". `[NOT IMPLEMENTED]`: رقاقات حالة، ونطاق تاريخ اقتناء (من/إلى) — كلاهما غير موجودين فعلياً.

**AST-05 — Filter by category**
- Steps: اختر "FA-02 — مركبات" من منتقي "التصنيف".
- Assert: يظهر صفان فقط: AST-0002 (سيارة نقل بضائع) وAST-0003 (سيارة توزيع صغيرة).

**AST-06 — Filter by branch**
- Steps: اختر الفرع الرئيسي من منتقي "الفرع".
- Assert: يظهر فقط الأصول ذات `branchId` مطابق (AST-0002 وAST-0004، نطاقهما "فرع") — الأصول ذات النطاق "عام"/"مستودع" لا تُطابَق حتى لو كانت منطقياً متاحة لكل الفروع (الفلتر يقارن `branchId` حرفياً).

**AST-07 — Search by name or code**
- Steps: اكتب "AST-0005" في "بحث في الأصول...".
- Assert: يظهر صف "طابعات ومعدات مكتبية" فقط.

**AST-08 — Register asset: required fields**
- Steps: اضغط "تسجيل أصل"، اضغط "حفظ" فوراً.
- Assert: "كود الأصل مطلوب."
- Steps: عبّئ الكود "AST-TEST"، اضغط "حفظ".
- Assert: "الاسم بالعربية مطلوب."

**AST-09 — Register asset: code uniqueness**
- Steps: اكتب الكود "AST-0001" (مستخدم)، عبّئ باقي الحقول المطلوبة، اضغط "حفظ".
- Assert: `الكود "AST-0001" مستخدم بالفعل — اختر كوداً آخر.`

**AST-10 — Depreciation method is a fixed read-only label, not a dropdown** (matches the domain: only "straight_line" exists)
- Steps: افتح "تسجيل أصل"، انظر حقل "طريقة الإهلاك" في قسم "الإهلاك والقيمة".
- Assert: يُعرض كصندوق نص ثابت غير قابل للتعديل بقيمة "القسط الثابت" — **ليس قائمة منسدلة** رغم أن الكتالوج القديم وصفها كذلك؛ لا توجد أي طريقة إهلاك أخرى معرَّفة في النظام حالياً.

**AST-11 — Scope = "فرع" requires a branch**
- Steps: في نموذج التسجيل، اختر نطاق الأصل "فرع"، اترك حقل "الفرع *" فارغاً، اضغط "حفظ".
- Assert: "الفرع مطلوب عند اختيار نطاق «فرع»."

**AST-12 — Salvage value defaults from the category's percentage when left blank** (Behaviour hint)
- Steps: أنشئ أصلاً جديداً بالتصنيف "FA-03 — أجهزة حاسب ومعدات مكتبية" (عمر إنتاجي افتراضي 36 شهراً، نسبة قيمة متبقية افتراضية 5%)، تكلفة اقتناء 20,000، اترك حقل "القيمة المتبقية" فارغاً، اضغط "حفظ".
- Assert: القيمة المتبقية المحسوبة تلقائياً = **1,000.00 ج.م بالضبط** (5% من 20,000)، والقيمة الدفترية للأصل الجديد = 20,000.00 ج.م (بلا إهلاك بعد).

**AST-13 — No photo upload, no GL-account override section, no "بيانات إضافية" section on the create form** `[gap]`
- Steps: افحص نموذج "تسجيل أصل" بالكامل.
- Assert: الأقسام الموجودة فعلياً فقط: "الهوية والتصنيف"، "الاقتناء"، "الإهلاك والقيمة". **لا يوجد** رفع صورة/شعار، ولا قسم قابل للطي "الحسابات" لتجاوز حسابات الأستاذ لكل أصل على حدة، ولا قسم "بيانات إضافية" — رغم وصفها في الكتالوج. `[NOT IMPLEMENTED]`

**AST-14 — Detail panel: full field set**
- Steps: افتح صف "سيارة نقل بضائع" (AST-0002).
- Assert: تُعرض بطاقتان — الأولى: كود الأصل AST-0002، اسم الأصل (الإنجليزي) "Delivery Truck"، التصنيف "FA-02 — مركبات"، نطاق الأصل "فرع"، تاريخ الاقتناء 2023-06-01، تاريخ بدء الإهلاك 2023-06-01 (يساوي تاريخ الاقتناء لأنه لم يُحدَّد صراحة)، العمر الإنتاجي 96 شهراً، طريقة الإهلاك "القسط الثابت". الثانية: تكلفة الاقتناء 650,000.00 ج.م، القيمة المتبقية 90,000.00 ج.م (قيمة صريحة من الزرع، لا محسوبة)، مجمع الإهلاك 0.00 ج.م، القيمة الدفترية 650,000.00 ج.م.

**AST-15 — No status-change or disposal action anywhere in the register** `[NOT IMPLEMENTED]` (matches the task's own instruction — no scenario invents a disposal click path)
- Steps: افتح أي أصل نشط، افحص كل الأزرار المتاحة على شاشة السجل وفي لوحته الجانبية.
- Assert: لا يوجد أي زر لتغيير حالة الأصل يدوياً (لا "وضعه تحت الصيانة"، ولا "استبعاده/التخلص منه"). الحالة الوحيدة التي تتغير تلقائياً هي الانتقال إلى "مهلك بالكامل" عند ترحيل عملية إهلاك تستنفد كامل القاعدة القابلة للإهلاك (انظر AST-24). صلاحية `assets.dispose` معرَّفة في كتالوج الصلاحيات ونص الحالة "تم التخلص" موجود في تعداد الواجهة، لكن **لا يوجد مسار (لا API ولا زر) لتنفيذها فعلياً** — لا يوجد `POST /assets/:id/dispose` ولا ما يعادله. لهذا لا يوجد سيناريو هنا يفترض إمكانية استبعاد أصل أو ترحيل ربح/خسارة بيعه — الحسابات `gainOnDisposalAccountId`/`lossOnDisposalAccountId` مُعرَّفة على مستوى التصنيف (AST-27) لكنها **لا تُستخدم أبداً** في أي منشور فعلي.

---

#### 3.3 الإهلاك — Depreciation Runs (`depreciation-runs`)

**AST-16 — Empty list at seed time**
- Steps: افتح "الإهلاك".
- Assert: بطاقات إجمالي العمليات=0، مسودة=0، مرحل=0؛ رسالة القائمة الفارغة "لا توجد عمليات إهلاك — لم يتم تشغيل أي إهلاك بعد."؛ عكس الكتالوج القديم — **الشاشة الفعلية تحتوي زر "تشغيل إهلاك جديد" ونموذجاً كاملاً منذ البداية**، وليست مقفلة بانتظار وجود أصل (الأصول موجودة بالفعل في هذا الزرع، لكن حتى لو لم تكن، النموذج نفسه يُفتح دوماً).

**AST-17 — Create a run: required fields and defaults**
- Steps: اضغط "تشغيل إهلاك جديد".
- Assert: الحقول: السنة* (رقم، افتراضي سنة اليوم)، الشهر* (رقم 1–12، افتراضي شهر اليوم)، الفرع (اختياري، افتراضي "كل الفروع").
- Steps: اضبط السنة 2026 والشهر 8، اترك الفرع "كل الفروع"، اضغط "تشغيل".

**AST-18 — Run creation eligibility and computed lines** (Behaviour hint — matches category's method/useful life)
- Pre: نفس دورة AST-17 (فترة 2026-08، كل الفروع).
- Assert: تُنشأ عملية مسودة بستة أسطر (سطر واحد لكل أصل من الأصول الستة النشطة، بما أن جميعها بدأت إهلاكها قبل شهر أغسطس 2026 وحالتها "نشط") بالمبالغ التالية بالضبط (قسط ثابت شهري = (تكلفة − قيمة متبقية) ÷ عمر إنتاجي بالشهور):
  - AST-0001: (180,000 − 18,000)/60 = **2,700.00 ج.م**
  - AST-0002: (650,000 − 90,000)/96 = **5,833.33 ج.م** (القيمة الدقيقة داخلياً 5,833.333333)
  - AST-0003: (420,000 − 63,000)/96 = **3,718.75 ج.م**
  - AST-0004: (95,000 − 4,750)/36 = **2,506.94 ج.م** (دقيقاً 2,506.944444)
  - AST-0005: (36,000 − 1,800)/36 = **950.00 ج.م**
  - AST-0006: (250,000 − 25,000)/60 = **3,750.00 ج.م**
- Assert: "المبلغ الإجمالي" للعملية = مجموع الستة = **19,459.03 ج.م** (دقيقاً 19,459.027777 — لا يظهر أي تجاوز/تسريب تقريب عند جمعها).
- Assert: الحالة "مسودة"، عدد الأصول = 6.

**AST-19 — Duplicate period is rejected**
- Pre: عملية إهلاك موجودة بالفعل لفترة 2026-08 (كل الفروع)، من AST-17/18.
- Steps: أنشئ عملية أخرى بنفس السنة/الشهر ونفس نطاق الفرع ("كل الفروع").
- Assert: رسالة خطأ ترفض الإنشاء (فترة+فرع مكررة لعملية غير ملغاة).

**AST-20 — Detail panel: line table shows raw asset IDs, not names** `[gap]`
- Pre: عملية الإهلاك من AST-18.
- Steps: افتح صفها.
- Assert: جدول "تفاصيل الإهلاك" يعرض عمود "الأصل" بمعرّف الأصل الخام (مثل `ASSET-DEMO-1`) **وليس اسمه العربي** ("رافعة شوكية كهربائية") — فجوة عرض حقيقية، لا اسم الأصل ولا كوده الودي يظهر هنا.

**AST-21 — Post a draft run posts ONE journal entry across the shared GL account pair** (Behaviour hint)
- Pre: عملية الإهلاك المسودة من AST-18 (6 أسطر، 3 تصنيفات مختلفة).
- Steps: من صف العملية في القائمة، اضغط "ترحيل".
- Assert: الزر يتحول لنص "جارٍ الترحيل..." أثناء التنفيذ ثم الحالة تصبح "مرحل"؛ يظهر معرّف قيد يومية بصيغة `DEP-JE:<معرف العملية>` بدل زر الترحيل.
- Assert: **يُرحَّل قيد يومية واحد فقط** (وليس ستة قيود منفصلة) لأن كل التصنيفات الثلاثة (FA-01/02/03) تشترك في نفس حسابي "مصروف الإهلاك" (5400) و"مجمع الإهلاك" (1590) — الترحيل يجمع الأسطر حسب زوج الحسابات. القيد متوازن: مدين 5400 = 19,459.03 ج.م، دائن 1590 = 19,459.03 ج.م بالضبط.

**AST-22 — Posting updates each asset's accumulated depreciation and book value**
- Pre: بعد ترحيل AST-21.
- Steps: افتح "سجل الأصول" وانظر صف AST-0001 (رافعة شوكية كهربائية).
- Assert: مجمع الإهلاك أصبح 2,700.00 ج.م، القيمة الدفترية أصبحت **177,300.00 ج.م** (180,000 − 2,700).

**AST-23 — Accumulated depreciation never exceeds cost minus salvage** (Behaviour hint)
- Pre: أصل بقاعدة إهلاك صغيرة نسبياً قريبة من الاستنفاد (مثال بنائي: أصل بتكلفة 1,000، قيمة متبقية 0، عمر إنتاجي شهر واحد — سجّله عبر AST-08، ثم رحّل عملية إهلاك لفترته).
- Steps: رحّل عملية إهلاك تغطي هذا الأصل، ثم افتح تفاصيله.
- Assert: مجمع الإهلاك = 1,000.00 ج.م بالضبط (لا يتجاوز القاعدة القابلة للإهلاك 1,000 حتى لو حُسب القسط الشهري بأكثر من ذلك رياضياً)، القيمة الدفترية = 0.00 ج.م.

**AST-24 — Fully-depreciated assets flip status automatically on posting**
- Pre: نفس أصل AST-23 بعد ترحيل عملية استنفدت كامل قاعدته.
- Steps: افتح "سجل الأصول".
- Assert: حالة الأصل أصبحت **"مهلك بالكامل"** تلقائياً (بدون أي إجراء يدوي)؛ بطاقة "مهلك بالكامل" في شريط الملخص تزيد بمقدار 1.
- Assert: أصل مهلك بالكامل **لا يظهر بعد ذلك** كسطر مؤهل في أي عملية إهلاك لاحقة (المبلغ المحسوب له = 0 فيُستبعد من القائمة، حسب `computeMonthlyDepreciation`).

**AST-25 — Branch-scoped run only includes eligible assets**
- Steps: أنشئ عملية إهلاك جديدة لفترة مستقبلية (مثال 2026-09)، واختر فرعاً محدداً بدل "كل الفروع".
- Assert: الأصول ذات النطاق "عام" **تُدرج دوماً** بغض النظر عن الفرع المختار؛ الأصول ذات النطاق "فرع" تُدرج فقط إن كان `branchId` مطابقاً؛ الأصول ذات النطاق "مستودع" **تُستبعد دوماً** عند تحديد فرع (الشرط في الكود لا يغطي حالة `scope === "warehouse"` عند وجود فرع محدد).

**AST-26 — Status chips filter runs**
- Steps: بعد إنشاء عملية مسودة وأخرى مرحّلة، اضغط رقاقة "مرحل".
- Assert: يظهر العمليات المرحّلة فقط.

---

#### 3.4 تصنيفات الأصول — Asset Categories (`asset-categories`)

**AST-27 — List columns, seeded rows**
- Steps: افتح "تصنيفات الأصول".
- Assert: 3 صفوف: FA-01 (معدات وآلات، القسط الثابت، 60 شهراً، نشط)، FA-02 (مركبات، القسط الثابت، 96 شهراً، نشط)، FA-03 (أجهزة حاسب ومعدات مكتبية، القسط الثابت، 36 شهراً، نشط). عمود "طريقة الإهلاك الافتراضية" ثابت النص "القسط الثابت" لكل صف (لا توجد طريقة أخرى في النظام).

**AST-28 — Status chips**
- Assert: رقاقات الكل(3)/نشط(3)/غير نشط(0).

**AST-29 — Create category: required fields and validation**
- Steps: اضغط "إضافة تصنيف"، اضغط "حفظ" فوراً.
- Assert: "كود التصنيف مطلوب."
- Steps: اكتب الكود "FA-01" (مستخدم)، عبّئ الاسم، اضغط "حفظ".
- Assert: `الكود "FA-01" مستخدم بالفعل — اختر كوداً آخر.`
- Steps: غيّر الكود إلى "FA-04"، عبّئ العمر الإنتاجي 0، اضغط "حفظ".
- Assert: "العمر الإنتاجي الافتراضي يجب أن يكون رقماً أكبر من صفر."
- Steps: صحّح العمر لـ24، اضبط نسبة القيمة المتبقية 150، اضغط "حفظ".
- Assert: "نسبة القيمة المتبقية الافتراضية يجب أن تكون بين 0 و100."

**AST-30 — Create category: GL account fields are optional text with helper defaults**
- Steps: اضغط "إضافة تصنيف"، اترك جميع حقول "ربط الحسابات المحاسبية" فارغة (كود حساب الأصل/مصروف الإهلاك/مجمع الإهلاك/أرباح البيع/خسائر البيع)، عبّئ الحقول الإلزامية الأخرى، اضغط "حفظ".
- Assert: التصنيف يُنشأ بنجاح بكل حقول الحسابات `null` — النظام يعتمد لاحقاً على الحسابات الافتراضية عند الترحيل الفعلي (5400/1590 حسب ما رُصد في AST-21)، ونص المساعدة تحت كل حقل يذكر الحساب الافتراضي المقترح (1500/5400/1590/4500/5450 على التوالي).

**AST-31 — No edit action on categories** `[gap]`
- Steps: افحص كل صف في قائمة التصنيفات.
- Assert: **لا يوجد عمود إجراءات ولا أي زر تعديل/تعطيل** — تعليق الكود صريح: "API supports list+create only". `[NOT IMPLEMENTED]`

**AST-32 — Search by code or name**
- Steps: اكتب "مركبات" في "بحث بالتصنيف...".
- Assert: يظهر صف FA-02 فقط.

---

### 4. المبيعات الميدانية — Field Sales

#### 4.1 رحلات المندوبين — Van/Rep Trips (`van-trips`)

**FLD-01 — List columns, KPIs, seeded rows**
- Steps: افتح مجموعة "المبيعات الميدانية" ← "رحلات المندوبين".
- Assert: بطاقات الإجمالي=2، جارية=1، مسواة=1. الأعمدة: رقم الرحلة (+التاريخ)/الڤان/الفرع/المبيعات/الحالة/النقدية المحصلة.
- Assert: صف TRIP-DEMO-1 — الحالة "مسواة"، المبيعات=1 (حركة نقدية واحدة نوعها "بيع")، النقدية المحصلة=200.00 ج.م (مجموع كل الحركات النقدية للرحلة، وليس فقط ما حُصِّل عند التسوية).
- Assert: صف TRIP-DEMO-2 — الحالة "جارية"، المبيعات=0، النقدية المحصلة=0.00 ج.م.

**FLD-02 — Status filter chips**
- Steps: اضغط رقاقة "مسواة".
- Assert: يظهر TRIP-DEMO-1 فقط.

**FLD-03 — Search by trip number**
- Steps: اكتب "TRIP-DEMO-2" في "ابحث برقم الرحلة...".
- Assert: يظهر صف TRIP-DEMO-2 فقط.

**FLD-04 — Open trip form: required fields**
- Steps: اضغط "فتح رحلة"، اضغط "فتح رحلة" (الزر السفلي) فوراً بدون تعبئة.
- Assert: "التاريخ مطلوب." — وحتى مع تعبئة التاريخ فقط، يستمر الفحص التسلسلي (الڤان مطلوب → مخزن التحميل مطلوب → ... → الطاقم مطلوب) حقلاً حقلاً.

**FLD-05 — Van and loading warehouse cannot be the same**
- Steps: عبّئ النموذج واختر نفس المستودع في حقلي "الڤان *" و"مخزن التحميل *".
- Assert: "لا يمكن أن يكون مخزن التحميل هو نفس الڤان."

**FLD-06 — Crew is required — at least one member**
- Steps: عبّئ كل الحقول الأخرى بشكل صحيح لكن اترك قسم "الطاقم *" فارغاً، اضغط "فتح رحلة".
- Assert: "لا بد من إضافة عضو واحد على الأقل للطاقم."

**FLD-07 — Crew picker is a raw employee-id text field, not a search/select** `[gap]`
- Steps: افحص قسم "الطاقم *" في نموذج فتح الرحلة.
- Assert: حقل "اختر موظفاً" هو **حقل نصي بسيط** (`placeholder="معرّف الموظف"`) — على المستخدم كتابة معرّف الموظف يدوياً، **وليس منتقياً بحثياً** يعرض أسماء الموظفين كما توحي تسميته. هذا يعني عملياً أن فتح رحلة عبر الواجهة يتطلب معرفة مسبقة بمعرّفات النظام الداخلية للموظفين.
- Steps: اكتب أي نص عشوائي في الحقل، اختر دوراً، اضغط "إضافة".
- Assert: يُضاف كسطر طاقم بغض النظر عن صحة المعرّف — لا يوجد تحقق فوري من وجود الموظف على مستوى الواجهة.

**FLD-08 — Add/remove crew rows**
- Steps: اكتب معرّف موظف، اختر الدور "مندوب"، اضغط "إضافة" — كرر لعضو ثانٍ بدور "سائق".
- Assert: يظهر سطرا الطاقم في القائمة، كل سطر بزر "×" لإزالته.
- Steps: اضغط "×" على أحدهما.
- Assert: يُحذف من القائمة فوراً.

**FLD-09 — Load stock is optional; add/remove rows**
- Steps: أكمل نموذج فتح رحلة كامل الحقول الإلزامية والطاقم، لا تضف أي صنف في "تحميل مخزون (اختياري)"، اضغط "فتح رحلة".
- Assert: تُفتح الرحلة بنجاح بدون أي مخزون محمَّل — القسم اختياري فعلاً.
- Steps (رحلة أخرى): أضف صنفاً بكمية 5 عبر منتقي الصنف + "إضافة"، ثم اضغط "×" لإزالته قبل الحفظ.
- Assert: يُزال السطر من قائمة المسودة فوراً قبل الإرسال.

**FLD-10 — Opening cash float helper text**
- Assert: تحت حقل "النقدية الافتتاحية" نص: "العهدة النقدية التي يأخذها المندوب — تُحوَّل فعلياً من الخزينة المصدر لخزينة الڤان."

**FLD-11 — Newly-opened trips via the UI never get a trip number — they display a raw UUID** `[gap]`
- Steps: افتح رحلة جديدة كاملة الحقول عبر النموذج (لا حقل لرقم الرحلة يدوياً في هذا النموذج أصلاً)، اضغط "فتح رحلة".
- Assert: الرحلة الجديدة تظهر في القائمة بعمود "رقم الرحلة" يعرض **معرّفاً عشوائياً (UUID)** بدل رقم رحلة مقروء مثل "TRIP-000003" — النموذج لا يرسل `tripNo` إطلاقاً، والخادم لا يولّد رقماً بديلاً؛ الرحلتان المزروعتان (TRIP-DEMO-1/2) تحملان أرقاماً ودّية فقط لأن سكربت الزرع أرسلها مباشرة عبر الـAPI، متجاوزاً الواجهة.

**FLD-12 — Ongoing trip detail: no tabs — everything is stacked cards** `[gap]`
- Pre: TRIP-DEMO-2 (جارية).
- Steps: افتح صفها.
- Assert: التفاصيل تُعرض كبطاقات متتالية (الڤان/الفرع/التواريخ/النقدية الافتتاحية/خزينة الڤان، الطاقم، مخزون الڤان، الحركات النقدية) — **لا توجد ألسنة (tabs)** كما وصف الكتالوج ("مخزون الڤان / المستندات / المسار / التسوية")؛ تحديداً **لا يوجد قسم "المستندات" ولا "المسار" ولا "سجل المراجعة"** في هذا البناء. `[NOT IMPLEMENTED]`
- Assert: قسم "الطاقم" يعرض معرّفات الموظفين الخام (`EMP-DEMO-2`) وليس أسماءهم — نفس فجوة العرض المرصودة في AST-20/PRJ-02.

**FLD-13 — Record a cash movement on an ongoing trip**
- Pre: TRIP-DEMO-2 (جارية، بلا حركات نقدية بعد).
- Steps: افتح صفها، في بطاقة "تسجيل حركة نقدية"، اختر النوع "بيع"، اترك المبلغ فارغاً، اضغط "تسجيل الحركة".
- Assert: "المبلغ يجب أن يكون أكبر من صفر."
- Steps: أدخل المبلغ 150، اضغط "تسجيل الحركة".
- Assert: يُضاف سطر جديد في جدول "الحركات النقدية" بالنوع "بيع" والمبلغ 150.00 ج.م وتاريخ اليوم؛ الحقل يُفرَّغ تلقائياً بعد النجاح.

**FLD-14 — Cash movement kind options are limited to "بيع"/"تحصيل"**
- Steps: افتح القائمة المنسدلة "النوع" في نموذج تسجيل الحركة.
- Assert: خياران فقط: "بيع" و"تحصيل" — لا خيارات أخرى (مثل سحب/إيداع يدوي) رغم ما قد يوحي به وصف عام للتسويات المالية.

**FLD-15 — The settlement form only appears while the trip is ongoing**
- Pre: TRIP-DEMO-2 (جارية).
- Steps: افتح صفها، اضغط "تسوية الرحلة".
- Assert: يظهر نموذج "تسوية الرحلة" ببطاقة منفصلة، حقل "النقدية المعدودة *"، وقسم "جرد المخزون" بسطر لكل صنف محمَّل (ITEM-DEMO-4، الكمية الأصلية محسوبة تلقائياً كقيمة ابتدائية في الحقل).

**FLD-16 — Settle a trip: cash variance equals counted minus expected — the seeded settled trip has a real shortage** (Behaviour hint, must assert the number)
- Pre: TRIP-DEMO-1 — بالفعل مُسوّاة عند الزرع. تحقق من قيمها المعروضة بدل تنفيذ التسوية من جديد.
- Steps: افتح صف TRIP-DEMO-1، انظر بطاقة "التسوية".
- Assert: "المتوقع" = **1,200.00 ج.م بالضبط** (عهدة افتتاحية 1,000.00 + حركة "بيع" نقدية واحدة 200.00 — التسوية لا تُحسب المتوقع من أي شيء آخر غير مجموع الحركات + العهدة الافتتاحية).
- Assert: "المعدود" = **950.00 ج.م** (القيمة المُدخلة فعلياً عند الزرع).
- Assert: "الفرق" = **-250.00 بالضبط** (950 − 1200)، معروضاً كشارة حمراء (نقص/عجز حقيقي، وليس مجرد ظهور رقم).

**FLD-17 — Stock variance equals counted minus loaded (this build's "expected" does not net out implicit sales)** (Behaviour hint, must assert the numbers)
- Pre: TRIP-DEMO-1 المُسوّاة (تحميل: 20×أرز أبيض ٥ كجم، 30×سكر أبيض ١ كجم؛ معدود: 18/30 على التوالي).
- Steps: انظر جدول "تسوية المخزون" داخل بطاقة "التسوية".
- Assert: صف "أرز أبيض ٥ كجم" — المتوقع=20، المعدود=18، الفرق=**-2 بالضبط** (شارة تباين حمراء/سالبة).
- Assert: صف "سكر أبيض ١ كجم" — المتوقع=30، المعدود=30، الفرق=**0** (لا تباين).
- Assert (ملاحظة سلوك حقيقي وليس خللاً في العرض): عمود "المتوقع" هنا هو ببساطة الكمية **المحمَّلة أصلاً** على الرحلة، دون خصم أي مبيعات ميدانية فعلية سُجِّلت أثناء الرحلة — أي نقص محسوب هنا يشمل ضمنياً كل ما بيع فعلياً في الميدان، لا فقط الفاقد الحقيقي. هذا يطابق تعليق الكود الصريح ("MVP simplification... expected does not net out implicit sales").

**FLD-18 — Settling an ongoing trip live (execute the flow, not just read the seeded result)**
- Pre: TRIP-DEMO-2 (جارية، عهدة افتتاحية 1,500.00، صنف واحد محمَّل ITEM-DEMO-4 كمية 10، بلا حركات نقدية).
- Steps: سجّل حركة "بيع" بمبلغ 300 (كما في FLD-13)، ثم اضغط "تسوية الرحلة"، أدخل "النقدية المعدودة" = 1,750، اضبط الكمية المعدودة لصنف الشاي إلى 9، اضغط "تأكيد التسوية".
- Assert: الحالة تتحول فوراً إلى "مسواة"؛ بطاقة "التسوية" الجديدة تعرض المتوقع=1,800.00 ج.م (1,500+300)، المعدود=1,750.00 ج.م، الفرق=**-50.00 ج.م بالضبط**؛ فرق المخزون لصنف الشاي = **-1 بالضبط** (9−10).
- Assert: زر "تسجيل حركة نقدية" وزر "تسوية الرحلة" يختفيان بعد التسوية (لا إجراءات متاحة على رحلة مسواة).

**FLD-19 — No cancel action for a van trip anywhere in the UI** `[gap]`
- Steps: افحص كل الأزرار على القائمة وعلى لوحة تفاصيل رحلة جارية.
- Assert: **لا يوجد أي زر "إلغاء الرحلة"** رغم أن الحالة "ملغاة" معرَّفة في تعداد الحالات ورقاقة الفلتر — لا مسار نقر لإنهاء رحلة بإلغائها بدل تسويتها. `[NOT IMPLEMENTED]`

**FLD-20 — Empty search result copy**
- Steps: ابحث عن رقم رحلة غير موجود.
- Assert: "لا توجد رحلات مطابقة."

---

### 5. الأقساط — Installments

#### 5.1 خطط الأقساط — Installment Plans (`installment-plans`)

**INST-01 — List columns, stats, seeded row**
- Steps: افتح مجموعة "الأقساط" ← "خطط الأقساط".
- Assert: بطاقات إجمالي الخطط=1، خطط نشطة=1، متأخرة=1.
- Assert (الأعمدة): رقم الخطة/العميل/الفاتورة/التكرار/المتبقي/الحالة.
- Assert: عمود "العميل" يعرض المعرّف الخام **`CUST-DEMO-3`**، وليس "مجموعة الفجر التجارية" — فجوة عرض (نفس نمط PRJ-02/FLD-12).
- Assert: عمود "الفاتورة" يعرض الرقم الودّي **`INV-000003`** (صحيح — لا فجوة هنا).
- Assert: عمود "رقم الخطة" = **`IP-000001`**؛ "التكرار" = "شهري"؛ "المتبقي" = مجموع كل الأقساط غير المدفوعة = **5,639.58 ج.م** (كل الأقساط الستة، بما أنه لا يوجد أي قسط "مدفوع" بعد)؛ الحالة "نشط" + شارة إضافية حمراء "متأخر" (لأن أحد الأقساط بحالة overdue).

**INST-02 — No status chips beyond "الكل"/"نشط", no search box, no customer/date filters** `[gap]`
- Steps: افحص شريط الفلاتر بالكامل.
- Assert: الرقاقات المتاحة فقط "الكل"(1) و"نشط"(1) — **لا توجد رقاقات "متأخر"/"مكتمل"/"ملغي"** رغم عرضها في الكتالوج ورغم أن هذه الحالات معرَّفة في تعداد النظام. **لا يوجد مربع بحث إطلاقاً** ("بحث برقم الخطة أو اسم العميل" غير موجود في هذا البناء)، **ولا فلتر عميل ولا نطاق تاريخ**. `[NOT IMPLEMENTED]`

**INST-03 — Create form: invoice picker only lists invoices with an outstanding balance — and STILL shows the full amount for an invoice that already had a real collection posted against it (D1)** (Behaviour hint, ties to `ROADMAP.md` §5 D1)
- Pre: INV-DEMO-1 (فاتورة مبيعات، رقمها `INV-000001`، إجماليها **13,953.60 ج.م**) لديها بالفعل سند قبض `VCH-DEMO-1` مؤكَّد ومخصَّص بمبلغ **6,279.12 ج.م** (45% من إجماليها وقتها).
- Steps: اضغط "خطة جديدة"، افتح منتقي "الفاتورة *".
- Assert: تظهر فاتورة `INV-000001 - ...` بمبلغ متبقٍ معروض **13,953.60 ج.م كاملاً** — وليس 7,674.48 ج.م (الباقي الحقيقي بعد التحصيل) — لأن `remainingBalance` تُحسب دائماً كـ`grandTotal − amountPaid`، و`amountPaid` **لا يتحرك أبداً** عند تأكيد سند قبض (هذا هو **D1**، منقول حرفياً هنا: لوحة إنشاء خطة أقساط تعرض فاتورة كأنها لم تُحصَّل منها قرش، رغم وجود سند قبض حقيقي ومخصَّص عليها). لا يوجد أي حارس يمنع إنشاء خطة تقسيط ثانية تغطي نفس المبلغ الكامل مرة أخرى على فاتورة سبق تحصيل جزء حقيقي منها.

**INST-04 — Create form: schedule preview updates live as fields change**
- Steps: اضغط "خطة جديدة"، اختر فاتورة INV-000003 (نفس فاتورة IPLAN-DEMO-1 — لا شيء يمنع اختيارها مجدداً، انظر INST-03)، اترك عدد الأقساط 6 والتكرار "شهري"، اضبط تاريخ البدء 2026-08-18 ودفعة مقدمة 0.
- Assert: قسم "معاينة الجدول" يعرض 6 أسطر: #1 → 2026-08-18، #2 → 2026-09-18، … #6 → 2027-01-18، كل سطر بمبلغ **939.93 ج.م بالضبط** (5,639.58 ÷ 6 يقسم بالتساوي بلا كسور متبقية).
- Steps: غيّر عدد الأقساط إلى 4.
- Assert: المعاينة تُعاد حسابها فوراً لأربعة أسطر بدل ستة، بمبالغ جديدة تجمع لنفس إجمالي المتبقي.

**INST-05 — Installments sum to exactly the plan total — no rounding leak on the final line** (Behaviour hint, must assert the number)
- Pre: نفس معاينة INST-04 (فاتورة إجماليها 6,634.80 ج.م، بدون دفعة مقدمة، 6 أقساط شهرية).
- Assert: 939.93 × 6 = **5,639.58 ج.م بالضبط** = إجمالي الفاتورة (6,634.80) − الدفعة المقدمة (0) — تطابق تام، لا تسريب تقريب على السطر الأخير. (الحالة الأصلية المزروعة، بدفعة مقدمة 995.22 [15%]، تعطي نفس التطابق: 995.22 + 5×939.93 + 939.93 = 6,634.80 ج.م بالضبط.)

**INST-06 — Create form: submit auto-confirms — there is no draft state visible in the UI**
- Steps: أكمل نموذج "خطة جديدة" بفاتورة صالحة واضغط "حفظ".
- Assert: الخطة تُنشأ **وتُؤكَّد فوراً بنفس العملية** (النموذج يستدعي الإنشاء ثم التأكيد تلقائياً) — تظهر في القائمة مباشرة بحالة "نشط"، لا "مسودة" أبداً من هذا المسار.

**INST-07 — Detail panel: line-by-line schedule with status pills**
- Steps: افتح صف IPLAN-DEMO-1.
- Assert: تُعرض شارة حالة الخطة "نشط" أعلى اللوحة؛ قائمة من 6 أسطر: السطر #1 (2026-08-18، 939.93 ج.م) بشارة **"متأخر"** حمراء؛ الأسطر #2–#6 (2026-09-18 حتى 2027-01-18) بشارة **"مستحق"** رمادية محايدة (حالة `pending`).
- Assert: يظهر زر "إلغاء الخطة" أسفل اللوحة (لأن الحالة "نشط"/confirmed).

**INST-08 — No route or UI action marks an instalment "paid"** `[NOT IMPLEMENTED]`
- Steps: افتح تفاصيل IPLAN-DEMO-1، افحص كل سطر وكل زر في اللوحة الجانبية.
- Assert: **لا يوجد أي زر أو نموذج "تسجيل دفعة" أو "دفع القسط" على أي سطر** — الأقساط تنتقل فقط بين `pending`/`overdue`/`cancelled`، ولا يوجد أي مسار نقر (ولا مسار API) يضع سطر قسط في حالة `paid`. التحصيل موثَّق كمفهوم منفصل تماماً يمر عبر سند قبض خزينة (Treasury voucher) لا يُربط أبداً بسطر خطة تقسيط محدد — لذا لا يوجد سيناريو هنا يفترض وجود هذا المسار.

**INST-09 — Cancel a confirmed plan**
- Pre: خطة تقسيط أخرى أُنشئت حديثاً (عبر INST-06 مثلاً)، بحالة "نشط".
- Steps: افتح تفاصيلها، اضغط "إلغاء الخطة".
- Assert: الحالة تتحول إلى "ملغي"؛ زر "إلغاء الخطة" يختفي (لم يعد `status === "confirmed"`)؛ بطاقة "خطط نشطة" في الملخص تنقص بمقدار 1.

**INST-10 — "معالجة المتأخرات" batch: dialog copy is honest about the late-fee stub** (Behaviour hint + explicit gap)
- Steps: من رأس شاشة "خطط الأقساط"، اضغط "معالجة المتأخرات".
- Assert: تُفتح لوحة جانبية بعنوان "معالجة المتأخرات" ووصف "سيتم تحديث حالة الأقساط المتأخرة وتطبيق غرامات التأخير حسب إعدادات المنشأة"، وداخلها نص صريح: "تحديث حالة الأقساط المستحقة إلى متأخر (تلقائي) — تطبيق غرامات التأخير (تلقائي؛ **لا توجد إعدادات غرامة معرّفة بعد، القيمة صفر حتى تُضاف**)." — الواجهة نفسها تفصح أن حساب الغرامة معطَّل حالياً.

**INST-11 — Running the batch again on already-processed data finds nothing new**
- Pre: الدفعة سبق تشغيلها مرة عند الزرع (asOfDate وقت الزرع)، وسطر #1 من IPLAN-DEMO-1 بالفعل "متأخر".
- Steps: اضغط "معالجة المتأخرات" ← "معالجة المتأخرات" (زر التنفيذ) مرة أخرى الآن.
- Assert: النتيجة تعرض "تم تحديث **0** قسط إلى متأخر — غرامات مطبّقة: 0.00 ج.م" (بافتراض عدم مرور تاريخ استحقاق قسط آخر منذ آخر تشغيل) — لأن `processOverdueInstallments` يتجاهل أي سطر ليس بحالة `pending` أو لم يتجاوز موعد استحقاقه بعد.
- Assert (تحقق رقمي إن كان قد مضى وقت كافٍ ليتجاوز موعد القسط #2 [2026-09-18]): إذا كان تاريخ اليوم الفعلي قد تجاوز 2026-09-18، فسيُبلَّغ عن تحديث قسط إضافي واحد بالضبط، والغرامة المطبَّقة تبقى **0.00 ج.م دائماً** (الدالة `computeLateFee` ثابتة الإرجاع صفر بصرف النظر عن أي شيء).

**INST-12 — Overdue instalment counts toward the plan's "متأخرة" stat but the plan itself stays "نشط"**
- Assert (إعادة تأكيد من INST-01): رغم وجود قسط متأخر واحد، حالة **الخطة** نفسها تبقى "نشط" (وليست "متأخر") — "متأخر" شارة إضافية تظهر بجانب شارة الحالة الأساسية على مستوى الوثيقة كلها، وليست حالة مستقلة بديلة.

---

#### 5.2 متابعة التحصيل — Collection Follow-ups (`installment-follow-ups`)

**INST-13 — Empty state at seed time**
- Steps: افتح "متابعة التحصيل".
- Assert: بطاقات إجمالي المتابعات=0، المعلقة=0، المكتملة=0؛ رسالة القائمة الفارغة "لم يتم إنشاء أي متابعات بعد."؛ رقاقات الكل(0)/معلق(0)/مكتمل(0)/ملغي(0).

**INST-14 — Create follow-up: no "القسط" column exists — the list only ever shows customer, not a linked instalment** `[gap]`
- Steps: افحص أعمدة الجدول (حتى بعد إنشاء سجل، انظر INST-15).
- Assert: الأعمدة الفعلية: العميل/نوع المتابعة/تاريخ المتابعة/مسؤول المتابعة/النتيجة/الحالة — **لا يوجد عمود "القسط"** رغم وصف الكتالوج له؛ ولا حقل `installmentPlanId` في نموذج الإنشاء أصلاً — كل متابعة مرتبطة بعميل فقط، أبداً بخطة تقسيط أو قسط محدد. `[NOT IMPLEMENTED]`

**INST-15 — Create follow-up: required fields and defaults**
- Steps: اضغط "متابعة جديدة"، امسح حقل العميل (إن أمكن) واضغط "إضافة".
- Assert: "اختر عميلاً."
- Steps: أعد اختيار عميل (افتراضياً أول عميل في القائمة، مثلاً "شركة الأمل للتجارة")، لاحظ نوع المتابعة الافتراضي "اتصال" وتاريخ اليوم.
- Assert (خيارات النوع): اتصال/زيارة/رسالة نصية/بريد إلكتروني/ملاحظة — 5 خيارات مطابقة تماماً لتعداد النظام.
- Steps: اضغط "إضافة".
- Assert: سجل جديد بحالة "معلق"، عمود "مسؤول المتابعة" يعرض "أنا" (لأن `assignedTo` لا يوجد له حقل إدخال إطلاقاً — دائماً فارغ من هذا المسار، انظر INST-16).

**INST-16 — No "مسؤول المتابعة" input field exists on the create form despite the column existing** `[gap]`
- Steps: افحص نموذج "متابعة جديدة" بالكامل.
- Assert: الحقول فقط: العميل*، نوع المتابعة*، تاريخ المتابعة*، ملاحظات — **لا يوجد حقل لتعيين "مسؤول المتابعة" لشخص آخر** رغم أن الكتالوج القديم وصف حقلاً بنص مساعد "اتركه فارغاً لتعيين المتابعة لنفسك" (يوحي بوجود خيار تعيين). في هذا البناء التعيين **دائماً للنفس** ("أنا") بلا استثناء ممكن من الواجهة. `[NOT IMPLEMENTED]`

**INST-17 — Complete a pending follow-up with a custom outcome**
- Pre: متابعة أُنشئت في INST-15 (معلقة).
- Steps: افتح صفها، اكتب في حقل "النتيجة" النص "وعد بالدفع الأسبوع القادم"، اضغط "إكمال المتابعة".
- Assert: الحالة تتحول إلى "مكتمل"؛ عمود "النتيجة" في القائمة يعرض النص المُدخل بالضبط.

**INST-18 — Complete without typing an outcome falls back to a default string**
- Pre: متابعة معلقة أخرى.
- Steps: افتح صفها، اترك حقل "النتيجة" فارغاً، اضغط "إكمال المتابعة" مباشرة.
- Assert: تكتمل بنجاح، والنتيجة المسجَّلة تكون النص الافتراضي **"تمت المتابعة"** (وليس فارغة أو خطأ تحقق).

**INST-19 — Cancel a pending follow-up**
- Pre: متابعة معلقة.
- Steps: افتح صفها، اضغط "إلغاء".
- Assert: الحالة تتحول إلى "ملغي"؛ لا يظهر بعدها حقل "النتيجة" ولا أي زر إجراء (فقط الحالات `pending` تعرض أزرار الإكمال/الإلغاء).

**INST-20 — Status chips filter**
- Pre: بعد INST-17/19، توجد متابعة واحدة مكتملة وأخرى ملغاة على الأقل.
- Steps: اضغط رقاقة "مكتمل".
- Assert: يظهر فقط السجل المكتمل من INST-17.

---

#### 5.3 تقرير الأقساط المتأخرة (خارج شاشات هذا الملف، لكن السلوك مطلوب تحديداً)

**INST-21 — Overdue report lists exactly the late instalment and no other** (Behaviour hint, must assert the number — route lives under مجموعة "التقارير" ← "الأقساط المتأخرة", not this file's own nav groups)
- Pre: نفس IPLAN-DEMO-1 (سطر واحد متأخر، تاريخ استحقاقه 2026-08-18). التقرير يستخدم تاريخاً افتراضياً **ثابتاً في الكود = 2026-08-22** (وليس تاريخ اليوم الفعلي) عند فتحه لأول مرة بلا تعديل.
- Steps: افتح تقرير "الأقساط المتأخرة" (`report-installments-overdue`) بإعداداته الافتراضية دون تغيير حقل "حتى تاريخ".
- Assert: يظهر **صف واحد فقط**: اسم العميل "مجموعة الفجر التجارية"، رقم خطة التقسيط "IP-000001"، المبلغ 939.93 ج.م، المبلغ المتبقي 939.93 ج.م (لا شيء دُفع)، تاريخ الاستحقاق 2026-08-18، **أيام التأخير = 4 بالضبط** (الفرق بين 2026-08-22 و2026-08-18). **لا يظهر أي سطر آخر** — الأقساط #2–#6 تواريخ استحقاقها (18/09 وما بعده) كلها بعد تاريخ "حتى" الافتراضي فتُستبعد بالكامل.
- Steps: غيّر فلتر "التأخر" إلى "1-30 يوم".
- Assert: نفس الصف الوحيد يبقى ظاهراً (4 أيام تقع ضمن هذا النطاق)؛ التبديل لأي نطاق آخر (31-60/61-90/91+) يُفرغ التقرير بالكامل.
- Steps: عدّل حقل "حتى تاريخ" ليصبح 2026-08-17 (يوم واحد قبل استحقاق القسط #1).
- Assert: التقرير يصبح **فارغاً تماماً** — لا صفوف على الإطلاق، لأن التقرير يعيد حساب "المتأخر" ديناميكياً من تاريخ الاستحقاق مقابل "حتى تاريخ" في كل مرة، بدل الاعتماد على حالة `overdue` المخزَّنة من آخر تشغيل لدفعة "معالجة المتأخرات" — التقرير صحيح حتى بين تشغيلتي الدفعة.

---

### 6. ملخص الفجوات — `[NOT IMPLEMENTED]` register

كل بند هنا وُثِّق في مكانه أعلاه بسيناريو محدد يثبته؛ هذا مجرد تجميع سريع.

**CRM**
- CRM-09: لا منتقي كود دولة/قائمة دول كاملة لحقل هاتف العميل المحتمل.
- CRM-15: لا رابط/مسار من شاشة العملاء المحتملين لرؤية العميل أو الفرصة التي نتج عنها تحويل عميل محتمل (البيانات موجودة، العرض غائب).
- CRM-21: لا تفاصيل/تعديل لفرصة قائمة من شاشة "الفرص" نفسها (فقط عبر لوحة "خط المبيعات").
- CRM-27: لا فلاتر (عميل/نطاق قيمة/راكدة فقط)، لا مؤشر "فرص راكدة"، لا مبدّل عرض مراحل/كانبان في شاشة "خط المبيعات".
- CRM-37: لا تعديل ولا حذف/تعطيل لمرحلة خط مبيعات.
- CRM-41: لا حقل لربط نشاط جديد بعميل محتمل أو فرصة.

**Projects**
- PRJ-11: لا ألسنة تكاليف/فوترة/مهام على تفاصيل المشروع.
- (PRJ-02/PRJ-06/PRJ-08 موثقة كسلوك فعلي متناقض مع الافتراض، وليست غياباً كاملاً — لكنها فجوات جودة حقيقية تستحق نفس الانتباه: لا حارس تسلسل حالة، ومدير المشروع لا يمكن ربطه بموظف موارد بشرية).

**Fixed Assets**
- AST-04: لا رقاقات حالة ولا فلتر نطاق تاريخ اقتناء في سجل الأصول.
- AST-13: لا رفع صورة، لا قسم تجاوز حسابات لكل أصل، لا قسم "بيانات إضافية" في نموذج تسجيل أصل.
- AST-15: لا مسار (لا زر ولا API) لتغيير حالة أصل يدوياً — لا "تحت الصيانة" ولا **"التخلص/الاستبعاد"**؛ صلاحية `assets.dispose` وحساب الربح/الخسارة موجودان في التصنيف لكن غير مستخدَمين أبداً فعلياً.
- AST-31: لا تعديل لتصنيف أصول بعد إنشائه.

**Field Sales**
- FLD-07: منتقي طاقم الرحلة حقل نصي خام لمعرّف الموظف، وليس بحثاً بالاسم.
- FLD-12: لا ألسنة "مستندات"/"مسار"/"سجل مراجعة" على تفاصيل رحلة؛ لا ملخص مبيعات (فواتير/مرتجعات/صافي/آجل) في بطاقة التسوية.
- FLD-19: لا مسار لإلغاء رحلة.
- (FLD-11 فجوة سلوك حقيقية: رحلات تُفتح عبر الواجهة لا تحصل أبداً على رقم رحلة ودّي).

**Installments**
- INST-02: لا رقاقات حالة متأخر/مكتمل/ملغي، لا بحث، لا فلتر عميل/تاريخ في قائمة خطط الأقساط.
- INST-08: **لا مسار لتعليم قسط "مدفوع"** — مقصود عدم كتابته كسيناريو تنفيذي، موثَّق هنا فقط كتأكيد للفجوة المعروفة سلفاً.
- INST-14/INST-16: لا عمود/ربط بقسط محدد لمتابعة تحصيل؛ لا حقل لتعيين متابعة لشخص آخر غير النفس.
- (INST-03/INST-10 يعكسان فجوتين معروفتين مسبقاً في `ROADMAP.md` §5 — **D1** و"لا إعدادات غرامة تأخير معرَّفة" — وليستا اكتشافاً جديداً هنا، بل امتداد أثرهما إلى شاشات الأقساط تحديداً).

---

# 11. Platform and settings


Exhaustive UI test scenarios for every settings and platform-administration screen
in the built app: `apps/web/src/settings/*`, `apps/web/src/pages/{Users,Roles,RoleEditor}Page.tsx`,
`apps/web/src/screens/{ApprovalsInbox,AuditLog}Screen.tsx`, and the settings-adjacent
chrome in `packages/ui/src/shell/*` (language toggle, theme toggle, branch/warehouse
scope switchers). Cross-checked against `docs/archive/catalog/09-settings-dashboard-ux.md`
(the reference product capture) — every place this build differs from, exceeds, or
falls short of the reference is called out inline.

### How this build's navigation actually works — read this first

This SPA has **no URL routing**. `App.tsx` holds `activeScreen` in React state; every
nav click calls `navigate(key)`. There is no `/settings/...` path, no `?tab=` query
string, and a browser reload always lands back on the dashboard (`activeScreen`
resets to `"dashboard"`). Every "Pre" below that says "navigate to X" means clicking
through the sidebar from wherever the previous scenario left off — there is no
deep link to paste. The one exception: **language** and **theme** persist to
`localStorage` and restore across reload (`mezan:theme`, the i18n locale key) —
covered in their own section below.

All settings screens except **Profile** live inside the collapsed **الإعدادات**
sidebar group (`nav-config.ts`'s `settings` group, `defaultCollapsed: true`) — it
must be expanded once per session before any of its 14 items are clickable. Unlike
the reference product, **Profile, API Keys, Webhooks, Audit Log, Users, and Roles
are all present in this same sidebar group** — none of them require the command
palette or a hidden route to reach (a genuine improvement over the reference,
which found Profile/API Keys/Webhooks/Audit only by extracting route strings from
the JS bundle).

### Seed data this document assumes

Per the task brief: 3 API keys (1 revoked), 2 webhooks with real failed-delivery
records, 4 notification rules (1 deactivated), 3 workflow requests (1 pending, 1
approved, 1 rejected), 2 workflow configs, 7 profile activity entries, a populated
audit trail, one system role (`SYSTEM_ADMIN` / منصة كاملة) and exactly **one real
user account** (`USER-ADMIN` — the seed tenant admin, "مدير المنشأة"). Only the
tenant admin login exists in the seed; everything below that assumes a second,
non-admin actor first walks through **PLT-USR-CREATE** to create one — see the
callout in §Approvals Inbox for why this matters.

### Two traps this document exists to keep you from misdiagnosing

1. **The submit-side bypass.** `packages/domain/src/workflow/gate.ts`'s
   `hasAdminRole` special-cases any actor whose roles include `"*"`. The signed-in
   seed account, `USER-ADMIN`, has `isCompanyAdmin: true` → `permissions: ["*"]`.
   Confirming ANY gated action while signed in as this account auto-approves on
   submit — the Approvals Inbox will look permanently empty. This is not broken;
   it is the documented behaviour. A non-admin actor is required to see anything
   land in the inbox as *pending*.

2. **The decide-side bypass — sharper than it looks.** The SAME `hasAdminRole`
   check governs `decide()`. If an admin actor opens the inbox and clicks **رفض**
   (reject) or **طلب تعديل** (request modification) on a request sitting at some
   OTHER role's step, the code path taken is the `admin` branch, which **always**
   records a `"bypass"` decision and grants the request — `input.decision` is
   never even read. Clicking "reject" as an admin does not reject; it approves.
   Only a non-admin actor holding the exact step role can actually reject or
   request modification. See **PLT-APR-08**.

---

### 1 — Global chrome: language switcher

The switcher is `packages/ui/src/shell/Topbar.tsx`'s `LanguageToggle` — a single
globe-style icon button in the topbar that flips between exactly **two** locales
(`ar` ⇄ `en`), not the reference product's three-locale dropdown (Arabic/English/
Deutsch never existed in this build; German is not offered anywhere).

- **PLT-01** — Toggle switches interface language and direction live.
  **Pre**: Signed in, language is Arabic (default), `<html dir="rtl" lang="ar">`.
  **Steps**: Click the language toggle button in the topbar (shows "ع" while
  Arabic is active).
  **Assert**: The button's visible label flips to the English short-code; every
  label on screen (sidebar group names, page titles, button text) re-renders in
  English within the same paint — no page reload; `<html>` now carries
  `dir="ltr" lang="en"`; the whole shell (sidebar rail, cards, tables) mirrors
  left-to-right.

- **PLT-02** — Toggling back restores Arabic/RTL.
  **Pre**: Language is English (from PLT-01).
  **Steps**: Click the language toggle again.
  **Assert**: `<html dir="rtl" lang="ar">` restored; all Arabic labels return
  (e.g. sidebar group "Settings" → "الإعدادات").

- **PLT-03** — Language choice survives a full reload.
  **Pre**: Language switched to English (PLT-01), not yet reloaded.
  **Steps**: Reload the browser tab (full navigation, not SPA re-render).
  **Assert**: On first paint, `<html lang="en" dir="ltr">` — the app does not
  flash Arabic before settling; login/dashboard renders in English immediately.
  Confirms `persistLocale`/`loadPersistedLocale` (`packages/ui/src/i18n/storage.ts`)
  round-trip through `localStorage`, independent of the session/auth cookie.

- **PLT-04** — Every settings screen re-labels itself in English, no missed strings.
  **Pre**: Language = English.
  **Steps**: Open each of the 14 items under Settings in turn (General, Branches,
  Warehouses, Print templates, Notification rules, Data migration, Approval
  settings, Numbering sequences, Barcode settings, Profile, API keys, Webhooks,
  Audit log) plus Users, Roles, and Approvals.
  **Assert**: Every page title, tab label, table column header, button label and
  empty-state string renders in English (`apps/web/src/i18n/catalog.ts`'s `en`
  block) — no residual Arabic string, no raw i18n key (e.g. `"nav.item.xyz"`)
  visible anywhere. A missing English key falls back to Arabic silently and logs
  `console.error("[i18n] missing "en" translation for key "…"")` in dev — check
  devtools console for this while clicking through.

---

### 2 — Global chrome: theme

`packages/ui/src/hooks/useTheme.ts` — a light/dark **toggle** button at the foot
of the sidebar rail (not a 3-way light/dark/system menu in the UI, though the hook
itself supports `"system"`; nothing in the shell exposes it). Default with nothing
stored is **light**, not system-preference.

- **PLT-05** — Toggle flips light → dark.
  **Pre**: Fresh session, no `mezan:theme` in localStorage (or cleared). Theme
  renders light (no `data-theme` attribute needed — see PLT-07).
  **Steps**: Click the theme toggle icon at the bottom of the sidebar rail.
  **Assert**: `<html data-theme="dark">` is set; every settings screen (cards,
  tables, the print-template live preview, the permission matrix) re-paints in
  the dark palette with no visible flash-of-wrong-theme; text stays legible
  (per `ROADMAP.md` §5 F2 — a fixed contrast bug now guarded by
  `scripts/check-color-tokens.mjs`, don't re-report a token/contrast mismatch
  without checking that script first).

- **PLT-06** — Toggle flips dark → light.
  **Pre**: Theme is dark (PLT-05).
  **Steps**: Click the toggle again.
  **Assert**: `<html data-theme="light">`.

- **PLT-07** — Theme persists across reload, independent of language.
  **Pre**: Theme = dark, language = English (from PLT-01/PLT-05, not yet reloaded).
  **Steps**: Reload the tab.
  **Assert**: Both preferences restore independently — dark theme AND English
  language on first paint (`localStorage["mezan:theme"] === "dark"`, i18n locale
  key = `"en"` — two separate keys, two separate restores, neither depends on
  the other).

---

### 3 — Global chrome: branch/warehouse scope switchers (sidebar rail)

`packages/ui/src/shell/ScopeSwitcher.tsx` — two native `<select>` elements pinned
above the nav groups (not topbar dropdowns as in the reference product). Branch
narrows warehouse options; warehouse selection persists via
`loadPersistedScopeSelection`/`useApi`'s `scopeSelection` state.

- **PLT-08** — Branch selector renders nothing when the tenant has no branch options.
  **Pre**: A session whose `branchOptions` (from `useScopeSelector`) is empty.
  **Assert**: `ScopeSwitchers` returns `null` — no empty/greyed selector shown;
  confirms the component's explicit "never render a fabricated list" contract.

- **PLT-09** — Selecting a branch narrows the warehouse selector.
  **Pre**: At least 2 branches, each with its own warehouse(s) — e.g. seed's
  الفرع الرئيسي (with `WH-MAIN` + `VAN`) plus a second branch created in
  **PLT-BRN-03**.
  **Steps**: Open the branch `<select>`; choose the second branch.
  **Assert**: The warehouse `<select>`'s option list re-renders to only that
  branch's warehouses (`w.branchId === scopeSelection.branchId` filter in
  `useScopeSelector`); if the previously-selected warehouse doesn't belong to the
  new branch, the warehouse selection silently clears to "كل المستودعات" (all
  warehouses) rather than staying stale.

- **PLT-10** — Scope selection persists across reload.
  **Pre**: Branch + warehouse both narrowed to a specific selection (not "all").
  **Steps**: Reload the tab.
  **Assert**: Both selects show the same narrowed selection after reload — the
  choice round-trips through the same persisted-state mechanism as
  session/scope, independent of theme and language.

- **PLT-11** — A user scoped to specific branches only sees those branches.
  **Pre**: A non-admin user (see **PLT-USR-CREATE**) whose `branchScope` is a
  specific branch list, not `ALL_SCOPE`. Log in as that user.
  **Assert**: The branch `<select>` only lists branches in `session.branchScope`
  (`allowedBranchIds` filter in `useScopeSelector`) — a branch the user isn't
  scoped to never appears as an option, even though it exists tenant-wide.

---

### 4 — General settings (`الإعدادات ← عام`)

`SettingsGeneral.tsx` — **4 tabs**, not the reference product's 10. Confirmed
**[NOT IMPLEMENTED]** relative to the reference: a standalone **البريد الإلكتروني /
Email-SMTP tab** (no SMTP host/port/sender fields, no email-template HTML editor,
no "send test email" anywhere in this build — `grep` across the whole repo for
`smtp`/`SMTP`/email-template strings returns nothing outside this note), and
standalone **نقطة البيع والولاء / POS & loyalty** and **طرق الدفع / POS payment
methods** tabs. This build folds the reference's separate Credit-control /
Inventory-policy / Purchase-control / Treasury-policy tabs into ONE **السياسات**
tab instead of four.

- **PLT-12** — Save button is disabled until a field is dirtied.
  **Pre**: Navigate to الإعدادات (Settings expanded → عام). "حفظ الإعدادات" button
  visible.
  **Assert**: Button is disabled on load (`disabled={!dirty}`); no status pill.

- **PLT-13** — Editing any field enables Save and shows the unsaved-changes pill.
  **Steps**: On the عام tab, change العملة الافتراضية (default currency) text field.
  **Assert**: "حفظ الإعدادات" becomes enabled; a "تغييرات غير محفوظة" (unsaved
  changes) warning-tone status pill appears next to the title.

- **PLT-14** — عام tab: language select changes the app UI language on save.
  **Steps**: Change "اللغة الافتراضية" to English; click "حفظ الإعدادات".
  **Assert**: On success the mutation's `onSuccess` calls `setLocale(saved.language)`
  — the WHOLE app flips to English immediately (same effect as the topbar toggle,
  §1), not just the stored tenant default. `dirty` resets to false and the
  warning pill disappears.

- **PLT-15** — عام tab: additional-currencies multi-chip picker.
  **Steps**: Open العملات الإضافية; select 2–3 of the 7 offered currencies
  (SAR/USD/AED/EUR/KWD/QAR/JOD — the reference's list additionally offered
  AED/QAR/KWD/BHD/OMR/JOD/USD/EUR/GBP against a 10-item tenant array; this
  build's picker is hardcoded to exactly these 7, so BHD/OMR/GBP are
  **[NOT IMPLEMENTED]** as selectable secondary currencies here even though the
  tenant payload could in principle carry them).
  **Assert**: Selected currencies render as active chips; Save persists them.

- **PLT-16** — عام tab: fiscal year start month, weekend days, numeral system,
  date format, timezone, FX-missing policy — every remaining field on the tab.
  **Steps**: Change each field once (fiscal start month 1→4, weekend days,
  Western↔Arabic numerals, direction RTL↔LTR, FX policy STRICT↔ALLOW_MISSING).
  **Assert**: Each change dirties the form; Save round-trips every value; a
  reopen of the settings screen shows the saved values (re-fetch from `/settings`).

- **PLT-17** — بيانات المنشأة tab: company profile + shared HR policy constants.
  **Steps**: Edit اسم المنشأة, الرقم الضريبي, السجل التجاري, الهاتف, البريد
  الإلكتروني, العنوان; edit weekend days (duplicated control — also present on
  this tab, independently wired to the same `weekendDays` field as the عام tab);
  edit فترة التنبيه على انتهاء العقد (7–365 day range hint), معامل العمل الإضافي
  (step 0.1), ساعات العمل اليومية القياسية.
  **Assert**: All save together under one "حفظ الإعدادات"; no separate save
  button per tab (differs from the reference, where each tab persisted
  independently within one page-level save — same here, single save covers all
  4 tabs' draft state at once).
  **Note**: no logo upload control on this tab in this build — **[NOT
  IMPLEMENTED]** (`شعار الشركة` file dropzone from the reference is absent).

- **PLT-18** — الضريبة tab: VAT toggle, default rate, calculation mode,
  depreciation proration, tax registration number.
  **Steps**: Toggle "تفعيل ضريبة القيمة المضافة" off; observe نسبة الضريبة
  الافتراضية field stays visible/editable regardless (no conditional hide);
  toggle back on; change طريقة حساب الضريبة between "غير شاملة" (exclusive) and
  "شاملة" (inclusive); change إهلاك شهر الاقتناء between "يومي — IFRS" and "شهر
  كامل".
  **Assert**: All four persist on save. **Note**: no info-callout deep link to
  `/accounting/taxes` for multi-rate management on this build's tax tab (present
  in the reference) — minor **[NOT IMPLEMENTED]**, not blocking.

- **PLT-19** — السياسات tab: credit control block.
  **Steps**: Toggle "تفعيل قوائم الأسعار" and "تفعيل الرقابة الائتمانية"; change
  وضع الرقابة between "تحذير فقط (WARNING)" and "منع تام (BLOCK)".
  **Assert**: Persists on save; matches `TenantSettingsDTO.creditControlMode`.

- **PLT-20** — السياسات tab: inventory-policy block.
  **Steps**: Toggle كل من — السماح بالبيع من مستودع آخر, عرض المخزون في
  المستودعات الأخرى, السماح بالطلبات المؤجلة, السماح بالمخزون السالب.
  **Assert**: All four persist. **Note**: the reference's aging-based
  write-down toggle (posting to GL 5060/1190) and auto-batch-number toggle are
  **[NOT IMPLEMENTED]** on this tab in this build — not present in
  `SettingsGeneral.tsx`'s policies section at all.

- **PLT-21** — السياسات tab: purchase-control 3-gate block.
  **Steps**: Toggle يجب وجود أمر شراء قبل استلام البضاعة, يجب وجود استلام بضاعة
  قبل فاتورة الشراء, تتبع البضاعة المستهلكة من فواتير الشراء.
  **Assert**: All three persist.

- **PLT-22** — السياسات tab: treasury-policy block.
  **Steps**: Toggle منع الرصيد السالب للحسابات النقدية (hint text explicitly
  states it applies to cash accounts only, bank accounts exempt) and السماح
  بالرصيد السالب للحسابات البنكية.
  **Assert**: Both persist; two separate booleans in this build
  (`preventNegativeCashBalance`, `allowNegativeTreasury`) rather than the
  reference's single toggle-with-hint-text — an actual second control, not
  just explanatory copy.

- **PLT-23** — Error path: save fails server-side.
  **Steps**: Dirty a field with a value the server rejects (e.g. an invalid
  `dateNumerals` enum sent by tampering the request, or trigger any 422 from
  `/settings`).
  **Assert**: A danger-tone `StatusPill` renders the server's error message
  next to the Save button; the draft is NOT cleared, `dirty` stays true so the
  user can retry without re-entering everything.

- **PLT-24 [NOT IMPLEMENTED]** — Multi-currency toggle as a platform-admin-only,
  read-only "نشط" badge.
  The reference shows تفعيل العملات المتعددة as a read-only badge with "تدار
  هذه الميزة من قبل مدير المنصة" (managed by the platform admin). This build's
  عام tab has no such field at all — multi-currency is implied only by the
  presence of the secondary-currency picker (PLT-15), with no explicit
  enabled/disabled indicator or platform-admin-only messaging anywhere in the
  UI.

---

### 5 — Branches (`الإعدادات ← الفروع`)

`BranchesPage.tsx` — list + a genuinely rich "Branch 360" detail with 5 tabs, not
just a CRUD form. Matches the reference's finding closely.

- **PLT-BRN-01** — List: stats and default state.
  **Pre**: Navigate to الفروع.
  **Assert**: Stat cards read إجمالي الفروع (1 in fresh seed), الفرع الرئيسي (1),
  نشط (1); table shows one row — الفرع الرئيسي / `MAIN`, "—" in الفرع الرئيسي
  (parent) column since it IS the main branch, "نشط" status pill.

- **PLT-BRN-02** — Search filters by name or code.
  **Steps**: Type "MAIN" into the search box; then type a non-matching string.
  **Assert**: First search still shows the row (code match, case-insensitive);
  second search yields the "لا توجد فروع مطابقة" empty state.

- **PLT-BRN-03** — Add branch — happy path.
  **Steps**: Click "إضافة فرع"; fill اسم الفرع = "فرع الإسكندرية", رمز الفرع =
  "ALEX", الهاتف, البريد الإلكتروني, العنوان; leave "فرع رئيسي" toggle off;
  click "حفظ الفرع".
  **Assert**: Panel closes; new row appears in the list; إجمالي الفروع stat
  becomes 2; الفرع الرئيسي stat count stays 1 (this branch isn't main).

- **PLT-BRN-04** — Add branch — no client-side required-field validation.
  **Steps**: Click "إضافة فرع"; leave اسم الفرع and رمز الفرع both empty; click
  "حفظ الفرع".
  **Assert**: The form has NO asterisks and no pre-submit check (`submitNewBranch`
  calls the mutation directly) — the request reaches the server, which rejects
  it via `packages/domain/src/settings/branch.ts`'s `validate()`. The error
  surfaces as a danger `StatusPill` reading the domain's raw message in
  **English**: `"name is required"` (and/or `"code must be 1-20 uppercase
  alphanumeric/-/_ characters"`) — a genuine English string leaking into an
  otherwise fully-Arabic form. Panel stays open, entered data is preserved.

- **PLT-BRN-05** — Add branch — duplicate/invalid code shape.
  **Steps**: Enter a code with lowercase letters or a space, e.g. "alex branch".
  **Assert**: Rejected server-side with the same English "code must be 1-20
  uppercase alphanumeric/-/_ characters" message (the field auto-uppercases on
  submit via `form.code.toUpperCase()`, but spaces/symbols still fail the regex).

- **PLT-BRN-06** — Branch detail — Overview tab.
  **Steps**: Click the الفرع الرئيسي row.
  **Assert**: Header shows branch name + code, نشط status pill, "الفرع الرئيسي"
  subtitle badge; summary strip shows كود الفرع, الهاتف, البريد الإلكتروني,
  العنوان (each "لا توجد" if unset), المستودعات count, الحالة. Overview tab body
  shows 8 KPI tiles (مبيعات الفرع, مشتريات الفرع, صافي حركة السندات, قيمة
  المخزون, حسابات الخزينة, الموظفون, الأصول الثابتة, حالة الفرع) plus a حسابات
  الخزينة table listing every treasury account whose `branchId` matches.

- **PLT-BRN-07** — Branch detail — Inventory tab, populated.
  **Pre**: The branch has at least one warehouse with stock on hand.
  **Steps**: Open المخزون tab.
  **Assert**: Table lists every item on hand across the branch's warehouses
  (merged, not per-warehouse), sorted by value descending; KPI row shows عدد
  الأصناف / عدد المستودعات / إجمالي قيمة المخزون.

- **PLT-BRN-08** — Branch detail — Inventory tab, empty state: no warehouses.
  **Pre**: A newly-created branch (PLT-BRN-03) with zero warehouses attached.
  **Steps**: Open its المخزون tab.
  **Assert**: "لا توجد مستودعات مرتبطة بهذا الفرع" empty state with guidance to
  link a warehouse from the المستودعات screen — no crash, no blank table.

- **PLT-BRN-09** — Branch detail — Employees tab, empty state.
  **Pre**: A branch with zero employees assigned.
  **Assert**: "لا يوجد موظفون مسجّلون على هذا الفرع" empty state.

- **PLT-BRN-10** — Branch detail — Assets tab, empty state vs. populated.
  **Pre A**: Branch with zero assets. **Pre B**: Branch (or the main branch) with
  at least one fixed asset registered against it.
  **Assert A**: "لا توجد أصول ثابتة مسجّلة على هذا الفرع" — note the empty-state
  copy explicitly clarifies company-level assets (no `branchId`) do NOT show
  here even though they exist. **Assert B**: Table lists code/name/category/
  acquisition date/cost/accumulated depreciation/net book value/status, plus 3
  summary KPIs (عدد الأصول, إجمالي التكلفة, صافي القيمة الدفترية).

- **PLT-BRN-11** — Branch detail — Activity tab: documents, not the audit trail.
  **Steps**: Open النشاط tab on a branch with at least one confirmed sales
  invoice, purchase invoice, or voucher.
  **Assert**: Rows list the branch's own confirmed/posted documents (sales
  invoices, purchase invoices, cash vouchers/receipts/transfers), newest first,
  with a footer note explicitly stating the audit trail carries no branch
  dimension and cannot be scoped here — direct the user to سجل المراجعة
  (Audit Log) instead for that view. Confirms this tab is document-derived, not
  audit-derived — do not confuse it with the Audit Log's branch filter (§18).

- **PLT-BRN-12** — Branch detail — Activity tab, empty state.
  **Pre**: A branch with zero documents.
  **Assert**: "لا توجد حركة مسجّلة على هذا الفرع".

- **PLT-BRN-13** — "رجوع لقائمة الفروع" returns to the list.
  **Steps**: From any branch detail tab, click the back button in the header.
  **Assert**: Returns to the branches list, scroll position/filter state reset
  (component unmounts fully — `selectedId` clears).

- **PLT-BRN-14 [NOT IMPLEMENTED]** — Branch edit / deactivate.
  The reference documents "إضافة فرع" only and defers CRUD depth; this build
  goes further with the full Branch 360 view but still has **no edit form and
  no deactivate action anywhere in the UI** — `BranchesPage.tsx` exposes create
  only (`useCreateBranch`); there is no `useUpdateBranch`/`useDeactivateBranch`
  hook, no edit button on the list row, and no status-toggle control on the
  detail header, even though the domain layer's `admin.branches.edit` /
  `.deactivate` permissions exist in the matrix (§8's catalog). Once a branch is
  created, its name/code/phone/email/address/status cannot be changed from the
  UI.

---

### 6 — Warehouses (`الإعدادات ← المستودعات`)

`WarehousesPage.tsx`.

- **PLT-WH-01** — List: stats and default state.
  **Assert**: إجمالي المستودعات (2 in the fresh seed: `WH-MAIN`, `VAN`), نشط (2),
  إجمالي الفروع (1, distinct `branchId`s). Table shows both rows with type pills
  (رئيسي for `WH-MAIN`, ڤان (سيارة توزيع) for `VAN`) and افتراضي marked on
  `WH-MAIN` only.

- **PLT-WH-02** — Type filter chips.
  **Steps**: Click each of the 6 chips in turn: كل الأنواع, رئيسي, مستودع وسيط,
  مرتجعات, إنتاج, ڤان (سيارة توزيع) — all 5 catalog warehouse types plus "all".
  **Assert**: Only warehouses of the selected type remain in the table; the
  transit/returns/production chips show an empty "لا توجد مستودعات مطابقة" state
  in the fresh seed (no warehouse of those types exists yet).

- **PLT-WH-03** — Search filters by name or code, combined with the type chip.
  **Steps**: With "رئيسي" chip active, search "VAN".
  **Assert**: Empty state — the VAN warehouse is type ڤان, filtered out by the
  active type chip regardless of the search match; confirms the two filters
  AND together (`typeFilter` then `search`, sequential `.filter()` in
  `WarehousesPage.tsx`).

- **PLT-WH-04** — Add warehouse — happy path.
  **Steps**: Click "إضافة مستودع"; اسم المستودع = "مستودع الإسكندرية", رمز
  المستودع = "WH-ALEX", اسم الفرع = (any branch — defaults to the first branch
  once branches load), نوع المستودع = "مستودع وسيط" (transit), leave "مستودع
  افتراضي للفرع" off; save.
  **Assert**: Row appears; type pill reads "مستودع وسيط"; إجمالي المستودعات → 3.

- **PLT-WH-05** — Add warehouse — no client-side required-field validation
  (same pattern as PLT-BRN-04): submitting with empty name/code sends straight
  to the server; failure surfaces as a danger `StatusPill` with the server's
  message; panel stays open with entered values intact.

- **PLT-WH-06 [NOT IMPLEMENTED]** — Warehouse edit / deactivate / branch filter.
  This screen has no edit action, no deactivate action, and — unlike the
  reference, which documented a "باسم الفرع" branch filter alongside the type
  filter — **no branch filter at all** here; only free-text search and the type
  chips. A multi-branch tenant with many warehouses per branch has no way to
  narrow the list to one branch's warehouses from this screen (the branch
  column is sortable/visible, not filterable).

---

### 7 — Users (`الإعدادات ← المستخدمون`)

`UsersPage.tsx` (`apps/web/src/pages/UsersPage.tsx`).

- **PLT-USR-01** — List: stats and default state.
  **Pre**: Fresh seed (1 real user, `USER-ADMIN`).
  **Assert**: إجمالي المستخدمين = 1, مستخدمون نشطون = 1, الأدوار المستخدمة = 1
  (counts distinct `roleId` OR `"__admin__"` sentinel for company-admin rows),
  غير نشط = 0. Row shows avatar initials, full name + email stacked, "مدير
  المنشأة" info-tone role pill (since `isCompanyAdmin: true`), "كل الفروع"
  branches cell (`ALL_SCOPE`), last login timestamp or "لم يسجل بعد", "نشط"
  status pill.

- **PLT-USR-CREATE** — Add user — the setup every non-admin scenario in this
  document depends on.
  **Pre**: At least one custom (non-system) role exists — create one first via
  **PLT-ROL-03** (e.g. code `SUPERVISOR`, holding `workflow.view` +
  `workflow.approve` + `workflow.reject`, matching the seeded
  `SALES_INVOICE_CONFIRM` workflow config's step role — see §16/§17).
  **Steps**: Click "إضافة مستخدم"; fill الاسم الكامل, البريد الإلكتروني, كلمة
  مرور مؤقتة (≥8 chars, hint shown inline); leave رمز PIN empty; leave "صلاحيات
  مدير المنشأة" UNCHECKED; pick الدور = SUPERVISOR from the `EntityPicker`;
  optionally link الموظف المرتبط; check at least one branch under الفروع
  المتاحة (required — the only field this form structurally requires by
  disabling nothing, but the checkbox group is visually marked required);
  click "حفظ المستخدم".
  **Assert**: New row appears with role pill "SUPERVISOR"'s role name (not
  "مدير المنشأة"); إجمالي المستخدمين increments; the new login can now be used
  for every "non-admin actor" precondition below.

- **PLT-USR-02** — Add user — company-admin toggle hides the role picker.
  **Steps**: Open "إضافة مستخدم"; check "صلاحيات مدير المنشأة".
  **Assert**: The الدور `EntityPicker` disappears entirely from the form
  (conditional render, not just disabled) and `roleId` resets to `null` in the
  draft — confirms company-admin and role assignment are mutually exclusive at
  the form level, matching the domain model (`isCompanyAdmin` bypasses the
  granular role/permission system entirely).

- **PLT-USR-03** — Edit user — password field becomes optional.
  **Steps**: Click an existing user row (e.g. `USER-ADMIN` or the user from
  PLT-USR-CREATE); observe the password field's label.
  **Assert**: Label reads "كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)"
  (new password — leave blank to keep the current one) instead of the create
  form's "كلمة مرور مؤقتة * (٨ أحرف على الأقل)" — same input, different
  required-ness communicated only through copy (no visual required marker
  changes). Saving with it blank must not clear/reset the existing password.

- **PLT-USR-04** — Edit user — branch/warehouse scope round-trips `ALL_SCOPE`.
  **Steps**: Open `USER-ADMIN`'s edit panel.
  **Assert**: Every branch checkbox is pre-checked (`scopeToIds` maps
  `ALL_SCOPE` → all known branch ids) — confirms the form doesn't distinguish
  "all branches" from "happens to have every branch checked" on the way in; on
  save without touching the checkboxes, the user's scope should remain
  effectively "all" (re-derived from the full-checked state, not literally
  preserved as `ALL_SCOPE` — worth watching for drift if a branch is added
  later without this user's checkbox state being revisited).

- **PLT-USR-05** — Toggle status — activate/deactivate from the row action.
  **Steps**: Click "تعطيل" on an active, non-self user row (create a second
  user first if only `USER-ADMIN` exists, since deactivating your own only
  login would be self-locking — the UI does not prevent this, see PLT-USR-06).
  **Assert**: Row's status pill flips to "غير نشط"; button label flips to
  "تفعيل"; غير نشط stat count increments; the click uses `e.stopPropagation()`
  so it does NOT also open the edit panel.

- **PLT-USR-06 [gap]** — No self-deactivation guard.
  **Steps**: While signed in as `USER-ADMIN` (the only real account before
  PLT-USR-CREATE), click "تعطيل" on `USER-ADMIN`'s own row.
  **Assert**: The UI has no client-side guard against this — `onToggleStatus`
  fires unconditionally. Whether the server itself refuses to deactivate the
  last active admin is a backend contract worth confirming; this is a genuine
  risk to flag rather than assume covered, since disabling the seed's only real
  login would strand the demo tenant. **Do not actually execute this against
  a shared demo tenant** — note the risk, don't detonate it.

- **PLT-USR-07** — Status filter chips.
  **Steps**: Click نشط, then غير نشط, then الكل.
  **Assert**: Table narrows to matching status each time; chip counts match the
  stat cards.

- **PLT-USR-08** — Search filters by name or email (case-insensitive).
  **Steps**: Search a fragment of `USER-ADMIN`'s email in mixed case.
  **Assert**: Row matches regardless of case (`.toLowerCase()` on both sides).

- **PLT-USR-09 [NOT IMPLEMENTED]** — Advanced filter panel.
  The reference documents a "تصفية النتائج" panel with الدور (role), الفروع
  المتاحة (available branches), and آخر دخول من/إلى (last-login date range)
  filters, beyond the basic search+status chips. None of that exists in this
  build — `UsersPage.tsx` has only the search box and the 3 status chips; there
  is no way to filter the user list by role or by last-login window.

- **PLT-USR-10** — Unlock a locked-out account, from the screen.
  **Pre**: Lock an account with 6 wrong PINs from a second browser/device
  (`retryAfterSeconds` comes back on the 6th).
  **Steps**: On `UsersPage.tsx`, locate the account's row and click "فكّ القفل"
  (renders only on an `active` row, gated on `onUnlock` being supplied — wired
  in `AppLayout.tsx` via `handleUnlockUser` → `POST /users/:id/unlock`, which
  needs `admin.users.unlock`).
  **Assert**: The row's own pending state shows while the call is in flight
  (`unlockingId === row.id`), the rest of the list stays interactive, and a
  second click while it is pending is a no-op. On success the same account can
  sign in immediately (streak reset to zero, not just the current lock cleared
  — try one more deliberate wrong PIN afterward and confirm it counts as
  failure 1, not 7 — note this is different from what a *served* lock does on
  its own; see `docs/INSTALL.md` §5); a `SECURITY / ACCOUNT_UNLOCKED` row
  appears in `الإعدادات ← سجل المراجعة`. This is the support answer for "why
  is the till locked" — see `docs/INSTALL.md` §5.

---

### 8 — Roles & permissions (`الإعدادات ← الأدوار والصلاحيات`)

`RolesPage.tsx` + `RoleEditorPage.tsx`. The permission matrix here is licensed:
`licensedModules`/`licensedPermissions` filter the ~286-permission catalog (20 modules) down to
what the tenant's `activeModules`/`features` actually license — an unlicensed
module's permissions never render as options at all (a stronger, more correct
gate than merely hiding them post-render).

- **PLT-ROL-01** — List: stats and default state.
  **Pre**: Fresh seed — only the system role exists.
  **Assert**: إجمالي الأدوار = 1, أدوار مخصصة = 0, أدوار النظام = 1, إجمالي
  الصلاحيات الممنوحة = 1 (`SYSTEM_ADMIN`'s single `"*"` entry counted as 1, not
  286 — worth noting the stat is a raw array length, not an expanded count).
  Row shows اسم الدور = "مدير النظام", الكود = `SYSTEM_ADMIN`, عدد الصلاحيات = 1,
  "نظام" info-tone pill, creation date.

- **PLT-ROL-02** — Type filter chips + search.
  **Steps**: Click نظام, مخصص, الكل chips; search by role name/code fragment.
  **Assert**: Filters narrow correctly; chip counts match stat cards.

- **PLT-ROL-03** — Create a custom role — happy path.
  **Steps**: Click "دور جديد"; enter اسم الدور = "مشرف", رمز الدور = "SUPERVISOR"
  (auto-uppercases as typed), وصف الدور optional; in the permission matrix,
  search "موافق" and check `workflow.view`, `workflow.approve`,
  `workflow.reject`; click "حفظ الدور".
  **Assert**: Returns to the roles list; new row "مشرف" / `SUPERVISOR`, "مخصص"
  tone pill, عدد الصلاحيات = 3 (or more if dependencies pulled in others — see
  PLT-ROL-06). أدوار مخصصة stat increments.

- **PLT-ROL-04** — Create role — required-field validation.
  **Steps**: Click "دور جديد"; leave both name and code empty; click "حفظ الدور".
  **Assert**: Danger banner "اسم الدور ورمزه مطلوبان" (role name and code are
  required); no navigation away, no request sent (client-side guard here,
  unlike Branches/Warehouses/Users' server-only validation).

- **PLT-ROL-05** — Edit an existing custom role — code is immutable.
  **Steps**: Click "تعديل" on the "مشرف" row (from PLT-ROL-03).
  **Assert**: رمز الدور input is `disabled` (role !== null → `disabled` prop
  true); name/description/matrix remain editable.

- **PLT-ROL-06** — Permission matrix — checking a permission auto-selects its
  dependencies.
  **Steps**: In the "مشرف" role editor, uncheck everything; check
  `sales.invoice.confirm` alone.
  **Assert**: `sales.invoice.view_own` (its declared dependency) becomes
  checked automatically (`togglePermission`'s dependency-closure walk over
  `resolvePermissions`); الصلاحيات المحددة summary count reflects both, not
  just 1.

- **PLT-ROL-07** — Permission matrix — unchecking a dependency cascades to
  dependents.
  **Steps**: With `sales.invoice.confirm` + `sales.invoice.view_own` both
  checked (PLT-ROL-06), uncheck `sales.invoice.view_own`.
  **Assert**: `sales.invoice.confirm` is automatically unchecked too (the
  cascading "anything left selected that depends on a now-removed code must go
  too" loop in `togglePermission`) — a permission is never left selected
  without its prerequisite.

- **PLT-ROL-08** — Permission matrix — module "select all" checkbox.
  **Steps**: Click the header checkbox (aria-label "تحديد الكل — <module>") on
  a fully-licensed module, e.g. لوحة التحكم (Dashboard, 2 permissions).
  **Assert**: Both `dashboard.view` and `dashboard.export` become checked in
  one click (dependency-closed via `toggleAll`); clicking it again with both
  checked deselects both.

- **PLT-ROL-09** — Permission matrix — platform-admin-only permissions are
  visibly disabled, not just unselectable.
  **Steps**: Search the matrix for `admin.tenant.settings.edit` or
  `admin.modules.manage`.
  **Assert**: The permission card is rendered `disabled`, with `title`/hover
  text "صلاحية مخصصة لمدير المنصة فقط" (platform-admin-only); clicking it does
  nothing; the module "select all" checkbox does NOT include it when selecting
  the whole module (`isPlatformAdminOnly` filtered out of `handleToggleModule`'s
  `selectableCodes`).

- **PLT-ROL-10** — Permission matrix — sensitive permissions carry a visible
  warning marker.
  **Steps**: Search for `sales.invoice.view_cost` (cost-price visibility) or
  `pos.delivery.cancel` (reverses a money movement).
  **Assert**: A "صلاحية حساسة" (sensitive permission) marker renders on the
  card with a warning-tone ring; the role editor's حساسة summary stat counts
  it once selected.

- **PLT-ROL-11** — Permission matrix — search narrows across modules.
  **Steps**: Type "فاتورة" (invoice) into the matrix search box.
  **Assert**: Only permission cards whose Arabic label matches remain visible,
  spanning sales/purchases modules simultaneously — confirms search isn't
  scoped to one expanded module.

- **PLT-ROL-12** — Delete a role that's in use — blocked.
  **Pre**: The "مشرف"/`SUPERVISOR` role has at least one user assigned
  (PLT-USR-CREATE).
  **Steps**: Attempt to click "حذف" on that role's row.
  **Assert**: The delete button itself is `disabled`, with `title` "الدور
  مستخدم من قبل مستخدمين" (role is in use by users) — the guard is client-side
  and pre-emptive, not a failed-request-then-error round trip.

- **PLT-ROL-13** — Delete an unused custom role — happy path.
  **Pre**: A second custom role with zero users assigned.
  **Steps**: Click "حذف"; confirm (no modal in this UI — the click deletes
  directly via `onDelete`).
  **Assert**: Row disappears; أدوار مخصصة stat decrements; a delete error (if
  the server independently refuses) surfaces as a danger banner in
  `filterBarExtra`, not a silent failure.

- **PLT-ROL-14** — System role — every field is locked.
  **Steps**: Click "تعديل" on the "مدير النظام" / `SYSTEM_ADMIN` system row.
  **Assert**: Name, code, description inputs all `disabled`; "حفظ الدور" is
  disabled (`disabled={saving || role?.isSystem}`); the permission matrix
  still RENDERS (read view) but the role's `"*"` grant can't be edited through
  it in any meaningful way; there is also no "حذف" button for this row on the
  list at all (system roles never render a delete action — `RolesPage.tsx`
  only renders it `{!row.isSystem ? ... : null}`).

- **PLT-ROL-15 [RBAC]** — A user without `admin.roles.view` cannot reach this
  screen.
  **Pre**: Sign in as a non-admin user whose role holds no `admin.roles.*`
  permission (e.g. the `SUPERVISOR` user from PLT-USR-CREATE, unmodified).
  **Steps**: Expand الإعدادات; click "الأدوار والصلاحيات".
  **Assert**: The sidebar item is NOT hidden and NOT disabled — this build has
  **no client-side nav gating at all** (`nav-config.ts` renders every item for
  every session regardless of permissions). The screen mounts its shell, but
  the underlying `useRoles()` query returns 403 from `gate("admin.roles.view")`
  in `roles-routes.ts`; the component's `query.isError` branch shows a danger
  card "تعذّر تحميل ..." with a "إعادة المحاولة" retry button instead of any
  role data — enforcement is server-only, surfaced as a load failure, not as
  a hidden or greyed-out nav entry. This is the general pattern for every
  `admin.*`/`workflow.*`/`notifications.rule.*`/`audit.logs.view`-gated screen
  in this document; it is called out once here in full and referenced by ID
  elsewhere rather than repeated per screen.

---

### 9 — API Keys (`الإعدادات ← مفاتيح API`)

`ApiKeysPage.tsx`. Diverges from the reference in two structural ways worth
testing explicitly: this build's scope picker is the **full** ~286-permission
matrix (with platform-admin-only entries visibly disabled), not a `.view`-suffixed
38-scope subset; and there is **no rate-limit field** and **no Connected Apps /
OAuth third-party grants table** anywhere on this screen.

- **PLT-API-01** — List: seeded 3 keys, one revoked.
  **Pre**: Demo seed (`packages/backend/src/demo-seed/platform.ts`).
  **Assert**: Table shows 3 rows — "تكامل المتجر الإلكتروني" (scopes
  `sales.invoice.view`+`.create`, "نشط" success pill), "لوحة التقارير المالية
  الخارجية" (scopes `accounting.coa.view`+`accounting.journal.view`, "نشط"),
  "مفتاح تكامل قديم" (scope `inventory.item.view`, "ملغى" neutral pill). إجمالي
  المفاتيح = 3, نشطة = 2, ملغاة = 1.

- **PLT-API-02** — Revoked key hides the revoke action.
  **Steps**: Locate "مفتاح تكامل قديم"'s row.
  **Assert**: No "إلغاء" button renders in its actions cell (`k.revokedAt ?
  null : <Button>` — the button is entirely absent, not disabled) — confirms a
  key can't be double-revoked from the UI.

- **PLT-API-03** — Create a key — full flow, reveal-once secret.
  **Steps**: Click "مفتاح جديد"; enter الاسم = "اختبار"; in the permission
  matrix check `inventory.item.view` and `inventory.stock.view`; click "إنشاء
  المفتاح".
  **Assert**: Panel closes; a warning-tone banner appears above the list:
  "تم إنشاء المفتاح "اختبار" — انسخه الآن، لن يُعرض مرة أخرى" with the full
  plaintext key in a `<code>` block and a "نسخ" copy button (label flips to
  "تم النسخ" after a successful `navigator.clipboard.writeText`); new row
  appears in the table showing only `k.prefix…` (masked), never the full key
  again — reload or reopen the screen and the plaintext is genuinely gone,
  only the prefix persists.

- **PLT-API-04** — Create a key — validation.
  **Steps A**: Leave الاسم empty, select at least one scope, submit.
  **Assert A**: Danger pill "اسم المفتاح مطلوب".
  **Steps B**: Enter a name, select zero scopes, submit.
  **Assert B**: Danger pill "اختر صلاحية واحدة على الأقل" (choose at least one
  permission).

- **PLT-API-05** — Create a key — platform-admin-only scopes are disabled in
  the picker, same as the role editor (§8's PLT-ROL-09).
  **Steps**: Search the create-key matrix for `admin.tenant.settings.edit`.
  **Assert**: Card renders disabled with the identical "صلاحية مخصصة لمدير
  المنصة فقط" reason — confirms the SAME `buildScopeModules`/`isPlatformAdminOnly`
  guard is reused here, not a separately-maintained (and possibly drifted) copy.

- **PLT-API-06** — Revoke an active key.
  **Steps**: Click "إلغاء" on "تكامل المتجر الإلكتروني"; observe the button
  shows "جارٍ الإلغاء…" while pending.
  **Assert**: Row's status pill flips to "ملغى"; its "إلغاء" action disappears
  (PLT-API-02's rule applies immediately); نشطة/ملغاة stat counts update.

- **PLT-API-07** — Search filters by name or key prefix.
  **Steps**: Search "قديم" (old); then search a fragment of a known key prefix.
  **Assert**: Both match — search checks `k.name.includes` OR `k.prefix.includes`.

- **PLT-API-08 [NOT IMPLEMENTED]** — Rate limit and Connected Apps.
  Neither the create-key form nor the list has a حد الطلبات (في الدقيقة) /
  rate-limit-per-minute field (present in the reference), and there is no
  second "التطبيقات المرتبطة" (Connected Apps) table anywhere on this screen —
  the reference's OAuth-style third-party-app-authorization story (which
  explicitly namechecked Claude as an example integration) does not exist in
  this build at all. Do not spend time hunting for a disconnect button; it was
  never built.

---

### 10 — Webhooks (`الإعدادات ← الويب هوك`)

`WebhooksPage.tsx`. This is the section with the most load-bearing, precisely
verifiable backend behaviour in the whole document — every assertion below is
checked against `packages/domain/src/webhooks/dispatcher.ts` and the exact
seed data in `packages/backend/src/demo-seed/platform.ts`.

- **PLT-WHK-01** — Event picker offers only what this build actually emits.
  **Steps**: Click "ويب هوك جديد"; open the events checklist.
  **Assert**: Exactly **5 events** are offered, across 2 categories — Sales:
  `SALES_INVOICE_CONFIRMED` (تم تأكيد فاتورة مبيعات), `SALES_INVOICE_VOIDED`
  (تم إلغاء فاتورة مبيعات), `SALES_RETURN_CONFIRMED` (تم تأكيد مردود مبيعات);
  Purchases: `PURCHASE_RETURN_CONFIRMED` (تم تأكيد مردود مشتريات),
  `PURCHASE_RETURN_VOIDED` (تم إلغاء مردود مشتريات). The other 34 codes in the
  39-event catalog (`DOMAIN_EVENT_CATALOG`) — every workflow/treasury/
  installments/cheques/POS/inventory/manufacturing/platform event except those
  5 — are absent from this picker entirely, not shown-and-disabled. This
  reflects `GET /webhooks/events`' live-narrowed response
  (`emittedEventCodes` wired in `create-backend.ts` from the sales-invoice and
  returns document-event bridges only).

- **PLT-WHK-02** — Subscribing to a non-deliverable event is rejected with
  `INVALID_WEBHOOK` — confirm the server refuses even if the client were
  bypassed.
  **Steps**: Using devtools or an API client, `POST /webhooks` with
  `events: ["CHEQUE_BOUNCED"]` (a real catalog code, just not deliverable).
  **Assert**: `422` with `{ error: "INVALID_WEBHOOK", reasons: [...] }`
  (`InvalidWebhookError`, thrown by `registerWebhook`'s event-policy check).
  The UI itself can never construct this request since the picker doesn't
  offer the code — this scenario proves the guard isn't merely cosmetic.

- **PLT-WHK-03** — List: seeded 2 webhooks.
  **Pre**: Demo seed.
  **Assert**: Table shows "تكامل نظام نقطة البيع الخارجي" (target
  `http://127.0.0.1:39217/hooks/mezan`, 3 events, "مفعّل" success pill) and
  "تكامل النظام المحاسبي القديم" (target `http://127.0.0.1:39218/legacy/
  receiver`, 2 events, "معطّل" neutral pill — created active then immediately
  PATCHed to `active: false` by the seed). إجمالي الويب هوك = 2, مفعّلة = 1.

- **PLT-WHK-04** — Create a webhook — reveal-once HMAC secret.
  **Steps**: Click "ويب هوك جديد"; الاسم = "اختبار", رابط الوجهة =
  `https://example.com/hooks/test`; check `SALES_INVOICE_CONFIRMED`; click
  "إنشاء الويب هوك".
  **Assert**: A warning banner shows the full `whsec_...` secret once, with
  copy/dismiss, identical UX pattern to the API key reveal (PLT-API-03); the
  new row's detail view never shows the secret again — only its subscribed
  events and delivery attempts.

- **PLT-WHK-05** — Create a webhook — validation (name, URL, ≥1 event, each
  independently).
  **Assert**: "اسم الويب هوك مطلوب" / "رابط الوجهة مطلوب" / "اختر حدثًا واحدًا
  على الأقل" fire in the order name→url→events, matching the three sequential
  `if` guards in `submitNewWebhook`.

- **PLT-WHK-06** — Toggle active/inactive from the list.
  **Steps**: Click the status pill/button in the الحالة column on the active
  seeded webhook.
  **Assert**: Shows "…" while pending (`togglingId === w.id`), then flips to
  "معطّل"; `e.stopPropagation()` on this click means it does NOT also open the
  detail view.

- **PLT-WHK-07** — Detail view — Overview tab.
  **Steps**: Click "تكامل نظام نقطة البيع الخارجي"'s row (not the status pill).
  **Assert**: Header shows name + target URL as subtitle, active/inactive
  status; Overview tab lists its 3 subscribed events as active chips with
  their Arabic labels resolved from `DOMAIN_EVENT_CATALOG`.

- **PLT-WHK-08** — Detail view — Deliveries tab: seeded failure evidence.
  **Steps**: Open محاولات التسليم on the same webhook.
  **Assert**: At minimum the 2 manually-seeded rows are present —
  `SALES_INVOICE_CONFIRMED` / نجحت (success) / status code `200` / no error
  message; `SALES_RETURN_CONFIRMED` / فشلت (failed) / no status code / error
  text containing `connect ECONNREFUSED 127.0.0.1:39217`.
  **Note**: because the seed also confirms a REAL sales return
  (`SRET-DEMO-1`) that this same active webhook is genuinely subscribed to,
  the real `WebhookDispatcher` fires against `127.0.0.1:39217` for real at
  seed time too — expect additional rows beyond the 2 manually inserted ones
  (see PLT-WHK-09 for the exact count this produces).

- **PLT-WHK-09** — Delivery retries are bounded, then stop — proven by the
  seed itself, not a synthetic test.
  **Pre**: `DEFAULT_WEBHOOK_RETRY_POLICY.maxAttempts = 3`
  (`packages/domain/src/webhooks/dispatcher.ts`). The seed confirms
  `SRET-DEMO-1` (a real sales return) while "تكامل نظام نقطة البيع الخارجي" is
  active and subscribed to `SALES_RETURN_CONFIRMED`, targeting an unreachable
  loopback port with nothing listening.
  **Steps**: Open the same webhook's محاولات التسليم tab; filter/scan for rows
  with event `SALES_RETURN_CONFIRMED`.
  **Assert**: Exactly **3** real dispatch-attempt rows for
  `SALES_RETURN_CONFIRMED` from the live confirm (on top of the 1 manually
  seeded synthetic failure row for the same event code — 4 total for that
  event, distinguishable by `attemptedAt` clustering), each failed, each with
  an error message ending in `attempt N/3: ... — giving up` on the final one
  — then no further rows accumulate no matter how long the tenant runs. This
  is the bounded-retry guarantee (`WebhookDispatcher.deliver`'s `for (attempt
  = 1; attempt <= maxAttempts; ...)` loop) made visible entirely through
  ordinary demo data, with no test harness required.

- **PLT-WHK-10** — A failing webhook never rolls back the operation that
  triggered it.
  **Pre**: Same as PLT-WHK-09 — the webhook target is provably unreachable.
  **Assert**: `SRET-DEMO-1` (the sales return whose confirm fired the doomed
  webhook) is nonetheless fully confirmed in the system — check it under
  المرتجعات ← مرتجعات المبيعات: status "مؤكد", inventory/GL effects applied
  normally. The webhook dispatch is fire-and-forget from the confirming
  request's perspective (`WebhookDispatcher.handle` never rejects — invariant
  1 in the dispatcher's own doc comment); a red network error in the delivery
  log must never correlate with a stuck or reverted business document.

- **PLT-WHK-11 [known gap, D6]** — Retries can outlive a backend shutdown.
  Not something to reproduce through the UI — recorded here as context for
  anyone who sees a delivery attempt missing its final row or a stack trace
  in server logs mentioning `"The database connection is not open"` right
  after a restart during PLT-WHK-09's window. Per `ROADMAP.md` §5 D6, this
  is a known, low-severity gap in shutdown ordering, not a UI defect — do not
  re-file it as a new finding.

- **PLT-WHK-12 [NOT IMPLEMENTED]** — No description field.
  The reference's create-webhook dialog includes an optional الوصف
  (description) textbox; this build's form has only name + URL + events — no
  description field anywhere on create, edit, or detail.

---

### 11 — Notification rules (`الإعدادات ← قواعد الإشعارات`)

`NotificationRulesPage.tsx`. This build's rule builder is a superset of the
reference in one respect (a fully working optional condition block, not merely
disabled placeholder fields) and a subset in another (no event/priority filter
dropdowns, no edit-existing-rule flow).

- **PLT-NOT-01** — List: seeded 4 rules.
  **Pre**: Demo seed.
  **Assert**: 4 rows — "تنبيه تأكيد فاتورة مبيعات" (event
  `SALES_INVOICE_CONFIRMED`, "عادية" info pill, in-app channel, active),
  "تنبيه مرتجع مبيعات" (event `SALES_RETURN_CONFIRMED`, "عالية" warning pill,
  in-app+email, active), "تنبيه مرتجع مشتريات" (event
  `PURCHASE_RETURN_CONFIRMED`, "عاجلة" danger pill, in-app, active), "تنبيه
  إلغاء مرتجع مشتريات" (event `PURCHASE_RETURN_VOIDED`, "منخفضة" neutral pill,
  push, **غير نشط** — this one was deactivated by the seed after creation).
  إجمالي القواعد = 4, القواعد النشطة = 3, القواعد المعطلة = 1.

- **PLT-NOT-02** — Status chips + toggle.
  **Steps**: Click "غير نشط" chip; assert only NR-DEMO-4 shows. Click its
  status pill to re-activate.
  **Assert**: Pill flips نشط↔غير نشط; stat counts update; chip filtering
  matches PLT-USR-07's pattern exactly (same `DocumentListStatusChip` idiom
  reused across this document's screens).

- **PLT-NOT-03** — Create a rule — event picker flags un-emitted events.
  **Steps**: Click "إضافة قاعدة"; open الحدث dropdown.
  **Assert**: Every one of the 39 catalog events IS offered here (unlike
  webhooks' 5-event picker — notification rules aren't narrowed the same way),
  but any event NOT in the live `emitted` set carries a visible " — لا يُطلق
  بعد" (not emitted yet) suffix on its label, and a hint line below the field
  reads "الأحداث المعلَّمة (لا يُطلق بعد) مسجَّلة في الكتالوج لكن لا يوجد في
  هذا الإصدار ما يطلقها — القاعدة المبنية عليها لن تعمل" (a rule built on one
  of these will never fire). Selecting an un-emitted event is NOT blocked —
  only warned against; this is deliberately softer than the webhook picker's
  hard 422 refusal.

- **PLT-NOT-04** — Create a rule — recipient type switches the value picker.
  **Steps**: Change نوع المستلم across all 3 options — حسب الصلاحية
  (permission), دور محدد (role), مستخدم محدد (user) — each time observing قيمة
  المستلم.
  **Assert**: Permission mode offers every permission code with its Arabic
  label; role mode offers the tenant's real roles list; user mode offers the
  tenant's real users list. Switching types clears the previously-selected
  value (`recipientValue: ""` reset in the `onChange`) rather than leaving a
  stale, type-mismatched value selected.

- **PLT-NOT-05** — Create a rule — channels multi-select with implementation
  hint.
  **Steps**: Observe قنوات الإرسال checkboxes.
  **Assert**: داخل التطبيق checked by default; hint text states in-app always
  works offline while بريد إلكتروني/إشعار فوري are only "queued" (قيد
  الإرسال). At least one channel is required to submit (submit button disabled
  when `form.channels.length === 0`).

- **PLT-NOT-06** — Create a rule — optional condition block.
  **Steps**: Toggle "إضافة شرط" on; fill حقل الشرط = "amount", العامل =
  "أكبر من" (gt), قيمة الشرط = "1000".
  **Assert**: The 3 condition sub-fields appear only once the toggle is on
  (contrast with the reference, where these fields existed but were
  permanently disabled/inert); submitting persists
  `condition: { field: "amount", operator: "gt", value: "1000" }` — a real,
  functioning feature in this build, not a stub.

- **PLT-NOT-07** — Create a rule — custom title/body with template variables.
  **Steps**: Fill عنوان مخصص (عربي) and نص الإشعار (عربي) using
  `{{customerName}}`, `{{amount}}`, `{{documentNumber}}` placeholders per the
  hint line; submit.
  **Assert**: Rule saves with the custom `titleAr`/`bodyAr`; row's subtitle
  under the rule name still shows the event's default Arabic label (from
  `EVENT_LABEL`), not the custom title — the custom copy is stored but not
  surfaced back on this list view (only relevant where the notification is
  actually rendered, e.g. the bell panel).

- **PLT-NOT-08** — Delete a rule.
  **Steps**: Click "حذف" on any rule.
  **Assert**: Row removed immediately (no confirmation modal); stat counts
  update.

- **PLT-NOT-09 [NOT IMPLEMENTED]** — Edit an existing rule.
  There is no "تعديل" action anywhere on this screen — the row click doesn't
  open a detail/edit view, and the actions column only has status-toggle and
  delete. A rule's event/recipient/priority/channels/condition/copy can only
  be set once, at creation; changing any of it means delete-and-recreate.

- **PLT-NOT-10 [NOT IMPLEMENTED]** — Event/priority filter dropdowns.
  The reference documents filter-by-الحدث (event) and filter-by-الأولوية
  (priority) comboboxes alongside the status tabs; this build has neither —
  only the search box (which, notably, has no visible search input wired in
  `NotificationRulesPage.tsx`'s `DocumentList` props either — re-verify
  against the live component if this matters for a specific test pass, since
  no `searchValue`/`onSearchChange` prop is passed here unlike every other
  `DocumentList` screen in this document) and the active/inactive/all chips.

---

### 12 — Numbering sequences (`الإعدادات ← تسلسلات الترقيم`)

`SequencesPage.tsx`. The counter itself is read-only in the main edit form by
design — a separate, deliberately friction-heavy panel is required to touch it.

- **PLT-SEQ-01** — List: all 25 document-type sequences.
  **Assert**: إجمالي التسلسلات = 25; row for each of the 25 codes documented in
  the reference (ASSET/AST-, BOM/BOM-, CASH_VOUCHER/CV-, CHEQUE/CHQ-,
  CONFIG_INSTANCE/CM-, CONTRACT/CTR-, CUSTOMER_REFUND/CRF-,
  DELIVERY_ORDER/DLV-, EMPLOYEE/EMP-, GOODS_RECEIPT/GR-,
  INSTALLMENT_PLAN/IP-, JOURNAL_ENTRY/JE-, LANDED_COST/LC-,
  LEAVE_REQUEST/LR-, PAYMENT_DISBURSEMENT/PAY-, PAYMENT_RECEIPT/REC-,
  PAYROLL_RUN/PR-, PAYSLIP/PS-, POS_SALE/POS- (pad length 8, the longest of
  the set), PURCHASE_INVOICE/PI-, PURCHASE_ORDER/PO-, PURCHASE_RETURN/PRT-,
  PURCHASE_RFQ/RFQ-, SALES_INVOICE/INV-, SALES_ORDER/SO-); إعادة ضبط سنوي stat
  = 0 (none flagged for annual reset in a fresh seed).

- **PLT-SEQ-02** — Search by code or label.
  **Steps**: Search "INV"; then search "فاتورة" (matches both SALES_INVOICE
  and PURCHASE_INVOICE labels).
  **Assert**: First narrows to `SALES_INVOICE`; second returns 2 rows.

- **PLT-SEQ-03** — Edit prefix — happy path, next-number preview updates.
  **Steps**: Click the `SALES_INVOICE` row; change البادئة from "INV-" to
  "SI-"; click "حفظ".
  **Assert**: Panel closes; row's البادئة column now "SI-"; الرقم التالي
  recomputes with the new prefix against the SAME current counter value (e.g.
  if current value was 14, next number is now `SI-000015`, not reset to
  `SI-000001`) — **prefix changes affect only the next document, never
  renumber history.**

- **PLT-SEQ-04** — Prove the no-renumbering guarantee against a real document.
  **Pre**: At least one confirmed sales invoice exists with number `INV-0000xx`
  under the old prefix (from before PLT-SEQ-03).
  **Steps**: After PLT-SEQ-03's prefix change, open that existing invoice.
  **Assert**: Its stored `docNo` still reads `INV-0000xx` — unchanged. Confirm
  a NEW invoice, and only the new one carries the `SI-` prefix. This is the
  single most important sequence assertion in this section; do not skip it in
  favor of just checking the settings-screen preview number.

- **PLT-SEQ-05** — Edit pad length.
  **Steps**: Change طول الترقيم (عدد الأصفار) from 6 to 4 on a low-volume
  sequence (e.g. `BOM`, currently at counter value 4); save.
  **Assert**: الرقم التالي preview recomputes to the shorter zero-padded form
  (`BOM-0005` instead of `BOM-000005`).

- **PLT-SEQ-06** — Edit pad length — required-field guard.
  **Steps**: Clear البادئة entirely, or set طول الترقيم to 0; attempt save.
  **Assert**: Danger pill "البادئة وطول الترقيم مطلوبان" (client-side guard —
  `form.prefix.trim() === "" || form.padLength < 1`); no request sent.

- **PLT-SEQ-07** — Toggle annual reset.
  **Steps**: Enable إعادة الضبط بالسنة المالية on any sequence; save.
  **Assert**: Row's column flips to "نعم"; إعادة ضبط سنوي stat increments.

- **PLT-SEQ-08** — Counter is read-only in the main form.
  **Steps**: Open any sequence's edit panel.
  **Assert**: القيمة الحالية للعداد and الرقم التالي render as plain text
  inside a `<dl>`, with explicit copy: "العداد للقراءة فقط هنا — لا يمكن
  تعديله بحرية حتى لا تنكسر ضمانة عدم وجود فجوات في الترقيم. لتعديله صراحةً
  انظر أدناه" (read-only here to protect the no-gaps guarantee; see below to
  change it explicitly) — no input control anywhere near these two values in
  the main form.

- **PLT-SEQ-09** — Explicit counter adjustment — guard rails.
  **Steps**: Click "تعديل العداد يدويًا…"; observe the panel that opens.
  **Assert**: Danger-tone panel with explicit warning copy that decreasing is
  always rejected (risk of reissuing a used number) and increasing creates a
  deliberate gap; a numeric field pre-filled with the CURRENT counter value
  and `min={sequence.currentValue}`; an acknowledgment checkbox
  ("أؤكد أنني أدرك أثر هذا التعديل ... ولا يمكن التراجع عنه") that must be
  checked before "تأكيد تعديل العداد" enables at all.

- **PLT-SEQ-10** — Explicit counter adjustment — below-current value rejected
  client-side.
  **Steps**: In the counter-adjust panel, type a value lower than the current
  counter (bypass the `min` attribute via devtools if the browser enforces
  it natively).
  **Assert**: Inline warning "القيمة الجديدة أقل من القيمة الحالية (N) — هذا
  التعديل مرفوض من الخادم"; "تأكيد تعديل العداد" stays disabled
  (`canConfirm = ack && !belowCurrent && !busy`) even with the checkbox
  ticked.

- **PLT-SEQ-11** — Explicit counter adjustment — happy path, deliberate gap.
  **Steps**: Type a value 5 higher than current; check the acknowledgment; click
  "تأكيد تعديل العداد".
  **Assert**: Server accepts (`confirm: true` in the request body); panel
  closes; القيمة الحالية للعداد in the parent form now reflects the new,
  higher value; الرقم التالي preview jumps accordingly — confirming a
  documented, intentional numbering gap was just created.

- **PLT-SEQ-12 [RBAC]** — `admin.sequences.edit`/`.reset` vs `.view` — a
  viewer without edit rights.
  **Pre**: A non-admin user whose role holds `admin.sequences.view` but not
  `.edit`/`.reset`.
  **Assert**: List loads normally (view-gated endpoint succeeds); the edit
  panel's save/counter-adjust calls fail with 403 from the server — surfaces
  as the same danger-`StatusPill` pattern used everywhere else in this
  document (PLT-ROL-15's general RBAC pattern, applied here).

---

### 13 — Barcode configuration (`الإعدادات ← إعدادات الباركود`)

`BarcodeConfigPage.tsx`. Genuinely a parsing-rules screen (scale/PLU barcode
price-embedding), not a label-design tool — label printing lives at
`/inventory/labels` (out of this document's scope, a different nav group
entirely; note it exists so a "where are the barcode label templates" search
doesn't stall here).

- **PLT-BAR-01** — General tab — defaults on a fresh tenant.
  **Assert**: نوع الترميز الافتراضي = "EAN-13"; طريقة تحديد باركود الصنف =
  "إدخال يدوي" (manual); no embedded rules exist yet
  (`createDefaultBarcodeConfig()`'s zero-rules default).

- **PLT-BAR-02** — General tab — switching to auto-generate reveals the prefix
  field.
  **Steps**: Change طريقة تحديد باركود الصنف to "توليد تلقائي".
  **Assert**: بادئة الترقيم التلقائي textbox appears (conditional render, only
  shown when mode is `AUTO`); typing non-digit characters is stripped live
  (`.replace(/\D/g, "")`).

- **PLT-BAR-03** — Embedded rules tab — add a rule with the worked example
  values.
  **Steps**: Click "إضافة قاعدة"; fill اسم القاعدة = "ملصق تخفيض"; leave
  defaults: البادئة = "2", الطول الكلي = 13, بداية كود الصنف = 1, طول كود
  الصنف = 5, بداية القيمة = 7, طول القيمة = 5, نوع القيمة = "سعر", الخانات
  العشرية = 2; click "حفظ الإعدادات".
  **Assert**: Rule card persists; القواعد (N) count increments; "مفعّلة"
  status pill on the card by default.

- **PLT-BAR-04** — Embedded rules — validation errors surface all reasons
  together.
  **Steps**: Add a rule with بداية القيمة set BEFORE بداية كود الصنف + طول
  كود الصنف ends (i.e. overlapping segments), and طول القيمة such that
  valueStart + valueLength exceeds الطول الكلي; click "حفظ الإعدادات".
  **Assert**: Save is blocked client-side —
  `validateBarcodeConfig(draft)` runs before the mutation fires; the combined
  Arabic reasons (segment-overlap + exceeds-total-length, joined by "، ") show
  next to the save button; nothing is sent to the server.

- **PLT-BAR-05** — Embedded rules — remove a rule.
  **Steps**: Click "×" on a rule card; save.
  **Assert**: Card disappears from the draft immediately (`removeRule`
  filters it out); persists on save.

- **PLT-BAR-06** — Live parse test — match.
  **Pre**: The rule from PLT-BAR-03 saved.
  **Steps**: In اختبار مسح باركود, paste `2012345025004` (prefix `2`, item
  code `012345`, price digits `02500`, check digit `4` — the worked example
  from the reference, adapted to this build's field layout); click "اختبار".
  **Assert**: Success-tone pill: "تطابق: كود الصنف 012345 — سعر 25". (Confirm
  the exact digit split against whatever rule fields were actually saved —
  the reference's example used `itemCodeLength: 6`; this build's blank-rule
  default is 5, so adjust the test string's digit count to match the SAVED
  rule, not the reference's illustration, before asserting a match.)

- **PLT-BAR-07** — Live parse test — no match.
  **Steps**: Paste an arbitrary barcode that matches no saved rule's prefix
  (e.g. all rules use prefix "2", paste one starting with "9").
  **Assert**: Neutral-tone pill "لا يوجد تطابق مع أي قاعدة".

- **PLT-BAR-08** — Live parse test only reflects SAVED rules, not the dirty
  draft.
  **Steps**: Edit a saved rule's totalLength in the draft (don't save yet);
  immediately run the live test against a barcode matching the OLD saved
  shape.
  **Assert**: The help copy explicitly warns "احفظ التغييرات أولًا لتظهر في
  نتيجة الاختبار" (save first for changes to show in the test result) — the
  test still matches against the last-saved config, not the in-progress edit;
  confirm this is actually true and not just documented, since it's an easy
  place for a UI to silently test against stale or dirty state either way.

- **PLT-BAR-09 [NOT IMPLEMENTED]** — EAN-13 check-digit validation toggle and
  max-value sanity cap.
  The reference's add-rule form includes التحقق من رقم المراجعة (EAN-13)
  (validate the trailing check digit) and الحد الأقصى للقيمة (a sanity-check
  max price, above which a read is treated as a scan error). Neither field
  exists on this build's `RuleCard` or in `EmbeddedBarcodeRule`'s type —
  confirmed absent from `packages/domain/src/barcode-config/barcode-config.ts`.
  A malformed barcode with a wrong check digit, or an absurdly large embedded
  price, will parse and "match" without complaint in this build.

---

### 14 — Print templates (`الإعدادات ← قوالب الطباعة`)

`PrintTemplatesPage.tsx` — full 9-tab designer, real API-backed, with a live
preview using the SAME `PrintView` renderer real documents print through.

- **PLT-PRT-01** — Save/undo gating.
  **Pre**: Fresh load — no draft.
  **Assert**: "تراجع" and "حفظ القالب" both disabled (`!dirty`); no status
  pill next to the title.
  **Steps**: Change any toggle.
  **Assert**: Both buttons enable; "تغييرات غير محفوظة" warning pill appears;
  clicking "تراجع" discards the draft (`setDraft(null)`) and both buttons
  disable again, reverting every changed field.

- **PLT-PRT-02** — Live preview reflects every toggle in real time.
  **Steps**: Toggle العنوان off under الترويسة tab.
  **Assert**: The aside preview panel (rendered via `PrintView` at 0.62 scale)
  updates immediately — the sample invoice's address line disappears from the
  rendered header — with no separate "refresh preview" action; the preview is
  driven by the SAME draft state as the form, not a stale snapshot.
  **Note [gap vs. reference]**: this build's preview always renders one fixed
  sample sales invoice (`createSampleInvoiceDocument()`); there is no
  document-type selector on the preview pane itself (the reference offered
  فاتورة مبيعات/عرض سعر/إيصال نقاط بيع as 3 preview-able types) — you cannot
  preview how a quote or a POS receipt would actually look from this pane;
  only the separate تخصيص حسب الوثيقة tab lets you configure other document
  types blind, without a matching preview.

- **PLT-PRT-03** — Identity tab: logo URL, position, size, primary color
  (dual-input color+hex-text sync), subtitle, page size.
  **Steps**: Set رابط الشعار to a URL, موضع الشعار = "الوسط", حجم الشعار =
  "كبير", change اللون الأساسي via both the color swatch AND the paired hex
  text input, set الوصف الفرعي, change مقاس الصفحة to A5.
  **Assert**: Changing the color swatch updates the hex text field and vice
  versa (both bound to the same `identity.primaryColor` string); preview's
  title/border color changes to match; page-size change is reflected (A5 vs
  A4 aspect in the scaled preview, if visually distinguishable).

- **PLT-PRT-04** — Header tab: 5 toggles.
  **Steps**: Toggle each of العنوان, الهاتف, البريد الإلكتروني, الرقم
  الضريبي, السجل التجاري off one at a time, observing the preview after each.
  **Assert**: Each corresponding line disappears from the preview's header
  block independently — no toggle affects another.

- **PLT-PRT-05** — Content tab: 5 toggles (اسم الفرع, اسم المستودع, الرقم
  الضريبي للعميل/المورد, شروط الدفع, الملاحظات) — same pattern as PLT-PRT-04,
  applied to the document-body metadata block.

- **PLT-PRT-06** — Columns tab: 6 line-item column toggles (كود الصنف, الوحدة,
  الوصف, خصم السطر, نسبة ضريبة السطر, مبلغ ضريبة السطر).
  **Assert**: Toggling كود الصنف on adds an item-code column to the preview's
  line-items table; toggling الوصف off removes the description column —
  confirm column COUNT in the rendered table matches the number of ON toggles
  plus the always-present item/qty/price/total core columns.

- **PLT-PRT-07** — Totals tab: subtotal, total discount, tax breakdown, amount
  in words.
  **Steps**: Toggle كتابة المبلغ بالحروف on.
  **Assert**: Preview renders the grand total spelled out in Arabic words via
  `amountInWords`/`EGP_WORDS` — confirm the spelled-out amount matches the
  sample invoice's actual numeric total (this is computed live, not a static
  string).

- **PLT-PRT-08** — Footer tab: text, signatures toggle, signature count,
  per-signature labels.
  **Steps**: Set نص التذييل; enable إظهار التوقيعات; set عدد التوقيعات to 2;
  fill both تسمية التوقيع fields (e.g. "أعده" / "اعتمده").
  **Assert**: Exactly 2 signature-label text fields render (driven by
  `signatureLabelList(count, labels)` which pads/truncates the labels array to
  match `signatureCount`); reducing the count to 1 removes the second label
  field WITHOUT discarding its typed text if the count is raised back to 2
  (the underlying array isn't cleared, only sliced/padded for display).

- **PLT-PRT-09** — Watermark tab: text + opacity, auto-disabled when text is
  empty.
  **Steps**: Leave نص العلامة المائية empty, set الشفافية to 0.5; observe no
  watermark in the preview despite the opacity value; then type "مسودة"
  (draft) into the text field.
  **Assert**: Description on this tab states explicitly the watermark
  "تُعطَّل تلقائيًا عند ترك النص فارغًا، بصرف النظر عن الشفافية" (auto-disables
  when text is empty, regardless of opacity) — confirm the preview shows NO
  watermark with empty text + nonzero opacity, and DOES show one once text is
  entered.

- **PLT-PRT-10** — POS receipt tab: independent of the main document settings.
  **Steps**: Toggle إظهار عنوان المستند, إظهار الرقم الضريبي, إظهار اسم
  العميل; set نص الشكر.
  **Assert**: Banner note on this tab states these settings apply ONLY to
  thermal POS receipts, not the main invoice/quote layout — confirm changing
  these does NOT alter the aside preview (which only ever renders the sample
  sales invoice, not a POS receipt — see PLT-PRT-02's gap note; there is no
  live way to visually confirm a POS-receipt-tab change from this screen at
  all).

- **PLT-PRT-11** — Per-document overrides — tri-state fields default to
  "inherit".
  **Steps**: Open تخصيص حسب الوثيقة tab; select نوع المستند = "مرتجع مبيعات".
  **Assert**: Every tri-state field (إظهار العنوان, إظهار الهاتف, ... — the
  same 20 fields listed in `TRI_STATE_FIELDS`) shows "افتراضي (بدون تخصيص)"
  by default (`value === undefined`), meaning this doc type currently follows
  the tenant-wide settings from the earlier tabs with no per-type override.

- **PLT-PRT-12** — Per-document overrides — set then clear a field.
  **Steps**: On "مرتجع مبيعات", set إظهار الهاتف to "إخفاء" (hide); save;
  reopen the tab and switch to "فاتورة مشتريات" then back to "مرتجع مبيعات".
  **Assert**: The override persists per document type — "مرتجع مبيعات" still
  shows "إخفاء" for that field after navigating away and back, while
  "فاتورة مشتريات" (never touched) still shows "افتراضي"; setting a field back
  to "افتراضي" removes that key entirely from the stored override object
  (`delete next[f.key]` when `v === undefined`), not just setting it to some
  sentinel — confirm via a subsequent GET that the key is truly absent, not
  present-with-null.

- **PLT-PRT-13** — Per-document override dropdown offers 9 document types.
  **Assert**: نوع المستند lists exactly فاتورة مبيعات, مرتجع مبيعات, عرض سعر,
  فاتورة مشتريات, مرتجع مشتريات, أمر شراء, استلام بضاعة, سند نقدي, سند تحصيل —
  9 types (`DOCUMENT_TYPE_OPTIONS`), fewer than the reference's "many more,
  scrollable/truncated" list — confirm no additional types are hidden below a
  scroll boundary in this build; the list is short enough to render in full.

- **PLT-PRT-14** — Error path: load failure.
  **Pre**: Force `GET /print-template-config` to fail (network throttling or
  a temporary permission removal).
  **Assert**: The whole page renders a single danger `StatusPill` "تعذّر تحميل
  قالب الطباعة" — no tabs, no preview, no partial UI; confirm there's no
  retry button on THIS particular failure path (unlike most other screens in
  this document) — a real gap if a transient failure requires a full
  navigation-away-and-back to recover rather than a retry click.

---

### 15 — Data migration (`الإعدادات ← نقل البيانات`)

`DataMigrationPage.tsx` + `data-migration-steps.ts`. **This section carries the
most important, evidence-backed findings in this entire document — read the
callout before writing any scenario against the shipped fixtures.** For the
consultant-facing version of the same sequence — which step needs which
permission, and where it sits relative to claiming the tenant and loading
opening balances — see `docs/INSTALL.md` §3.

> ### The commit gate is all-or-nothing per file, not per row
>
> `runStep()` (`packages/api/src/data-migration-routes.ts`) returns early
> without persisting ANYTHING when `!commit || errors.length > 0`. The UI's own
> `canCommit` guard (`!!result && result.errors.length === 0 && !result.createdIds`)
> disables "تأكيد الاستيراد" entirely whenever the preview reports even ONE
> error row. **A file with 3 valid rows and 1 invalid row cannot commit the 3
> valid rows — the commit button stays disabled until every row in that upload
> is clean.** The only way to "commit the valid rows while refusing the
> invalid ones" is to fix or remove the bad rows in the spreadsheet and
> re-upload a clean file. Every scenario below tests the REAL behaviour, not
> the row-level partial-commit some might assume from the phrase "refuse the
> invalid rows while committing the valid ones."

> ### Two of the four fixtures with an intentionally-invalid row also break
> their intentionally-valid rows
>
> `employees.xlsx` and `items.xlsx` (`test-fixtures/data-migration/`) leave a
> REQUIRED column blank on every row, including the rows meant to demonstrate
> a clean import. Confirmed by unzipping and reading the raw XLSX XML:
> - `employees.xlsx`: column D (تاريخ التعيين / hire date) is empty on **all
>   3 rows** (`E-101`, `E-102`, `E-103`). `employeesStep`'s
>   `if (!hireDate) reasons.push("تاريخ التعيين مطلوب")` fires unconditionally.
>   **Result: 0 of 3 rows are importable as shipped** — not "2 valid + 1
>   invalid" as the task brief's general description implies.
> - `items.xlsx`: column D (وحدة القياس الأساسية / base unit code) is empty on
>   **all 3 rows** (`IT-9001`, `IT-9002`, `IT-9003`). `itemsStep`'s
>   `if (!baseUnitCode) reasons.push("وحدة القياس الأساسية مطلوبة")` fires
>   unconditionally AND returns before ever reaching the `Money.fromMajor`
>   parse that would flag row 3's intended non-numeric-price defect
>   (`سعر غير رقمي` / "غير رقمي" in column E). **The deliberately-invalid
>   price test is masked** — the reported reason for row 3 will read only
>   "وحدة القياس الأساسية مطلوبة", never anything about the price.
>
> Write the scenarios below against what the fixtures ACTUALLY produce. Where
> the intended lesson ("preview reports it, commit refuses it, valid rows
> still commit") doesn't survive contact with the real file, that's the
> finding — report it, don't paper over it by hand-editing the fixture before
> testing.

- **PLT-MIG-01** — 13 steps, correctly ordered and numbered, no display bug.
  **Assert**: Steps render ١ through ١٣ in sequence with no repeated number
  (the reference's "٩ used twice" display bug is not reproduced here — this
  build's `data-migration-steps.ts` numbers cleanly: ١ الأقسام, ٢ الموظفين, ٣
  حسابات الخزينة, ٤ الموردون, ٥ العملاء, ٦ الأصناف, ٧ وحدات الأصناف, ٨
  تصنيفات الأصول, ٩ الأصول الثابتة, ١٠ فواتير المبيعات السابقة, ١١ مرتجعات
  المبيعات السابقة, ١٢ فواتير المشتريات السابقة, ١٣ مرتجعات المشتريات
  السابقة); only the first step starts expanded, the rest collapsed
  (accordion — one open at a time, `openStep` state).

- **PLT-MIG-02** — Step order is guidance, not a lock.
  **Steps**: With zero departments/employees imported, jump straight to step
  ٦ الأصناف (skipping ١–٥) and download its template.
  **Assert**: No blocking message, no disabled state — every step is
  independently openable at any time, matching the in-app Egyptian-Arabic
  intro copy ("تقدر تفتح أي خطوة في أي وقت — الترتيب إرشاد مش قفل").

- **PLT-MIG-03** — Departments (step ١) — template download.
  **Steps**: Click "تنزيل النموذج".
  **Assert**: An `.xlsx` downloads with sheet "الأقسام", columns الكود / الاسم
  / الاسم (إنجليزي) — matches `HISTORICAL_COLUMNS`-independent, department-
  specific spec.

- **PLT-MIG-04** — Departments — import the shipped fixture as-is: partial
  success, all-or-nothing gate blocks commit.
  **Steps**: Click "استيراد"; choose `test-fixtures/data-migration/
  departments.xlsx` (4 rows: `SALES`, `FIN`, `OPS`, then a duplicate `SALES`
  row labeled "مكرر — كود موجود بالفعل").
  **Assert**: Preview summary "3 صف صالح من إجمالي 4"; errors table shows one
  row — row 5 (the 1-indexed data row, i.e. the 4th data row after the
  header), reason `الكود "SALES" مكرر في نفس الملف` (code duplicated within
  the same file — this fires `checkDuplicateInBatch`, not the "already
  registered" check, since none of these codes exist in the tenant yet).
  "تأكيد الاستيراد" is **disabted** (per the callout above) despite 3 clean
  rows sitting right there.

- **PLT-MIG-05** — Departments — remove the bad row, re-upload, commit
  succeeds.
  **Steps**: Edit a copy of `departments.xlsx` removing the duplicate `SALES`
  row (leaving `SALES`/`FIN`/`OPS`); re-run "استيراد" with the edited file;
  once the preview shows "3 صف صالح من إجمالي 3" with zero errors, click "تأكيد
  الاستيراد".
  **Assert**: Summary flips to "تم استيراد 3 سجل بنجاح"; the step card shows a
  ✓ checkmark and "مسجّل: 3"; re-opening step ٢ الموظفين's department-code
  lookup now resolves `SALES`/`FIN`/`OPS`.

- **PLT-MIG-06** — Employees (step ٢) — import the shipped fixture: ALL rows
  rejected, not 2-of-3.
  **Pre**: PLT-MIG-05 completed (departments SALES/FIN/OPS exist).
  **Steps**: Import `employees.xlsx` (3 rows: `E-101`/SALES, `E-102`/FIN,
  `E-103`/NOPE — all with a blank hire-date column).
  **Assert**: Preview summary "0 صف صالح من إجمالي 3"; errors table has 3
  rows — `E-101`: "تاريخ التعيين مطلوب"; `E-102`: "تاريخ التعيين مطلوب";
  `E-103`: BOTH "تاريخ التعيين مطلوب" AND `القسم بالكود "NOPE" غير موجود —
  استورد الأقسام أولاً" (2 reasons on this row). "تأكيد الاستيراد" disabled.
  This is the fixture-breaks-its-own-valid-rows finding from the callout,
  made concrete.

- **PLT-MIG-07** — Employees — hand-fix hire dates, keep the bad-department
  row, confirm the intended lesson DOES work once the fixture bug is worked
  around.
  **Steps**: Edit a copy of `employees.xlsx`: fill a valid `hireDate` (e.g.
  `2026-01-01`) on all 3 rows, leaving `E-103`'s department code `NOPE`
  untouched; re-import.
  **Assert**: Preview "2 صف صالح من إجمالي 3"; the single remaining error is
  `E-103`'s "القسم بالكود \"NOPE\" غير موجود — استورد الأقسام أولاً" — commit
  still disabled (all-or-nothing). Remove `E-103` entirely and re-import a
  2-row file to actually see "تم استيراد 2 سجل بنجاح" — only then does the
  step's مسجّل badge show 2 and the ✓ checkmark appears.

- **PLT-MIG-08** — Treasury accounts (step ٣) — clean import, no deliberately
  invalid row exists in this fixture.
  **Steps**: Import `treasury-accounts.xlsx` (1 row: `CASH-001`, type `cash`,
  opening balance `0.00`).
  **Assert**: Preview "1 صف صالح من إجمالي 1"; commit succeeds. **Note**: this
  fixture contains NO negative-opening-balance row — contrary to a literal
  reading of the task brief, the negative-value test lives in `customers.xlsx`
  instead (PLT-MIG-11), not here. `treasuryStep`'s own validation DOES reject
  a negative opening balance for a `cash`-type account with reason "لا يمكن
  أن يكون الرصيد الافتتاحي لحساب نقدي سالبًا" — if a negative-balance
  regression test is wanted for THIS step specifically, hand-edit a copy of
  this fixture to add one; the shipped file won't exercise it.

- **PLT-MIG-09** — Suppliers (step ٤) — clean import.
  **Steps**: Import `suppliers.xlsx` (2 rows: `S-9001`, `S-9002`, both
  complete).
  **Assert**: Preview "2 صف صالح من إجمالي 2"; commit succeeds; no
  deliberately-invalid row in this fixture either.

- **PLT-MIG-10** — Customers (step ٥) — independent of prior steps, ordering
  confirmed.
  **Steps**: Import `customers.xlsx` with NO prior steps completed in this
  session (customers don't reference departments/employees/treasury/
  suppliers).
  **Assert**: Import succeeds regardless of what other steps have or haven't
  run — confirms the help text's "مستقل عن باقي الخطوات" claim.

- **PLT-MIG-11** — Customers — the fixture's actual invalid row, precisely.
  **Steps**: Import `customers.xlsx` (3 rows: `C-9001`, `C-9002` clean;
  `C-9003` named "رصيد سالب غير صالح" / "invalid negative balance" with
  paymentTermsDays = `-5`).
  **Assert**: Preview "2 صف صالح من إجمالي 3"; the row-3 error reads
  **"مدة السداد يجب أن تكون رقمًا صحيحًا غير سالب"** (payment terms must be a
  non-negative whole number) — from `validatePartnerBase`'s
  `paymentTermsDays < 0` check. **Correction to the task brief's framing**:
  customers have no `openingBalance` field in this import step at all (that
  concept only exists for treasury accounts, PLT-MIG-08); the row's Arabic
  label calls it a "negative balance" but the actual rejected value is a
  negative payment-terms-days figure. The row IS correctly rejected — just not
  for the reason its own name suggests. Commit is disabled until the bad row
  is removed or fixed; a 2-row clean re-upload commits "2 سجل بنجاح".

- **PLT-MIG-12** — Items (step ٦) — see PLT-MIG-06's sibling finding.
  **Steps**: Import `items.xlsx` as shipped (3 rows, all missing
  `baseUnitCode`).
  **Assert**: Preview "0 صف صالح من إجمالي 3"; all 3 rows show reason
  "وحدة القياس الأساسية مطلوبة" ONLY — `IT-9003`'s deliberately non-numeric
  `salePrice` ("غير رقمي") is never evaluated because the row returns early on
  the missing-unit-code check before reaching the `Money.fromMajor` try/catch.

- **PLT-MIG-13** — Items — hand-fix unit codes, confirm the non-numeric-price
  test actually works once unmasked.
  **Steps**: Edit a copy of `items.xlsx`: fill `baseUnitCode = "PCS"` (a real
  seeded unit code) on all 3 rows, leaving `IT-9003`'s `سعر البيع` = "غير
  رقمي" untouched; re-import.
  **Assert**: Preview "2 صف صالح من إجمالي 3"; row 3's error now correctly
  surfaces a price-parsing failure (`Money.fromMajor("غير رقمي")` throws,
  caught and reported as the row's `reasons`) — THIS is the scenario that
  actually demonstrates "non-numeric price rejected," and it only works after
  correcting the fixture's own blocking defect.

- **PLT-MIG-14** — Item units (step ٧) — references items by code, single
  clean row.
  **Steps**: Import `item-units.xlsx` (1 row: `ITM-1`/`BOX`/كرتونة/factor 12)
  — note this references item code `ITM-1`, which doesn't match either
  fixture item code (`IT-9001`/`IT-9002`/`IT-9003` from `items.xlsx`).
  **Assert**: Depending on whether the item-lookup is a hard requirement or
  silently skips unmatched rows, confirm the actual behavior — if
  `itemUnitsStep` requires the referenced item to exist first (per its help
  text: "بعد الأصناف، لأن كل صف بيرجع لصنف بالكود"), this row should be
  rejected with an item-not-found reason UNLESS `ITM-1` happens to exist from
  a prior step. Do not assume success; the fixture's item code doesn't line
  up with the items fixture's codes, which is itself worth flagging as a
  cross-fixture inconsistency if confirmed.

- **PLT-MIG-15** — Asset categories (step ٨) — clean import.
  **Steps**: Import `asset-categories.xlsx` (1 row: `CAT-1` أثاث ومعدات, 60mo
  useful life, 10% salvage).
  **Assert**: Preview "1 صف صالح من إجمالي 1"; commits cleanly.

- **PLT-MIG-16** — Fixed assets (step ٩) — clean import, references category.
  **Pre**: PLT-MIG-15 completed (`CAT-1` exists).
  **Steps**: Import `assets.xlsx` (1 row: `AST-1` مكتب, category `CAT-1`,
  acquisition 2026-01-01, cost 5000.00) as a legacy opening-balance asset.
  **Assert**: Preview "1 صف صالح من إجمالي 1"; help text confirms this posts
  NO new GL journal entry (registered as رصيد افتتاحي).

- **PLT-MIG-17** — Historical sales invoices (step ١٠) — the 4 historical
  fixtures are identical placeholders, not distinct scenario data.
  **Steps**: Open and diff `historical-sales-invoices.xlsx`,
  `historical-sales-returns.xlsx`, `historical-purchase-invoices.xlsx`,
  `historical-purchase-returns.xlsx`.
  **Assert**: All 4 files contain the exact SAME single row — `documentNumber
  INV-1001`, `partyId cus-1`, `date 2026-01-15`, `qty 10`, `unitCost 85.00`,
  `amountPaid 500.00` — a generic template example, not a document-type-
  specific scenario, and none of the 4 files contains a deliberately-invalid
  row (no bad date, no negative qty, no non-numeric cost). Whatever
  "deliberately invalid historical row" behavior needs testing must be
  hand-authored; the shipped fixtures don't provide one for any of these 4
  steps.

- **PLT-MIG-18** — Historical import — `partyId` is never checked against a
  real customer/supplier.
  **Steps**: Import `historical-sales-invoices.xlsx` as shipped (`partyId:
  "cus-1"`, which matches no real seeded customer code such as `C-9001`).
  **Assert**: The row is accepted at the domain-validation layer regardless
  (`packages/domain/src/purchasing/historical-import.ts`'s row validator only
  checks non-empty presence — `if (row.supplierId.trim() === "")` — never
  existence against a repository; the sales-side route
  (`sales-historical-import-routes.ts`) likewise never resolves `customerId`
  against `CustomerRepository`). The archived document ends up carrying a
  `partyId` of `cus-1` that corresponds to no real customer record anywhere —
  confirm this by trying to find "cus-1" attributed anywhere in Customer 360
  or an AR aging report; it won't appear, because it isn't a real customer id.
  This is a genuine, testable gap: historical import happily creates orphaned
  party references.

- **PLT-MIG-19** — Historical sales returns (step ١١) — "import invoices
  first" ordering.
  **Pre**: Step ١٠ (historical sales invoices) has NOT yet been committed in
  this session.
  **Steps**: Attempt to preview/import `historical-sales-returns.xlsx` first.
  **Assert**: Confirm whether the preview step actually enforces "the return
  must link to an imported invoice" (per the in-app warning copy: "استورد
  الفواتير أولاً — المرتجع لازم يتربط بفاتورة مستوردة") or merely displays the
  warning without a hard block — the row's `documentNumber` in the shipped
  fixture (`INV-1001`) matches the invoices fixture's `documentNumber`
  exactly, so testing this ordering rule meaningfully requires committing
  step ١٠ first with that exact document number, then re-running step ١١'s
  identical-numbered row and confirming it correctly attaches rather than
  silently creating an unlinked return.

- **PLT-MIG-20** — Registered-count badge and ✓ checkmark reflect live status,
  not the last preview.
  **Pre**: Any step successfully committed (e.g. PLT-MIG-05).
  **Steps**: Collapse and re-expand that step's card.
  **Assert**: مسجّل: N badge and the header ✓ checkmark both come from
  `useDataMigrationStatus()` (a live server count), not from the local
  `result` state of the last preview/commit — confirm they survive a full
  page reload (which resets all local React state) by reloading and
  re-checking the badge.

- **PLT-MIG-21** — Footer scope-boundary note.
  **Assert**: Page footer explicitly states physical-count import and
  stock-transfer import are NOT part of this wizard — they live inside the
  physical-count sheet and the transfer screen themselves. Do not treat their
  absence here as a gap; it's a documented, deliberate IA boundary.

- **PLT-MIG-22 [RBAC]** — Preview vs. commit permission split.
  **Pre**: A non-admin user whose role holds `admin.settings.view` but not
  `admin.settings.edit`.
  **Assert**: Every step's preview ("استيراد") succeeds (gated on `.view`);
  every step's commit ("تأكيد الاستيراد") fails with 403 (gated on `.edit`) —
  confirm the button click surfaces a failure rather than silently doing
  nothing; `MasterStepCard`/`HistoricalStepCard` don't appear to special-case
  a 403 on commit distinctly from any other mutation error, so check what
  actually renders (likely nothing visible beyond the button staying in its
  "جارِ التأكيد…" state briefly then reverting with no error surfaced — a gap
  worth confirming precisely).

---

### 16 — Workflow / approval settings (`الإعدادات ← إعدادات الموافقات`)

`WorkflowConfigPage.tsx` — the chain-builder that feeds the Approvals Inbox
(§17). This build supports full edit and delete, unlike the reference (create
only observed there).

- **PLT-WFC-01** — List: seeded 2 configs.
  **Pre**: Demo seed.
  **Assert**: 2 rows — تأكيد فاتورة المبيعات (`SALES_INVOICE_CONFIRM`, 1 step,
  "نشط") and تأكيد فاتورة المشتريات (`PURCHASE_INVOICE_CONFIRM`, 1 step,
  "نشط"). سير عمل مُعرّف stat = 2.

- **PLT-WFC-02** — "إضافة سير عمل جديد" only offers UN-configured action
  types.
  **Steps**: Click "إضافة سير عمل جديد"; open نوع الإجراء.
  **Assert**: `SALES_INVOICE_CONFIRM` and `PURCHASE_INVOICE_CONFIRM` are
  ABSENT from the dropdown (`availableActionTypes` filters out
  `configuredActionTypes`); the remaining 24 of the 26 catalog action types
  are offered (Sales quote-send, PO confirm, GRN confirm, purchase-return
  confirm, landed-cost confirm, payment/receipt voucher confirm, capital
  withdrawal confirm, tax payment confirm, stock transfer confirm, stock
  adjustment confirm, journal post/void, payroll run approval, the 9
  leave-type-specific approvals, and work-order start).

- **PLT-WFC-03** — Create a chain — role picker is custom-roles-only.
  **Pre**: At least one custom role exists (PLT-ROL-03's "مشرف"/`SUPERVISOR`).
  **Steps**: Select نوع الإجراء = "تأكيد سند صرف/قبض" (any un-configured
  type); in خطوات الموافقة, اختر الدور dropdown.
  **Assert**: Only custom (non-system) roles appear — `SYSTEM_ADMIN` is
  filtered out entirely (`customRoles = roles.filter(r => !r.isSystem)`),
  consistent with admins bypassing every gate via `permissions: ["*"]`
  regardless of chain configuration.

- **PLT-WFC-04** — Create a chain — no custom roles exist yet: guarded, not
  broken.
  **Pre**: A tenant with zero custom roles (hypothetically — or test against
  the very first load before PLT-ROL-03 exists).
  **Assert**: "لا توجد أدوار مخصصة — أنشئ دورًا مخصصًا أولًا من صفحة الأدوار
  والصلاحيات" guidance text renders; "إضافة خطوة" button is disabled
  (`disabled={customRoles.length === 0}`) — cannot even start building a step
  without a role to assign it to.

- **PLT-WFC-05** — Create a chain — multi-step sequential approval.
  **Steps**: Add step 1 (role = "مشرف", وصف = "مراجعة أولى"); click "إضافة
  خطوة"; add step 2 (role = a second custom role, وصف = "اعتماد نهائي");
  save.
  **Assert**: New row shows عدد الخطوات = 2; opening it for edit shows both
  steps in order with their step-number badges ("خطوة 1", "خطوة 2").

- **PLT-WFC-06** — Create a chain — remove a step (only when >1 exists).
  **Steps**: With 2 steps drafted, click "إزالة" on step 2.
  **Assert**: Step 2 disappears, only step 1 remains; the "إزالة" button is
  absent entirely on step 1 while it's the only step
  (`steps.length > 1` guard) — cannot remove down to zero steps from the UI.

- **PLT-WFC-07** — Create a chain — validation.
  **Steps**: Leave every step's role unselected (or all steps removed down to
  one with an empty role); click "حفظ سير العمل".
  **Assert**: Danger message "أضف خطوة واحدة على الأقل مع اختيار الدور
  المعتمد" (add at least one step with an approver role selected); no request
  sent (`cleanSteps.length === 0` guard, client-side).

- **PLT-WFC-08** — Edit an existing chain — action type is locked.
  **Steps**: Click the "تأكيد فاتورة المبيعات" row (or its "تعديل" button).
  **Assert**: نوع الإجراء select is `disabled`, pre-filled to the existing
  action type only; only the steps list is editable; save calls the update
  endpoint (`useUpdateWorkflowConfig`), not create.

- **PLT-WFC-09** — Edit an existing chain — add a second step to a 1-step
  chain.
  **Steps**: Open "تأكيد فاتورة المبيعات" (currently 1 step, role SUPERVISOR);
  add a second step with a different custom role; save.
  **Assert**: عدد الخطوات → 2 on the list; the Approvals Inbox's step counter
  for any future request against this action type would now show "1 / 2"
  instead of "1 / 1" — this directly changes what §17's approve flow requires.

- **PLT-WFC-10** — Delete a chain.
  **Steps**: Click "حذف" on any non-seed-critical row (avoid deleting the two
  seeded configs if §17's scenarios still depend on them being intact — use a
  chain created in PLT-WFC-05 instead).
  **Assert**: Row disappears; سير عمل مُعرّف decrements; the deleted action
  type reappears as selectable in "إضافة سير عمل جديد"'s dropdown.

- **PLT-WFC-11** — Search by action type label.
  **Steps**: Search "فاتورة".
  **Assert**: Matches both sales- and purchase-invoice-confirm rows.

- **PLT-WFC-12 [RBAC]** — `workflow.config.view` vs `.manage`.
  **Pre**: A non-admin user with `workflow.config.view` but not `.manage`.
  **Assert**: List loads; "إضافة سير عمل جديد" / edit / delete all fail
  server-side with 403 (same general pattern as PLT-ROL-15) — confirm the UI
  doesn't crash on the failed mutation, and that whatever error surfaces (or
  fails to) matches what PLT-MIG-22 found for the analogous split there.

---

### 17 — Approvals inbox (`الموافقات`, top-level nav item)

`ApprovalsInboxScreen.tsx`. **Read the two traps at the top of this document
before writing or running anything here** — they are not general color, they
are the entire reason this section's Pre-conditions look the way they do.

- **PLT-APR-01 — THE TRAP, reproduced and confirmed.**
  **Pre**: Signed in as `USER-ADMIN` (the seed's only account, `permissions:
  ["*"]`). At least one workflow config exists gating some action (seeded:
  `SALES_INVOICE_CONFIRM`).
  **Steps**: Create and confirm a new sales invoice as this admin account.
  **Assert**: The invoice confirms IMMEDIATELY — no "بانتظار الموافقة" hold,
  because `startApproval`'s `hasAdminRole` check short-circuits the gate for
  any submitter whose roles include `"*"`. Open الموافقات: it is empty (0
  rows) with respect to anything this admin action would have produced. **This
  is correct, documented behavior, not a bug** — do not file "approvals inbox
  is broken" from this alone.

- **PLT-APR-02** — Seeded pending request IS visible to the admin account
  (because admin sees everything, not because admin submitted it).
  **Pre**: Demo seed's `APR-DEMO-1` (سير عمل: `SALES_INVOICE_CONFIRM`, step 0
  requiring role `SUPERVISOR`, submitted by the synthetic actor
  `USER-SALES-REP-1` during seeding — NOT a real login in this build, see the
  callout below).
  **Steps**: Signed in as `USER-ADMIN`, open الموافقات.
  **Assert**: `APR-DEMO-1` DOES appear — one row, "فاتورة مبيعات بقيمة 5,200
  ج.م — مجموعة الفجر التجارية", الخطوة الحالية "1 / 1", الدور المطلوب
  "SUPERVISOR", مُقدَّم من `USER-SALES-REP-1`. This works because
  `listPendingForRoles` special-cases `roles.includes("*")` to return every
  pending request unfiltered (`packages/persistence/src/approval-request-
  store.ts`) — admin sees the whole queue, distinct from the submit-side
  bypass in PLT-APR-01.

- **PLT-APR-03 — the decide-side trap, confirmed against real seed data.**
  **Pre**: Same as PLT-APR-02 — `APR-DEMO-1` visible, signed in as
  `USER-ADMIN`.
  **Steps**: Click "رفض" (reject) on `APR-DEMO-1`'s row.
  **Assert**: The request does NOT end up rejected. `decide()`'s admin branch
  ignores `input.decision` entirely and always grants — the request's status
  becomes `"approved"` with a `"bypass"` decision kind, and it disappears from
  the pending list as if approved. **Clicking "reject" as an admin approves.**
  Do not run this against `APR-DEMO-1` if a later scenario (PLT-APR-06/07)
  still needs it pending — use a disposable request instead, or restore the
  seed.

- **PLT-CALLOUT — there is no real non-admin login in this seed; you must
  create one.**
  The synthetic actors named in `demo-seed/platform.ts`
  (`USER-SALES-REP-1`, `USER-PURCHASING-1`, `USER-FINANCE-MGR`,
  `USER-SUPERVISOR-1`, `USER-SALES-REP-2`) are `x-user-id`/`x-role-codes`
  HTTP headers the seed script sends directly to the backend — they are
  **not** rows in the Users table, have no password, and cannot be signed
  into through the login screen (`packages/backend/src/seed.ts` creates
  exactly one real account, `USER-ADMIN`). To genuinely exercise a non-admin
  approve/reject/request-modification decision through the live UI (not via
  raw API calls), you must first: (1) create a custom role via **PLT-ROL-03**
  with `code: "SUPERVISOR"` — matching `APR-DEMO-1`'s required step role
  exactly, string-for-string — holding at least `workflow.view` +
  `workflow.approve` + `workflow.reject`; (2) create a user via
  **PLT-USR-CREATE** assigned to that role; (3) sign out of `USER-ADMIN` and
  sign in as the new user. Only then does clicking "رفض"/"موافقة"/"طلب تعديل"
  exercise the REAL non-admin decision path (`decide()`'s non-admin branch,
  which actually reads `input.decision`).

- **PLT-APR-04** — Non-admin approve — happy path, correct step-role match.
  **Pre**: Signed in as the `SUPERVISOR`-role user from **PLT-CALLOUT**.
  **Steps**: Open الموافقات; confirm `APR-DEMO-1` is visible (role match);
  type an optional note in the row's ملاحظة field, e.g. "المستندات سليمة";
  click "موافقة".
  **Assert**: Row disappears from the pending list; the mutation's response
  body (`ApprovalRequestDTO`) — inspect via network tab — shows `status:
  "approved"`, `decisions: [{ stepIndex: 0, kind: "approve", actorId:
  <this user's id>, comment: "المستندات سليمة", at: <timestamp> }]`. Since
  this chain has only 1 step, one approval is final — confirm there is no
  second-step handoff expected here (contrast with a 2-step chain, PLT-APR-09).

- **PLT-APR-05** — Non-admin reject — happy path, real rejection this time.
  **Pre**: A fresh pending request against a 1-step chain requiring this
  user's role (create one: submit a new `SALES_INVOICE_CONFIRM` request via
  the seed's own pattern, or reuse `APR-DEMO-1` if PLT-APR-04 wasn't run
  against it).
  **Steps**: Type a rejection reason in the row's ملاحظة field, e.g. "تجاوز
  الحد الائتماني"; click "رفض".
  **Assert**: Row disappears from pending; response shows `status:
  "rejected"`, `decisions: [{ kind: "reject", actorId: <this user's id>,
  comment: "تجاوز الحد الائتماني", ... }]` — a REAL rejection this time,
  contrasting directly with PLT-APR-03's admin-forced approval on the
  identical button.

- **PLT-APR-06** — Reject's consequence: **the underlying document does not
  post — but only provably so for a request that's actually tied to one.**
  **Pre / important scope note**: `APR-DEMO-1`/`2`/`3` are synthetic
  (`entityLabel`-only) requests created by direct `POST /workflow/requests`
  calls during seeding — they were never produced by a real sales/purchase
  invoice's confirm action, and deciding them has no effect on any real
  document (there is no linked invoice to check). To test "a rejected
  document must not post" against a REAL document, see **PLT-APR-10** below —
  read it before assuming this scenario alone proves the consequence.
  **Steps**: With `APR-DEMO-3` (seeded, already `status: "rejected"`, decided
  by the synthetic `USER-SUPERVISOR-1` with comment "تم الرفض: تجاوز الفاتورة
  الحد الائتماني المسموح للعميل") — confirm it does NOT appear in the pending
  inbox for any actor, admin or otherwise (a rejected request is terminal,
  never re-enters the queue).
  **Assert**: `APR-DEMO-3` is absent from `/workflow/requests/pending`
  regardless of who's signed in; there is no UI screen that lists it as
  "rejected" anywhere either (see PLT-APR-12's gap note) — its only visible
  trace is that it no longer appears pending.

- **PLT-APR-07** — Request-modification's consequence — status transition
  confirmed, but with no UI path forward.
  **Pre**: `SUPERVISOR`-role user (PLT-CALLOUT), a fresh pending request
  against their role.
  **Steps**: Type a note, e.g. "أضف تفاصيل الشحن"; click "طلب تعديل".
  **Assert**: Row disappears from pending; response shows `status:
  "modification_requested"`, decision kind `request_modification` recorded.
  **Then check the gap**: there is no "طلباتي" (my requests) screen, no
  resubmit button, and no hook anywhere in `apps/web/src` wired to `GET
  /workflow/requests/mine` (`useSubmitApproval` exists in `data/hooks.ts` but
  is never imported by any screen) — despite `resubmit()` existing and being
  fully implemented in `packages/domain/src/workflow/gate.ts`. **A request
  that comes back "modification_requested" is, from this build's UI, a dead
  end**: the submitter has no way to see it, edit it, or resubmit it through
  the product. This is the task brief's "returns it editable to its
  submitter" behavior — confirmed NOT IMPLEMENTED on the UI side; the domain
  logic exists, nothing surfaces it.

- **PLT-APR-08** — Wrong approver — 403, cannot decide someone else's step.
  **Pre**: A second custom-role user whose role is NOT the step's required
  role (e.g. a `SALES_REP`-coded user, while the pending request needs
  `SUPERVISOR`).
  **Steps**: Sign in as this mismatched user; open الموافقات.
  **Assert**: The request is absent from THIS user's pending list entirely
  (`listPendingForRoles` filters by role match — it was never fetched to
  begin with, so there's no row to even attempt a decision on). If attempted
  directly via API (`POST /workflow/requests/:id/decide` with the wrong
  role), the server responds 409 `WRONG_APPROVER` from `decide()`'s
  `if (!step || !input.actorRoles.includes(step.role))` guard — worth
  confirming this maps to a sensible UI-level error if ever surfaced, though
  in practice the UI's own pending-list filtering prevents the click from
  ever being possible in the first place.

- **PLT-APR-09** — Multi-step chain — approving step 1 hands off to step 2's
  role, not to the same approver again.
  **Pre**: PLT-WFC-09's 2-step `SALES_INVOICE_CONFIRM` chain (step 1 =
  SUPERVISOR, step 2 = a second custom role); a fresh request submitted
  against it.
  **Steps**: As the SUPERVISOR-role user, approve step 1.
  **Assert**: The request does NOT disappear from ALL inboxes — it disappears
  from the SUPERVISOR user's pending list but becomes visible in the step-2
  role holder's pending list instead, now showing "الخطوة الحالية: 2 / 2".
  Sign in as the step-2 user and approve; only THEN does the request reach
  `status: "approved"` and vanish from every inbox. Confirms sequential
  (not parallel) approval — step 2 was never visible before step 1 resolved.

- **PLT-APR-10 [the bigger trap]** — A real gated document's "pending" state
  never reaches this inbox at all.
  **Pre**: `SALES_INVOICE_CONFIRM` workflow config active (seeded). Signed in
  as a non-admin user (any real custom-role user, e.g. the SUPERVISOR-role
  user themselves, or better, a THIRD user with no workflow permissions at
  all, to mirror an ordinary sales rep submitting).
  **Steps**: Create a sales invoice; click "تأكيد" (confirm) as this
  non-admin user.
  **Assert**: The invoice's own status becomes `"pending"` (بانتظار الموافقة)
  — `SalesInvoiceService.confirm`'s gate branch holds it locally
  (`this.deps.repo.update(held)`), matching the reference's expected
  behavior. **Then check the inbox**: it does NOT contain this invoice.
  `createDocumentWorkflowGate`'s `evaluate()` (used by every document type
  including sales invoices) calls the PURE `startApproval()` function
  directly and never persists anything to the `ApprovalRequestRepository`
  that `/workflow/requests/pending` reads from — confirmed by grepping the
  whole backend for any subscriber to the `DOCUMENT_SUBMITTED` event or any
  call to `submitApproval`/the repository from the document-confirm code
  path; there is none. **A document held pending by a real confirm action is
  invisible to this inbox and has no path to resolution anywhere in the UI**
  — no approve button on the document itself, no matching inbox row, no
  resubmit. It simply sits at status "pending" forever. This is a materially
  different (and more serious) finding than PLT-APR-01/02's admin-bypass
  trap: even a correctly-configured, correctly-non-admin submission produces
  a stuck document, not a working approval flow. The task brief's "a rejected
  document must not post" is technically true here (a stuck-pending document
  never posts either), but not for the reason intended, and there is no way
  to ever un-stick it through this build's UI. Recommend filing this as its
  own tracked defect (candidate D7) rather than folding it into an existing
  D-number — it touches sales invoices, purchase invoices, and every other
  document type wired through `DocumentService`/`SalesInvoiceService`'s
  identical gate pattern, not just one module.

- **PLT-APR-11** — Comment field has an accessible name (regression guard for
  `ROADMAP.md` §5 F6).
  **Steps**: Inspect the ملاحظة input's accessible name via devtools/a11y
  tree on any pending row.
  **Assert**: `aria-label="ملاحظة على الطلب <entity label or id>"` — present
  per-row, matching F6's fix ("the approvals note field had no accessible
  name — found the first time the inbox had a row to test"). If this
  regresses, it's exactly the class of defect F6 already fixed once.

- **PLT-APR-12 [NOT IMPLEMENTED]** — No visibility into decided (approved/
  rejected/modification-requested) requests anywhere in the UI.
  `GET /workflow/requests` (all) and `GET /workflow/requests/mine` both exist
  server-side and are fully gated/working, but neither has a corresponding
  `useQuery` hook or screen in `apps/web/src`. Once a request leaves the
  pending state — approved, rejected, or bounced for modification — its only
  remaining trace is the raw API response from the decide call itself. There
  is no "سجل الموافقات" / decision-history screen to browse later.

---

### 18 — Audit log (`الإعدادات ← سجل المراجعة`)

`AuditLogScreen.tsx`. Read-only over an append-only store (BEFORE UPDATE/DELETE
triggers `RAISE(ABORT)` at the storage layer per the component's own doc
comment) — there is no edit or delete affordance anywhere on this screen, by
design.

- **PLT-AUD-01** — Stats and stream chips.
  **Pre**: Populated audit trail (ordinary seed activity plus §9/§10's 7
  platform-admin actions, per §19).
  **Assert**: 3 stat cards — إجمالي حسب الفلاتر الحالية (respects active
  filters), أحداث الأمان, العمليات الحساسة (both independent of filters —
  they query `{ stream: "security", limit: 1 }` / `{ stream: "sensitive",
  limit: 1 }` purely for their `.total`, ignoring every other active filter
  deliberately, per the component's own comment); 3 status chips الكل/أحداث
  الأمان/العمليات الحساسة with matching counts.

- **PLT-AUD-02** — Row click opens a detail side panel.
  **Steps**: Click any row.
  **Assert**: `SidePanel` opens titled "تفاصيل الحدث" showing the full 8-field
  breakdown (timestamp, stream, module, entity type, action, actor, branch,
  severity) plus a "تفاصيل إضافية" block — either "لا توجد تفاصيل إضافية" or
  a pretty-printed JSON `<pre>` block of `selected.details`. Confirm the panel
  is read-only — no edit/delete action anywhere inside it.

- **PLT-AUD-03** — Filter: module (free text).
  **Steps**: Type "webhooks" into الوحدة filter.
  **Assert**: Only rows whose `module === "webhooks"` remain — from §10's
  seeded webhook create/patch actions (`recordSensitiveEvent({ module:
  "webhooks", ... })` in `webhooks-routes.ts`).

- **PLT-AUD-04** — Filter: action (free text).
  **Steps**: Type "REGISTERED".
  **Assert**: Matches the webhook-registration sensitive events specifically
  (action `"REGISTERED"` per `webhooks-routes.ts`'s `recordSensitiveEvent`
  call on `POST /webhooks`).

- **PLT-AUD-05** — Filter: entity type, severity, actor (search box).
  **Steps**: Set الكيان = "WEBHOOK"; separately test الخطورة dropdown across
  all 4 levels (حرج/خطأ/تحذير/معلومة); separately search the actor box for
  `USER-ADMIN`.
  **Assert**: Each filters independently and all combine via AND (confirm by
  stacking 2+ filters at once and checking the row count only narrows,
  matching the query-param assembly in `AuditLogScreen.tsx`'s `useAuditLog`
  call).

- **PLT-AUD-06** — Filter: date range (`من تاريخ` / `إلى تاريخ`).
  **Steps**: Set a `from`/`to` window that excludes today's seed-time events.
  **Assert**: Table narrows to zero rows / the correct subset; "مسح الفلاتر"
  resets every filter (including date range) back to `BLANK_FILTERS` in one
  click and resets to page 1.

- **PLT-AUD-07** — Filter: branch — the "all branches" requirement, proven
  against real data.
  **Pre**: At least one audit event with `branchId: null` (an event recorded
  by a code path that predates or doesn't carry branch context — check
  whether any seeded event qualifies; if none does by default, this can be
  produced by triggering an action through a route that never resolves
  `auditBranchFromScope`, e.g. certain platform-admin actions where
  `branchOf(c)` returns `null` because the actor's scope wasn't branch-scoped
  at the time) alongside at least one event with a real `branchId` set.
  **Steps**: Set الفرع filter to a SPECIFIC branch (not "كل الفروع").
  **Assert**: The `branchId: null` event(s) do NOT appear under this specific-
  branch filter — only events actually stamped with that branch's id show.
  **Steps (cont.)**: Reset الفرع filter back to "كل الفروع".
  **Assert**: The `branchId: null` event(s) reappear, rendering "—" in the
  table's الفرع column and "لم يُسجَّل فرع لهذا الحدث" in the detail panel —
  confirming events recorded before/without branch tracking are visible ONLY
  under the unfiltered "all branches" state, never under any specific-branch
  filter, exactly as the task brief specifies.

- **PLT-AUD-08** — Pagination.
  **Pre**: More than 25 events matching the active filter (`PAGE_SIZE = 25`).
  **Steps**: Clear all filters to maximize row count; page forward.
  **Assert**: `pageSummary` reads "عرض 25 من N حدث" on page 1; page-count and
  navigation controls reflect `Math.ceil(total / 25)`; changing any filter
  resets `page` back to 1 (`updateFilters` always calls `setPage(1)`).

- **PLT-AUD-09** — Severity taxonomy — all 4 levels render distinct tones.
  **Assert**: CRITICAL and ERROR both render danger-tone pills, WARNING
  warning-tone, INFO neutral-tone (`SEVERITY_TONE` mapping) — confirm at
  least one real CRITICAL row exists (an `ACCOUNT_LOCKED` event from repeated
  failed logins, if reproducible, or any other seeded CRITICAL-severity row)
  to actually see the danger tone rendered, not just assume the mapping from
  source.

- **PLT-AUD-10 [RBAC]** — `audit.logs.view` gate.
  **Pre**: A non-admin user without `audit.logs.view`.
  **Assert**: Same general pattern as PLT-ROL-15 — sidebar item visible and
  clickable (no client-side nav gating), screen mounts, `useAuditLog()` fails
  with 403 from `audit-routes.ts`'s `gate("audit.logs.view")`, and the danger-
  card-with-retry pattern renders instead of the table.

---

### 19 — Profile (`الإعدادات ← الملف الشخصي`)

`ProfilePage.tsx`. Self-service — every action scoped to the caller's own id
server-side, no permission gate, no user picker. This build adds a PIN
quick-login feature the reference never documented at all.

- **PLT-PRO-01** — Header summary fields.
  **Pre**: Signed in as `USER-ADMIN`.
  **Assert**: Title = full name, subtitle = email; status pill "مدير الشركة"
  success-tone (`isCompanyAdmin: true`); summary strip shows الرقم السري
  (مُفعّل/غير مُفعّل depending on whether a PIN is set — seed sets
  `SEED_ADMIN_PIN`, so expect "مُفعّل"), آخر تسجيل دخول, تاريخ الإنشاء.
  **Gap vs. reference**: there is no "الدور" (role) field anywhere on this
  screen — the reference showed a disabled/read-only role textbox; this
  build's header/summary/Info-tab has nothing equivalent, even though
  "مدير الشركة" is visible via the status pill as a proxy.

- **PLT-PRO-02** — Info tab: email is EDITABLE here — a real difference from
  the reference.
  **Steps**: Change البريد الإلكتروني to a new value; click "حفظ التغييرات".
  **Assert**: Unlike the reference (where email was a disabled/read-only
  textbox on this exact tab), this build's email field is a live, editable
  `TextField` with no `disabled` prop — the save succeeds and the header
  subtitle updates to the new email immediately. Confirm this is intentional
  self-service behavior and not an oversight, since changing your own login
  email with no re-verification step is a meaningfully different security
  posture than the reference's read-only field.

- **PLT-PRO-03** — Info tab: full name and phone.
  **Steps**: Edit الاسم الكامل and رقم الهاتف (optional, placeholder
  "اختياري"); save.
  **Assert**: Success message "تم حفظ بيانات الحساب."; header title updates
  to the new name.

- **PLT-PRO-04** — Info tab: save failure surfaces inline.
  **Steps**: Trigger a server-side rejection (e.g. an email format the
  backend rejects).
  **Assert**: Danger-tone inline message next to the save button with the
  server's error text (or a generic "تعذر حفظ البيانات." fallback) — no full
  page error, the form stays populated.

- **PLT-PRO-05** — Security tab: change password — happy path.
  **Steps**: Fill كلمة المرور الحالية correctly; كلمة المرور الجديدة (≥8
  chars per the hint); تأكيد كلمة المرور الجديدة matching; submit.
  **Assert**: Success message "تم تغيير كلمة المرور."; all 3 fields clear
  immediately after success (not left populated).

- **PLT-PRO-06** — Security tab: change password — mismatch guard.
  **Steps**: Enter a new password and a DIFFERENT confirmation string; submit.
  **Assert**: Client-side guard fires before any request: "كلمة المرور
  الجديدة وتأكيدها غير متطابقين." — no network call.

- **PLT-PRO-07** — Security tab: change password — wrong current password.
  **Steps**: Enter an incorrect كلمة المرور الحالية; valid new/confirm pair;
  submit.
  **Assert**: Server rejects; error message renders (server's message or the
  "تعذر تغيير كلمة المرور." fallback); fields are NOT cleared on failure
  (only cleared in the success branch) — confirm the user doesn't have to
  retype everything after a mistyped current password.

- **PLT-PRO-08** — Security tab: submit button disabled until both required
  fields are non-empty.
  **Assert**: "تغيير كلمة المرور" stays disabled while either كلمة المرور
  الحالية or كلمة المرور الجديدة is empty (`!currentPassword || !newPassword`
  — confirm/tأكيد is NOT part of this disabled-check, only checked at submit
  time per PLT-PRO-06).

- **PLT-PRO-09** — Security tab: set a PIN.
  **Steps**: In the الرقم السري (PIN) card, enter كلمة المرور الحالية
  (required to authorize the change) and a new 4–6 digit PIN; save.
  **Assert**: Success message "تم تغيير الرقم السري."; header's الرقم السري
  summary field flips to "مُفعّل" if it wasn't already.

- **PLT-PRO-10** — Security tab: clear the PIN by submitting blank.
  **Steps**: Enter كلمة المرور الحالية correctly; leave الرقم السري الجديد
  EMPTY; save.
  **Assert**: Success message differs on purpose: "تم إلغاء الرقم السري."
  (not the "changed" message) — `newPin.trim() === ""` sent as `null`; header
  summary flips back to "غير مُفعّل".

- **PLT-PRO-11** — Security tab: PIN save button requires only the current
  password, not the PIN field itself.
  **Assert**: "حفظ" under the PIN card is disabled only on
  `!pinCurrentPassword` — an empty new-PIN field does NOT disable it (that's
  the intentional "clear PIN" path from PLT-PRO-10, not a validation
  failure).

- **PLT-PRO-12** — Activity tab: 7 seeded entries, precisely accounted for.
  **Pre**: Demo seed's `PLATFORM_ADMIN` (`USER-ADMIN`) actions in
  `demo-seed/platform.ts`: 3× `POST /api-keys` (create), 1×
  `POST /api-keys/:id/revoke`, 2× `POST /webhooks` (create), 1×
  `PATCH /webhooks/:id` (deactivate) — exactly 7 sensitive-audit-eligible
  actions attributed to this exact account (the seed's own comment explains
  WHY: these writes are deliberately run as `USER-ADMIN` rather than a
  synthetic seeder identity specifically so this tab has real content).
  **Steps**: Open النشاط tab.
  **Assert**: 7 rows, each showing an event label, module, severity pill, and
  timestamp — table columns الحدث/الوحدة/الخطورة/التاريخ, newest first (the
  `/profile/activity` endpoint sorts descending and filters `audit.query(...)`
  events down to `event.actor === callerId`). If the actual count differs
  from 7 when reproduced, that's a real discrepancy worth re-checking against
  the exact seed script version running — don't just trust this document's
  math over what the live screen shows.

- **PLT-PRO-13** — Activity tab: empty state for an account with no
  qualifying actions.
  **Pre**: A freshly-created ordinary user (PLT-USR-CREATE) who has never
  performed a security- or sensitive-audit-eligible action.
  **Steps**: Sign in as that user; open their own الملف الشخصي ← النشاط.
  **Assert**: "لا يوجد نشاط مسجّل على حسابك بعد." — confirms activity truly
  is scoped to actions THIS caller performed (`event.actor === callerId`),
  not a tenant-wide feed.

---

### Summary — every `[NOT IMPLEMENTED]` and structural gap in this pass

| Area | Gap | Scenario |
|---|---|---|
| General settings | No email/SMTP tab, no email-template HTML editor, no send-test-email | PLT-24 (section) |
| General settings | No standalone POS & loyalty / POS payment-methods tabs (folded/absent) | §4 intro |
| General settings | No company-logo upload | PLT-17 |
| General settings | No aging-based write-down toggle, no auto-batch-number toggle | PLT-20 |
| General settings | No multi-currency platform-admin-managed badge/explainer | PLT-24 |
| Branches | No edit form, no deactivate action | PLT-BRN-14 |
| Warehouses | No edit/deactivate action, no branch filter | PLT-WH-06 |
| Users | No role / branch / last-login filter panel | PLT-USR-09 |
| Users | No self-deactivation guard confirmed | PLT-USR-06 |
| API Keys | No rate-limit field, no Connected Apps/OAuth table | PLT-API-08 |
| Webhooks | No description field | PLT-WHK-12 |
| Webhooks | Retries can outlive shutdown (known, D6) | PLT-WHK-11 |
| Notification rules | No edit-existing-rule action | PLT-NOT-09 |
| Notification rules | No event/priority filter dropdowns | PLT-NOT-10 |
| Barcode config | No EAN-13 check-digit toggle, no max-value sanity cap | PLT-BAR-09 |
| Print templates | Preview only ever renders one fixed sample invoice; no doc-type preview selector | PLT-PRT-02 |
| Print templates | No retry on load failure | PLT-PRT-14 |
| Data migration | Commit is all-or-nothing per file, not per row (contradicts a literal reading of "commit the valid rows") | callout, PLT-MIG-04/06/12 |
| Data migration | `employees.xlsx`/`items.xlsx` fixtures reject their own "valid" rows | callout, PLT-MIG-06/12 |
| Data migration | `items.xlsx`'s non-numeric-price test is masked by the unit-code bug | PLT-MIG-12/13 |
| Data migration | Historical `partyId` is never validated against a real customer/supplier | PLT-MIG-18 |
| Data migration | The 4 historical fixtures are identical placeholders, no invalid rows | PLT-MIG-17 |
| Workflow config | (none found — full CRUD, exceeds the reference) | — |
| Approvals inbox | Decide-side admin bypass ignores reject/request-modification entirely | PLT-APR-03 |
| Approvals inbox | **Real document confirms never create an inbox-visible request at all** — the gate and the inbox are disconnected for every document type | PLT-APR-10 |
| Approvals inbox | `modification_requested` has no resubmit UI anywhere (`useSubmitApproval` unused) | PLT-APR-07 |
| Approvals inbox | No decision-history / "my requests" screen (`GET /workflow/requests`, `/mine` unused) | PLT-APR-12 |
| Approvals inbox | Decisions are never written to the Audit Log (`workflow-routes.ts` calls no `recordSensitiveEvent`) | PLT-APR-04/05 notes |
| Audit log | (none found — matches/exceeds the reference) | — |
| Profile | No role field shown | PLT-PRO-01 |
| Profile | Email is editable (differs from reference's read-only field — flagged, not necessarily a defect) | PLT-PRO-02 |
| Global chrome | Language switcher is AR/EN only, no German/3rd locale | §1 intro |
| Global chrome | No URL routing at all — reload always returns to dashboard | intro |

**Recommend for `ROADMAP.md` §5**: PLT-APR-10 (real gated documents never
reach the approvals inbox, across every document type) is the single most
severe finding in this pass and is not yet tracked as D1–D6. Everything else
above is either a smaller UI gap or a fixture-data defect in
`test-fixtures/data-migration/`, not a product defect.

---

# 12. Shell, dashboard and reports


Sources: `docs/archive/catalog/09-settings-dashboard-ux.md` (dashboard/global-UX half), `docs/archive/catalog/08-reports.md`, and the running implementation — `packages/ui/src/shell/*`, `packages/ui/src/primitives/{ReportRunner,SidePanel,beams,Kbd}.tsx`, `apps/web/src/dashboard/*`, `apps/web/src/screens/hubs/*`, `apps/web/src/screens/reports/*`, `packages/domain/src/reports/*`, `apps/web/src/keyboard/*`, `apps/web/src/i18n/*`, `apps/web/src/nav-config.ts`, `apps/web/src/App.tsx`.

### How this build actually works (read before running anything below)

- **No URL routing.** `apps/web` is a single page; `App.tsx` holds `activeScreen` in React state and swaps components. There are no routes, no deep links, no browser back/forward, and a page **reload always lands on the dashboard** (`activeScreen` resets to `"dashboard"`) — only the *session*, the *theme*, the *locale*, the *rail-collapsed flag* and the *branch/warehouse scope selection* persist across a reload (each via its own `localStorage` key, noted per scenario). Where the catalog says "Route: `/reports/...`" that is the reference product's URL; this build reaches the same screen by clicking the sidebar item — there is no address bar to type into.
- **Bilingual scope**: the shell (sidebar, topbar, command bar, dashboard, `ReportRunner`) is fully bilingual through `apps/web/src/i18n` (`ar`/`en`, no third locale despite the catalog's 3-flag language menu — see SHL-18). Every hub screen, every domain screen (Items, Suppliers, Journals, …) and every report's own title/columns are **hardcoded Arabic strings** — switching to English does not translate them. This is expected, not a bug; scenarios below say so at the point it would otherwise look like a defect.
- **Report parameter surface is narrower than the catalog documents.** The catalog was captured against a different, richer reference build. In this build every report's parameters come from one shared `ReportRunnerParamField` contract (`date`, `dateRange`, `select`, `text`) rendered by `<ReportRunner>` — there are no quick period-preset chips (هذا الشهر / آخر 3 أشهر …), and most of the category/branch/channel dropdowns and named-entity search boxes the catalog describes do not exist; several reports substitute a **plain text box asking for a raw internal ID** (`warehouseId`, `itemId`) where the catalog shows a picker. Each report's scenario below states the params as they actually render, verified against `packages/domain/src/reports/*.ts`, not the catalog.
- **Default date bounds are a hardcoded constant, not "today."** `SalesReportsScreens.tsx`, `PurchasesReportsScreens.tsx`, `InventoryReportsScreens.tsx`, `AgingReportsScreens.tsx`, `InstallmentsReportsScreens.tsx`, `FieldSalesReportsScreens.tsx` and `FinancialReportsScreen.tsx` all default their date range to the literal string `2026-08-22` (month-start `2026-08-01`). Only the **standalone** `TrialBalanceReportScreen` (`trial-balance-report` nav item) computes `new Date().toISOString().slice(0,10)` live. Every scenario that opens a report for the first time should note the as-loaded date is `2026-08-22`/`2026-08-01`, not the actual current date — on any day after 2026-08-22 the default window silently excludes the most recent transactions until the user manually extends it.
- **Reference defects that will fire** — noted once, not re-filed (`ROADMAP.md` §5):
  - **D1** (`amountPaid` never updates on a confirmed collection voucher) inflates every figure this build derives from `SalesInvoiceDTO.remainingBalance` client-side: the dashboard's needs-attention "overdue"/"due soon" amounts (`useAttentionData` in `dashboard-hooks.ts`), and the Sales hub's "مبالغ مستحقة من العملاء" tile. It does **not** affect `GET /dashboard/summary`'s own `gl.receivables`, which is GL-sourced server-side.
  - **D4** (`occurredAt` is `now()` on confirm, not the document date) is the cause of spurious rows in **RPT-16** (Inventory Valuation Drift).

---

### Shell — Sidebar & navigation

#### SHL-01 — Every nav entry reaches a screen with a matching heading
**Pre**: Logged in, rail expanded, no group collapsed beyond the shipped defaults (`settings` and `system` start collapsed).
**Steps**: Click the top item, then every item in every group, one at a time (117 destinations below: 1 top item + 17 groups). For each, read the destination screen's `<h1>`.
**Assert**: Every click renders a screen with an `<h1>` whose text equals the clicked item's label. No click is a no-op and none throws to a blank page.

| Group | Items (label → expected `<h1>`) |
|---|---|
| *(top)* | لوحة التحكم |
| سير العمل | الموافقات |
| المبيعات | نظرة عامة، العملاء، عروض الأسعار، فواتير المبيعات، مرتجعات المبيعات، قوائم الأسعار، العروض |
| المشتريات | نظرة عامة، الموردون، طلبات عروض الأسعار، أوامر الشراء، استلام البضائع، فواتير المشتريات، مرتجعات المشتريات، التكاليف الإضافية |
| المخزون | نظرة عامة، الأصناف، أرصدة المخزون، تحويلات المخزون، تسويات المخزون، الجرد الفعلي، منتجات قابلة للتهيئة، قوالب المنتجات، المواصفات، طباعة الملصقات، هبوط قيمة المخزون |
| التصنيع | نظرة عامة، لوحة الإنتاج، أوامر التصنيع، قوائم المواد، التصنيع المخصص |
| المحاسبة | نظرة عامة، دليل الحسابات، مراكز التكلفة، أرباح مراكز التكلفة، القيود المحاسبية، الفترات المالية، الضرائب، أسعار الصرف، إعادة تقييم العملات الأجنبية، مطابقة الأرصدة، الفاتورة الإلكترونية، ميزان المراجعة، التقارير المالية |
| الخزينة | نظرة عامة، حسابات الخزينة، السندات النقدية، تسوية كشوف البنك |
| الأوراق المالية | سجل الشيكات |
| إدارة علاقات العملاء | نظرة عامة، العملاء المحتملون، الفرص، خط المبيعات، مراحل خط المبيعات، الأنشطة |
| الموارد البشرية | لوحة الموارد البشرية، الموظفون، الأقسام، المسميات الوظيفية، العقود، الإجازات الرسمية، الحضور والانصراف، الرواتب، سلف الموظفين، طلبات الإجازات، أرصدة الإجازات، استحقاقات الإجازات، سياسات الإجازات، إجازاتي |
| المشاريع | المشاريع والمقاولات |
| الأصول الثابتة | نظرة عامة، سجل الأصول، الإهلاك، تصنيفات الأصول |
| المبيعات الميدانية | رحلات المندوبين |
| الأقساط | خطط الأقساط، متابعة التحصيل |
| التقارير (22 items) | المبيعات حسب الفترة، المبيعات حسب الصنف، المبيعات حسب العميل، المبيعات حسب المندوب، أفضل المنتجات، المشتريات حسب الفترة، المشتريات حسب المورد، المشتريات حسب الصنف، مستويات المخزون، حركة المخزون، سجل المخزون، تقييم المخزون، أعمار المخزون، أصناف قاربت على الانتهاء، أصناف بطيئة الحركة، انحراف تقييم المخزون، أعمار ديون العملاء، أعمار ديون الموردين، نظرة عامة على الأقساط، الأقساط المتأخرة، مبيعات المندوبين، التصنيع أم الشراء |
| الإعدادات *(starts collapsed)* | عام، الفروع، المستودعات، قوالب الطباعة، قواعد الإشعارات، نقل البيانات، إعدادات الموافقات، تسلسلات الترقيم، إعدادات الباركود، الملف الشخصي، مفاتيح API، الويب هوك، سجل المراجعة، المستخدمون، الأدوار والصلاحيات |
| النظام *(starts collapsed)* | حالة النظام |

**Note**: this table is 113 destinations (1 + 112 group items), close to but not exactly the "~101" figure — count them from `apps/web/src/nav-config.ts` (`buildNavGroups`) if the nav tree changes; this table is the ground truth at time of writing, not the catalog's older count. المستخدمون/الأدوار are not `ROUTABLE_SCREENS` entries (they're a 3-state machine alongside it — "users"/"roles"/"role-editor") but are still reachable and headed exactly like every other item.

#### SHL-02 — Group collapse/expand
**Pre**: Rail expanded.
**Steps**: 1) Click the "المبيعات" group header. 2) Click it again. 3) Reload the page.
**Assert**: 1) The group's items disappear, the chevron rotates, `aria-expanded="false"`. 2) Items reappear, `aria-expanded="true"`. 3) The group is back to its *default* collapsed state (expanded, since "sales" has no `defaultCollapsed`) — **not** whatever state it was left in before reload. Group collapse state is plain `useState` (`Sidebar.tsx`), never persisted; only the rail-wide collapse (SHL-03) survives a reload.

#### SHL-03 — Rail collapse to icon-only, persisted
**Pre**: Rail expanded (default).
**Steps**: 1) Click the rail-toggle button (top of the sidebar, next to the brand mark). 2) Observe every rail section. 3) Reload the page.
**Assert**: 1) The rail animates from 264px to 76px (`transition-[width]`); labels disappear from nav rows, the group headers, the tenant chip, the scope switchers and the user footer — only icons/monogram glyphs remain, each carrying a `title` tooltip with the full label. 2) The brand name, tenant name and every nav-item label are gone from the DOM (not just visually hidden — `showLabel={expanded}` conditionally omits them). 3) After reload the rail is **still collapsed** — `localStorage["mezan.sidebarCollapsed"] === "1"` persists it (`Sidebar.tsx`), independent of the screen-reset-to-dashboard behaviour noted above.

#### SHL-04 — Active indicator follows the current screen
**Pre**: On the dashboard.
**Steps**: Navigate to "فواتير المبيعات", then to "التقارير" → "المبيعات حسب الفترة".
**Assert**: At every step exactly one nav row carries `aria-current="page"`, a highlighted background (`bg-chrome-active`) and a 3px brass bar (`bg-chrome-accent`) on its leading edge — and it is always the row just clicked, never a stale one. While on "الأدوار والصلاحيات" → "role editor" (a screen with no nav entry of its own), the "الأدوار والصلاحيات" row stays the active one (`App.tsx`: `activeNavKey={activeScreen === "role-editor" ? "roles" : activeScreen}`).

---

### Shell — Scope switchers (branch / warehouse)

These sit at the **top of the sidebar rail** (moved off the topbar in this build), and are real `<select>`s wired to `apps/web/src/data/hub-hooks.ts` `useScopeSelector` → `ApiContext`'s `scopeSelection` → `authHeaders()` (`apps/web/src/data/session.ts`), which stamps `x-branch-scope` / `x-warehouse-scope` on **every** subsequent API request. This is not cosmetic — verify it as such.

#### SHL-05 — Branch scope narrows real data, and persists
**Pre**: A tenant seeded with **2+ active branches** and data that differs between them (e.g. sales invoices posted against different branches). Note the current row count/figure on a branch-scoped screen (e.g. "فواتير المبيعات").
**Steps**: 1) Open the branch selector at the top of the rail, pick a specific branch (not "كل الفروع"). 2) Re-read the same screen's row count/figure. 3) Open a second terminal and `curl` the same list endpoint twice — once with `x-branch-scope: *` and once with `x-branch-scope: <chosen-branch-id>` (headers from `authHeaders`) — and diff the JSON. 4) Reload the page.
**Assert**: 2) The on-screen count/figure **changes** to a value that matches the `curl`ed branch-scoped response in (3) — not merely a relabelled chip showing the branch name while the underlying rows stay identical. 3) The two `curl` responses genuinely differ in row count or total. 4) After reload the branch selector still shows the previously chosen branch (`localStorage["mezan.scopeSelection"]`), and the screen still shows the narrowed figure — the selection is not silently reset to "all" on reload. If this scenario ever finds the on-screen number identical before/after step 1 while the `curl` diff in step 3 is non-empty, that is the switcher regressing to "relabel only" — file it.

#### SHL-06 — Warehouse scope narrows real data, cascades from branch, persists
**Pre**: 2+ active warehouses under different branches.
**Steps**: 1) With no branch chosen, open the warehouse selector — note the full option list. 2) Pick a branch. 3) Re-open the warehouse selector. 4) Pick a specific warehouse and open an inventory screen (e.g. "أرصدة المخزون" or the "مستويات المخزون" report). 5) Reload.
**Assert**: 3) The warehouse option list is now filtered to only that branch's warehouses (`useScopeSelector`: `w.branchId === scopeSelection.branchId`) — a strictly shorter or equal list than (1). 4) The inventory screen's rows/values change to the warehouse-scoped subset (cross-check via `curl` with `x-warehouse-scope` as in SHL-05). 5) Both the branch and warehouse choice survive reload. Also verify: switching the branch to one that does **not** contain the currently-selected warehouse clears the warehouse selection back to "كل المستودعات" (`setBranch`'s `stillValid` check) rather than silently sending a stale, now-invalid warehouse id.

---

### Shell — Command bar

Lives inline in the topbar (always visible — there is no longer a modal-only palette; `Topbar.tsx`'s `onOpenCommandPalette` prop is accepted for source compatibility only).

#### SHL-07 — ⌘K / Ctrl+K focuses the command bar from anywhere
**Pre**: Any screen, focus somewhere in the page body (not inside the command bar).
**Steps**: Press `Ctrl+K` (or `⌘K` on macOS).
**Assert**: The command bar's `<input role="combobox">` receives focus, its text is selected, and the results panel opens (`aria-expanded="true"`) even with an empty query, showing the grouped item list.

#### SHL-08 — Filtering and keyboard navigation
**Pre**: Command bar open (via SHL-07 or a click).
**Steps**: 1) Type "قيود". 2) Press `ArrowDown` twice, `ArrowUp` once. 3) Press `Enter`. 4) Reopen and press `Escape`.
**Assert**: 1) The list narrows live to items whose label contains the query (case-insensitive) — "القيود المحاسبية" survives, unrelated items don't. 2) `aria-activedescendant` and the highlighted row move accordingly, clamped at the list bounds (never past the last item, never below 0). 3) The highlighted item's `onSelect` fires and the panel closes. 4) `Escape` closes the results panel without clearing the query field itself (`setOpen(false)` only).

#### SHL-09 — Routes to screens and create-actions (narrow set — verify, don't over-assume)
**Pre**: Command bar open.
**Steps**: Run each of the 5 real entries: "فاتورة مبيعات جديدة", "سند نقدي جديد", "دليل الحسابات", "القيود المحاسبية", and the shortcuts entry (hint `?`).
**Assert**: The first two navigate to "فواتير المبيعات"/"السندات النقدية" **with their create panel already open** (`navigate(screen, "create")`); the next two navigate to "دليل الحسابات"/"القيود المحاسبية" plainly; the last opens the `?` shortcuts overlay (SHL-10) instead of navigating. **`[NOT IMPLEMENTED]`**: the catalog's command palette is "the most complete map of the app's page inventory" (~80 pages, including per-module overview dashboards, an inbox, audit logs). This build's `commandItemSpecs` (`nav-config.ts`) hard-codes exactly these 5 entries — typing the name of any other screen (e.g. "الموردون", "المشتريات") returns **no results**, not a fuzzy-matched page link. Do not expect the command bar to reach arbitrary screens; only the sidebar does.

---

### Shell — Keyboard shortcuts

`apps/web/src/keyboard/useGlobalShortcuts.ts` is the single global `keydown` listener, wired once from `App.tsx`.

#### SHL-10 — `?` opens the shortcut list, Esc closes it
**Pre**: Focus on the page body (not a text field).
**Steps**: 1) Press `?`. 2) Read both columns. 3) Press `Escape`.
**Assert**: 1) The `ShortcutsOverlay` dialog opens (`role="dialog"`, `aria-modal="true"`), focus moves to its close button. 2) The left column lists the fixed global keys — `⌘/Ctrl+K` (or the platform-correct modifier via `modKeyLabel()`), `⌘/Ctrl+N`, `⌘/Ctrl+S`, `/`, `J+K`, `Esc`, `?` — each with the correct label; the right column lists one row **per nav group that has a routable item**, each showing `g` + a single derived letter (see SHL-11) and the group's label. This list is generated from the *live* nav tree (`buildModuleJumps`), so it is guaranteed to be in sync with SHL-01's table — if in doubt, read the letters from here rather than memorising them. 3) `Escape` closes the dialog and all global shortcuts (which are `disabled` while it's open) resume working.

#### SHL-11 — `g` then a letter jumps between modules
**Pre**: Focus on the page body. Open `?` first (SHL-10) to read the current letter for two or three groups, e.g. "لوحة التحكم" and one module hub.
**Steps**: 1) Press `g`, then within one second press the letter shown next to "لوحة التحكم" while on some other screen. 2) From the dashboard, press `g` then wait **over** 1000ms, then press a valid module letter.
**Assert**: 1) The screen navigates to the dashboard (or whichever group's first routable item, typically its hub) — matching exactly what the `?` overlay showed for that letter. 2) Because the chord has a 1-second window (`CHORD_TIMEOUT_MS`) and disarms itself via `setTimeout`, the late letter press does **nothing** — the screen does not navigate (it's treated as a fresh, unchorded `g` immediately followed by an unrelated key). Also verify a doubled `g g` does not navigate — `g` is deliberately excluded as a target letter (`pickLetter`/`firstFreeLetter` both skip `'g'`).

#### SHL-12 — `/` focuses the in-page search, falling back to the command bar
**Pre**: On a screen with its own search/filter input, e.g. "فواتير المبيعات". Focus on the page body.
**Steps**: 1) Press `/`. 2) Navigate to a screen with **no** in-page search box (e.g. "لوحة التحكم" itself, or "التقارير المالية"'s trial balance tab, which has only date/account params — none marked `data-mz-search` or `type=search`/`text` inside `<main>` if the report has zero text params). Press `/` again.
**Assert**: 1) The screen's own search input receives focus and its contents are selected (`findSearchInput` prefers `[data-mz-search]`, then `input[type=search|text]` inside `<main>`). 2) With no in-page candidate, focus lands on the topbar's command-bar input instead (the documented fallback) — never a thrown error, never a silent no-op.

#### SHL-13 — `j`/`k` move the table selection — currently a dead shortcut
**Pre**: Any screen with a `DocumentList`-based table with 2+ rows, e.g. "الموردون".
**Steps**: Click into empty page space (not a field), then press `j`, then `k`, then `Enter`.
**Assert**: `[NOT IMPLEMENTED]` — the keys **do** get intercepted (no character is typed anywhere, `event.preventDefault()` fires) and a `mz:list-nav` `CustomEvent` is dispatched on `window` with `{action: "next"|"prev"|"open"}` (`shortcuts.ts` `emitListNav`), but **nothing in the codebase listens for it** — `packages/ui/src/primitives/DocumentList.tsx` has no `mz:list-nav` handler despite the code comment claiming it does. Assert explicitly: no row gets a visible focus/selection ring after `j`, and `Enter` opens nothing. This is a real, verifiable gap distinct from "works but I didn't test it" — grep the repo for `mz:list-nav` before re-testing after a fix lands.

#### SHL-14 — ⌘N creates on a screen that has a create flow
**Pre**: none.
**Steps**: 1) On "فواتير المبيعات" (one of the six screens wired via `useScreenIntent`: goods-receipts, purchase-invoices, purchase-orders, sales-invoices, sales-quotes, treasury-vouchers), press `⌘N`/`Ctrl+N`. 2) On a screen with no create flow of its own, e.g. "الموردون", press `⌘N`.
**Assert**: 1) The screen's own create panel/side-panel opens directly. 2) `⌘N` instead navigates to "فواتير المبيعات" **with its create panel open** — the documented fallback (`DEFAULT_CREATE_SCREEN = "sales-invoices"`), not a no-op and not an error. Also verify the browser's own "new window/tab" shortcut never fires — `event.preventDefault()` runs before any fallback logic.

#### SHL-15 — ⌘S saves an open form and never shows the browser's Save dialog
**Pre**: A create/edit panel open on any of the six intent-registered screens, with the form focused.
**Steps**: 1) Fill required fields, press `⌘S`/`Ctrl+S`. 2) With no form open anywhere on screen (e.g. plain "لوحة التحكم"), press `⌘S`.
**Assert**: 1) The nearest `<form>` (`findDocumentForm`: the one owning current focus, else the first one inside an open `role="dialog"`, else the first visible form on the page) receives `.requestSubmit()` and the record saves. 2) `event.preventDefault()` still runs **unconditionally** on the mod+S combo even when `findDocumentForm()` returns `null` — the browser's native "Save Page As…" dialog must **never** appear, on any screen, at any time, form or no form. This is the one keyboard rule with zero exceptions; test it on at least three unrelated screens including one with no form at all.

#### SHL-16 — Typing guard: literal text wins over shortcuts
**Pre**: Any text `<input>`, `<textarea>`, `contenteditable`, or `role="textbox"`/`role="combobox"` field with focus — e.g. a customer-name field in a create panel, or the command bar itself.
**Steps**: Type the literal string `gis` into the field, character by character.
**Assert**: All three characters (`g`, `i`, `s`) appear in the field's value, in order, and the app does **not** navigate, does not open the shortcuts overlay, and does not arm a `g`-chord — `isTypingTarget(event.target)` short-circuits the whole handler for bare letters while a text-accepting element has focus (`useGlobalShortcuts.ts`: `if (event.altKey || typing) { if (typing) disarmChord(); return; }`). Also verify from within the same field: `Escape` still works (blurs a `/`-focused search field and clears its marker), and `⌘K`/`⌘N`/`⌘S` still fire even while typing (mod-combos are explicitly allowed regardless of `typing`).

---

### Shell — Theme

#### SHL-17 — Theme toggle, persisted
**Pre**: Default (light) theme, i.e. no `mezan.theme` key or value `"light"`.
**Steps**: 1) Click the theme toggle at the foot of the sidebar rail. 2) Reload. 3) Click it twice more.
**Assert**: 1) `document.documentElement[data-theme]` flips to `"dark"`, every dark-mode token takes effect (surfaces, ink colours), and the icon swaps from sun to moon. 2) After reload the theme is still dark — `localStorage["mezan.theme"] === "dark"` persists it (`useTheme.ts`). 3) Toggling twice more returns to light, then dark again — simple two-state flip (no `"system"` UI is exposed even though `useTheme` supports it programmatically).

---

### Shell — Language / RTL–LTR

#### SHL-18 — Language toggle flips locale and direction live, persisted
**Pre**: Default Arabic/RTL (`localStorage["mezan.locale"]` unset or `"ar"`).
**Steps**: 1) Click the language button in the topbar (single icon button, not a dropdown — shows "EN" while in Arabic). 2) Observe the whole shell. 3) Reload. 4) Click it again to switch back.
**Assert**: 1) `document.documentElement` flips `lang="en"` / `dir="ltr"` **instantly, with no reload** (`I18nProvider`'s `useLayoutEffect`) — the sidebar moves to the left, icons/chevrons mirror, and every shell string translated in `apps/web/src/i18n/catalog.ts` (nav labels, dashboard copy, command-bar placeholder, shortcuts overlay, `ReportRunner`'s own chrome: export buttons, "عرض التقرير"/"Run report", empty-state text) switches to English. 3) After reload the language is still English (`mezan.locale` persists it) — independent of, and orthogonal to, the theme and rail-collapse persistence. 4) Switching back restores Arabic/RTL exactly.
**`[NOT IMPLEMENTED]` / scope note**: the catalog documents a 3-flag dropdown (العربية 🇪🇬 / English 🇺🇸 / Deutsch 🇩🇪); this build supports exactly two locales (`ar`/`en`, `packages/ui/src/i18n/locale.ts` `LOCALES`) via a single toggle button, no German. **Also expected, not a bug**: switching to English does not translate screen bodies — hub screens, list/report screens (Items, Suppliers, Journals, every report's title/columns/param labels) are hardcoded Arabic strings that never call `t()`. Confirm this precisely: after switching to English, the *shell* (sidebar labels, topbar, dashboard, the `ReportRunner` chrome around every report) is English, but the moment you open e.g. "الموردون" or any report's own column headers, they remain Arabic. That split is the intended, current scope — don't file it as a bug, but do verify the split lands exactly at that boundary and no shell string leaks Arabic (or vice versa) inside it.

---

### Shell — Notifications

#### SHL-19 — Bell, panel, tabs, mark-all-read
**Pre**: A tenant with several unread notifications.
**Steps**: 1) Read the bell's badge and `aria-label`. 2) Click the bell. 3) Switch to the "غير مقروء" tab. 4) Click one unread item. 5) Click "تحديد الكل كمقروء". 6) Click outside the panel.
**Assert**: 1) The badge itself is a plain **dot** (`h-[7px] w-[7px]` circle), not a rendered count — the actual unread count only exists in the `aria-label` text (`t("shell.notifications.withCount", {count})`). If a scenario expects a "9+"-style visible number on the bell face itself, that's the catalog's older UI, not this one. 2) The dropdown opens (`role="dialog"`) anchored under the bell, header shows the true unread count as a number. 3) The list re-fetches filtered to unread only, and the tab label repeats the count (`غير مقروء {N}`). 4) Clicking an unread item calls the mark-read mutation for that one id (unread ones only — already-read items don't re-fire it) — but does **not** navigate anywhere; there is no click-through from a notification to its source document. 5) All items in the current tab become read; the header badge count drops to 0. 6) The panel closes on outside click.
**`[NOT IMPLEMENTED]`**: the panel's own "عرض جميع الإشعارات" footer button is part of `NotificationsPanel`'s API but `apps/web/src/notifications/NotificationsBell.tsx` never passes `onViewAll` — the button **does not render at all**, and there is no full notifications page to view. The catalog documents this button as present; confirm it is genuinely absent here (not merely disabled).

---

### Shell — User menu

#### SHL-20 — Menu contents, Escape closes with focus return
**Pre**: none.
**Steps**: 1) Click the user avatar/name button. 2) Press `Escape`. 3) Reopen, click "تسجيل الخروج".
**Assert**: 1) A dropdown opens with the user's name/role header, then "المستخدمون", "الأدوار", "الإعدادات العامة", a separator, and "تسجيل الخروج" in danger styling. 2) `Escape` closes the menu **and returns focus to the trigger button** (`TopbarMenu.tsx`), not to `<body>`. 3) Sign-out clears the session and returns to the login screen with `activeScreen` reset to `"dashboard"` for the next login.

---

### Dashboard

Every figure comes from `GET /dashboard/summary` (KPI strip + beam + system data + recent activity) or from the **same live report endpoints the report screens themselves call** (`apps/web/src/dashboard/dashboard-hooks.ts`) — so every dashboard widget below has an independent report to reconcile against.

#### DSH-01 — Header and quick actions
**Pre**: none.
**Steps**: Click each of the four quick-action buttons: "فاتورة جديدة", "سند نقدي", "استلام بضاعة", "عرض سعر".
**Assert**: Each navigates to its screen (فواتير المبيعات / السندات النقدية / استلام البضائع / عروض الأسعار respectively) with the create panel already open (`intent: "create"`). The greeting reads "مرحباً، {first name} · طاب يومك" using only the session user's first name (`firstNameOf`).

#### DSH-02 — Period toggle changes every figure that depends on it
**Pre**: A tenant with postings in both the current and a prior month.
**Steps**: 1) Note the KPI strip, the beam's net figure, the aging matrix, the expense donut and the top-items list under "هذا الشهر". 2) Switch to "هذا العام". 3) Switch to "كل الفترات".
**Assert**: 2)/3) The KPI strip (revenue/expenses/net/cash), the beam's tilt and verdict text, the expense donut and the top-items list all **recompute** to the new window — `reportWindow()` maps "month" → current calendar month, "year" → Jan 1–Dec 31 of the current year, "all" → `1900-01-01`–`{year+50}-12-31` (an explicit wide bound, not an omitted one, precisely so every panel stays in agreement — see the "default date bounds" preamble note). The **aging matrix does not change** with the range toggle — it's an as-of-today snapshot (`useCustomerAging`/`useSupplierAging` take no window param) and should read identically across all three range choices; if it changes, that's a bug. Also verify the delta line under revenue/expenses/net compares against the correct **prior** window: prior-month for "هذا الشهر", prior-year for "هذا العام", and — since "all periods" has no predecessor — the delta line reads "لا توجد فترة سابقة للمقارنة" for "كل الفترات", never a stale or zeroed comparison.

#### DSH-03 — KPI strip reconciles with `/dashboard/summary`, and is not clickable
**Pre**: none.
**Steps**: 1) Read the four KPI tiles (الإيرادات، المصروفات، صافي الربح، السيولة النقدية) and the three "على مستوى الشركة" tiles (مبالغ لدى العملاء، مستحقات الموردين، قيمة المخزون). 2) `curl /dashboard/summary` with the same date bounds and compare `gl.{revenue,expenses,netProfit,cash,receivables,payables,inventoryValue}`. 3) Click each tile.
**Assert**: 1)/2) Every displayed figure equals its `gl.*` field exactly (both are the same number, just formatted). Net profit renders in danger red with a "−" sign when negative, success/default otherwise. 3) `[NOT IMPLEMENTED]` — **no KPI tile is clickable**; `KpiTile`/`StatCard` never receive an `onClick`. The catalog's "each clickable — likely drills into a report" does not hold in this build; clicking does nothing (no cursor change, no navigation). Note per the preamble: مبالغ لدى العملاى/receivables here is the **GL-sourced** figure and is not the one D1 corrupts — don't conflate it with DSH-05's overdue amount.

#### DSH-04 — Balance-beam hero tilts toward profit and reads out the net
**Pre**: A period with revenue ≠ expenses (any sign of net).
**Steps**: 1) Read the beam's `aria-label` and the verdict text beneath the centre figure. 2) Compare the beam's tilt direction against the sign of net profit. 3) Switch to a period where revenue equals expenses exactly, or where the tenant has no postings at all.
**Assert**: 1) `aria-label` reads exactly `"ميزان يميل نحو الربح · صافي {money}"` when net > 0, `"...نحو الخسارة..."` when net < 0, `"ميزان متعادل · صافي {money}"` at net = 0 — where `{money}` is the formatted net profit figure, i.e. the beam **reads out the net** as the task requires, not just an icon. The verdict line under the centre figure matches the same three-way split. 2) `beamTiltDegrees(revenue, expenses, net)` (`BalanceBeam.tsx`) is `0` only when `net === 0` or `revenue+expenses === 0`; otherwise its sign strictly follows the sign of net — assert the SVG's rotation angle is non-zero and its sign matches (a positive net must not render a beam tilted toward the loss side). 3) At an exact break-even or an all-zero period the beam renders level (`tilt = 0`) and the "متعادل" verdict shows — not a division-by-zero glitch. Also verify RTL mirroring: in Arabic (default) the revenue pan sits on the visual right (`revenueAtEnd = rtl = true`); after switching to English/LTR (SHL-18) the whole beam mirrors so revenue moves to the visual left, and the tilt direction is still correct for the same net sign (the component explicitly flips the rotation sign to compensate — `angle = revenueAtEnd ? tilt : -tilt`).

#### DSH-05 — Needs-attention queue reconciles with its own linked screens
**Pre**: A tenant with at least one overdue sales invoice, one invoice due within 30 days, VAT payable > 0, one item at/under reorder point, and supplier balances aged past 30 days.
**Steps**: For each of the five rows (فواتير مبيعات متأخرة، تستحق خلال ٣٠ يوماً، ضريبة القيمة المضافة المستحقة، أصناف عند حد إعادة الطلب، مستحقات موردين تجاوزت ٣٠ يوماً): 1) note the displayed count/amount, 2) click its action button, 3) on the destination screen (or report), independently filter/read the same figure.
**Assert**: 1)/3) **Overdue**: count/amount = sales invoices with status not in `{draft, cancelled, reversed, paid}`, `remainingBalance > 0`, and `dueDate` strictly before today — cross-check against "فواتير المبيعات" filtered the same way (note the D1 caveat: this amount is `remainingBalance`-derived and is inflated for any invoice collected via a voucher, per the preamble). **Due soon**: same open-invoice set with `0 ≤ daysUntil(dueDate) ≤ 30`. **Tax due**: exactly `vat.grandTotals.tax` from the VAT-return report for the current window (RPT-28) — cross-check the two side by side. **Stock**: count of rows from "مستويات المخزون" (RPT-09) whose `status === "low"`, first-name shown matches that report's first low-stock row alphabetically-as-returned (not re-sorted). **Payables**: sum of the customer... i.e. supplier aging report's (RPT-19) `d31to60 + d61to90 + d91to120 + over120` across all rows — cross-check against that report's own bucket totals. 2) Every action button **navigates to the right screen** (فواتير المبيعات / فواتير المبيعات / التقارير المالية / تقرير مستويات المخزون / تقرير أعمار ديون الموردين respectively) but **does not pre-filter it** — there is no query param carrying "show me only the overdue ones." Assert explicitly: after the navigation, the destination screen shows its full unfiltered list; matching the attention-queue's number back to it requires the tester to apply the same filter/date window by hand, not a deep link doing it automatically. Also verify: with a tenant that has zero of a given condition, that row still renders (never hidden) with its "…clear" copy (e.g. "لا توجد فواتير متأخرة") and a neutral/success tone — the queue always shows exactly 5 rows.

#### DSH-06 — Aging matrix reconciles exactly with the aging reports
**Pre**: A tenant with both AR and AP balances outstanding across at least two buckets.
**Steps**: 1) Read the dashboard's two-row (العملاء/الموردون) × five-bucket matrix. 2) Open "أعمار ديون العملاء" (RPT-18) and "أعمار ديون الموردين" (RPT-19), each with today as `asOfDate`, and read their grand-total rows.
**Assert**: The dashboard's "العملاء" row is byte-for-byte the customer report's `grandTotals` (`current`, `d31to60`, `d61to90`, `d91to120`, `over120`) — same for "الموردون" against the supplier report — since `AgingMatrix` is fed directly from `customerAging.data.grandTotals`/`supplierAging.data.grandTotals` with no client transform beyond bucket ordering. Also verify the heat tint: a zero-valued cell renders plain/untinted (`hot = value !== 0`), and among non-zero cells the tint strength scales with that cell's share of the largest single value on the whole matrix (`peak`), not per-row — so the single largest balance anywhere on the matrix should be visually the hottest cell.

#### DSH-07 — Expense donut reconciles with the income statement
**Pre**: A period with 2+ distinct expense accounts posted to.
**Steps**: 1) Read the donut's centre total and its per-category legend rows (label, amount, %). 2) Open "التقارير المالية" → "قائمة الدخل" (RPT-25) for the exact same window, and sum every row whose `sectionKey !== "revenue"`.
**Assert**: The centre total equals that sum, and equals the dashboard's own "المصروفات التشغيلية" KPI tile (DSH-03) for the same window — all three numbers must agree, since `expenseSlices()`/`periodTotals()` both derive from the same income-statement fetch. Each legend row's % = its `value / total × 100`, rounded, and rows are sorted largest-first. On a period with zero expenses, the donut renders its empty-state text instead of a zero-radius circle.

#### DSH-08 — Top items reconciles with the top-products report
**Pre**: A period with 5+ distinct items sold.
**Steps**: 1) Read the dashboard's top-5 ranked list (rank, name, qty, revenue). 2) Open "أفضل المنتجات" (RPT-05) for the same window with `limit=5`, sorted by revenue.
**Assert**: The two lists are identical in order, name, qty and revenue — the dashboard calls the exact same endpoint (`/reports/sales/top-products?dateFrom&dateTo&limit=5`) with no re-sort. Each row's progress bar width is proportional to `sharePercent`, clamped to a visible minimum of 2% even for a very small share.

#### DSH-09 — Recent activity, no view-all
**Pre**: A tenant with recent posted journal entries.
**Steps**: Read the "النشاط الأخير" panel.
**Assert**: Entries show memo (falling back to entry number, then id) and date, newest first, sourced from `summary.recentActivity`. `[NOT IMPLEMENTED]`: there is no "عرض الكل"/view-all control on this panel in this build (the earlier catalog-aligned version had one; the current dashboard component has none) — confirm none renders, and that the list is capped at whatever `recentActivity` returns without a load-more affordance.

#### DSH-10 — Footer disclaimer and branch-scope independence
**Pre**: A branch selected in the sidebar scope switcher (SHL-05), different from "كل الفروع".
**Steps**: Read the dashboard footer text, then compare the KPI strip's revenue figure with the branch selector set to a specific branch vs. "كل الفروع".
**Assert**: Footer reads "جميع الأرقام المالية مصدرها القيود المحاسبية المرحلة · نطاق الفرع لا يؤثر على الأرقام على مستوى الشركة" verbatim, and the claim holds: the dashboard's figures are **identical** regardless of the sidebar branch/warehouse scope selection — `useDashboardSummary` calls `/dashboard/summary` with only date params, no scope headers factored into its query key differently. This is the one place in the app where SHL-05/06's "scope must change the data" rule is *deliberately* not supposed to apply — don't mistake this for the switcher being broken; it's the dashboard being explicitly company-wide.

#### DSH-11 — System data card
**Pre**: none.
**Steps**: Read the six tiles (حسابات دليل الحسابات، العملاء، الموردون، الأصناف، القيود المحاسبية، المستخدمون).
**Assert**: Each equals `summary.counts.{accounts,customers,suppliers,items,journalEntries,users}` — cross-check at least "العملاء" and "الموردون" against the actual row counts on "العملاء"/"الموردون" screens (unfiltered, all statuses).

#### DSH-12 — Error and retry state
**Pre**: Force `/dashboard/summary` to fail (stop the backend, or a permission-denied session).
**Steps**: Load the dashboard, then click "إعادة المحاولة".
**Assert**: A card reads "تعذّر تحميل بيانات لوحة التحكم." with a retry button; every widget below it renders its own empty/zero state rather than crashing (all figures optional-chain to `0`/`[]`). Retry re-fires the query.

---

### Domain hubs

Every hub follows the same shape: 3–4 `StatCard`/inline KPI tiles computed client-side from the same list endpoints the domain's own screens use (never a separate summary endpoint, except Manufacturing which reuses `/manufacturing/dashboard`), a row of quick-action buttons (first one primary, each a plain `navigate()` — none carry `"create"` intent except where noted), and a "recent activity" list. None of the KPI tiles are clickable.

#### HUB-01 — Sales hub
**Pre**: A tenant with sales invoices, quotes and customers.
**Steps**: Read the four tiles; click each of the five quick actions ("فاتورة مبيعات جديدة" primary، "عرض سعر جديد"، "قوائم الأسعار"، "العروض والترويج"، "مرتجعات المبيعات"); read "أحدث فواتير المبيعات".
**Assert**: "فواتير المبيعات" = `invoices.length` (unfiltered count, cross-check against the Sales-Invoices screen's own row count). "مبالغ مستحقة من العملاء" = sum of `remainingBalance` over invoices with status `confirmed`/`partially_paid` — **subject to D1**, confirm it against the actual invoice list rather than assuming it's correct. "عروض أسعار قيد الإرسال" = count of quotes with status `sent`. "عدد العملاء" = `customers.length`. Each quick action navigates to its screen (none open a create panel — plain navigation, unlike the dashboard's quick actions). "أحدث فواتير المبيعات" shows exactly the 5 most-recently-dated invoices, newest first, each linking customer name, date, doc number and grand total; with zero invoices it shows "لا توجد فواتير مبيعات بعد…".

#### HUB-02 — Purchases hub
**Pre**: A tenant with POs, receipts, purchase invoices, suppliers.
**Steps**: Read the four tiles ("أوامر شراء مفتوحة"، "استلامات غير مفوترة"، "فواتير المشتريات"، "عدد الموردين"); click all five quick actions.
**Assert**: Figures match unfiltered counts on their respective screens (open POs = sent or partially-received; uninvoiced receipts = receipts without a linked purchase invoice). Quick actions ("أمر شراء جديد" primary، "استلام بضاعة"، "فاتورة مشتريات جديدة"، "طلب عرض سعر"، "مرتجعات المشتريات") all navigate correctly.

#### HUB-03 — Inventory hub
**Pre**: A tenant with items across active/inactive states and stock value.
**Steps**: Read the three tiles ("عدد الأصناف"، "أصناف نشطة"، "قيمة المخزون"); click all four quick actions.
**Assert**: "قيمة المخزون" here is a **client-computed** figure (not the same code path as the dashboard's `gl.inventoryValue`, nor RPT-12's server-computed valuation) — cross-check all three against each other; they should agree in value even though computed three different ways, and if they don't, that's a real reconciliation gap worth its own defect entry (not pre-filed here). Quick actions ("صنف جديد" primary، "أرصدة المخزون"، "تحويل مخزون"، "جرد فعلي") all navigate correctly.

#### HUB-04 — Manufacturing hub
**Pre**: A tenant with active work orders.
**Steps**: Read the four KPI cards ("أوامر تصنيع نشطة"، "قيمة الإنتاج تحت التشغيل"، "الوحدات المنتجة هذا الشهر"، "متوسط تكلفة الوحدة") and the "أوامر التصنيع النشطة" list (top 5); click "عرض لوحة الإنتاج الكاملة" and all four quick actions.
**Assert**: All four KPI cards come from the **same** `GET /manufacturing/dashboard` payload the Production dashboard (HUB-05) reads — the two screens must show byte-identical `kpis.{activeWorkOrders,wipValue,unitsProducedThisMonth,avgCostPerUnit}`, this is the one hub with a shared upstream summary rather than independent client aggregation. Overdue count subtitle ("N أمر متأخر عن الموعد المجدول") = `dashboard.overdueCount`. Each list row shows order number, priority label, produced/planned qty, and either a "متأخر" danger pill (if `overdue`) or a rounded progress-% info pill. "عرض لوحة الإنتاج الكاملة" navigates to `production-dashboard`.

#### HUB-05 — Production dashboard (لوحة الإنتاج)
**Pre**: Same tenant as HUB-04.
**Steps**: Compare its four KPI tiles against HUB-04's. Read the three bucket lists ("بانتظار صرف المواد"، "بانتظار استلام المنتج"، "جاهزة للإنهاء") and the full active-orders table (رقم، تقدّم، أولوية، موعد مجدول، إجراء تالي).
**Assert**: KPIs match HUB-04 exactly (same source query). "أوامر متأخرة" tile renders in danger red only when `overdueCount > 0`. Each bucket list's badge count equals its row count. The table's "التقدّم" column shows `round(progress×100)%` alongside the raw produced/planned qty in parentheses; "الإجراء التالي" renders a button labelled per `nextAction` (بدء التنفيذ/صرف المواد/استلام المنتج/إنهاء الأمر) that navigates to "أوامر التصنيع" — or an em-dash when the order has no next action. Rows with `overdue: true` carry a "متأخر" pill next to the order number.

#### HUB-06 — Accounting hub
**Pre**: A tenant with a chart of accounts, journal entries, fiscal periods.
**Steps**: Read the three tiles ("عدد الحسابات"، "القيود المحاسبية"، "الفترات المالية المفتوحة"); click all four quick actions.
**Assert**: "القيود المحاسبية" reuses `summary.counts.journalEntries` from the same `/dashboard/summary` call the main dashboard uses — cross-check the two are identical. "الفترات المالية المفتوحة" = count of fiscal periods with an open status, out of the total shown in the subtitle. Quick actions ("قيد محاسبي جديد" primary، "دليل الحسابات"، "ميزان المراجعة"، "التقارير المالية") navigate correctly — "ميزان المراجعة" here goes to the **standalone** `trial-balance-report` screen, not the tab inside "التقارير المالية" (see RPT-24's dual-entry-point note).

#### HUB-07 — Treasury hub
**Pre**: A tenant with treasury accounts, vouchers, cheques.
**Steps**: Read the four tiles ("حسابات خزينة نشطة"، "السيولة النقدية"، "السندات المسجّلة"، "شيكات قيد التحصيل"); click all four quick actions.
**Assert**: "السيولة النقدية" here should equal the dashboard's own "السيولة النقدية" KPI (DSH-03) and `gl.cash` — cross-check. Quick actions ("سند نقدي جديد" primary، "حسابات الخزينة"، "تسوية كشف بنك"، "سجل الشيكات") navigate correctly.

#### HUB-08 — CRM hub
**Pre**: A tenant with leads, opportunities, activities.
**Steps**: Read the four tiles ("عملاء محتملون جدد"، "الفرص المفتوحة"، "القيمة المتوقعة للفرص المفتوحة"، "أنشطة قيد الانتظار"); click all four quick actions.
**Assert**: Figures cross-check against unfiltered counts/sums on "العملاء المحتملون"/"الفرص"/"الأنشطة". Quick actions ("عميل محتمل جديد" primary، "فرصة جديدة"، "خط المبيعات"، "نشاط جديد") navigate correctly.

#### HUB-09 — Assets hub
**Pre**: A tenant with registered fixed assets.
**Steps**: Read the four tiles ("عدد الأصول"، "أصول نشطة"، "إجمالي تكلفة الاقتناء"، "إجمالي الإهلاك المتراكم"); click all three quick actions.
**Assert**: Figures cross-check against "سجل الأصول". Quick actions ("أصل جديد" primary، "تشغيل إهلاك جديد"، "تصنيفات الأصول") navigate correctly.

#### HUB-10 — System status (حالة النظام)
**Pre**: none.
**Steps**: 1) Read the overall status pill and the two live-checked service cards (API health, SQLite read). 2) Click "إعادة الفحص الآن". 3) Read "سجل الأعطال" and "آخر التحديثات".
**Assert**: 1) The overall pill reads "كل الأنظمة تعمل بشكل طبيعي" (success) only when **every** listed service is `operational`; any `degraded`/`down` flips it to "توجد مشكلة في أحد الأنظمة" (danger). Each service card's detail line states a real, freshly-measured latency (`قراءة فعلية ناجحة خلال {ms} مللي ثانية`) — this is a live check, not a cached flag; killing the backend mid-session and re-checking should flip the API card to `down`. 2) Re-check re-runs both probes and updates `آخر فحص` with a new timestamp. 3) "سجل الأعطال" always shows "لا توجد حوادث مسجّلة" with explanatory copy explaining there is no cloud incident-tracking system in this local-first desktop app — this is intentional, not a hidden failure. "آخر التحديثات" lists real commit-derived changelog entries (`RECENT_CHANGES`, hardcoded from `git log`), not live data — don't expect it to update without a code change. **`[NOT IMPLEMENTED]` relative to the catalog**: there is no "يوجد عطل في النظام" top-bar status indicator/red-dot anywhere in the shell (`Topbar.tsx` has no such control) — status is only visible by navigating to this screen, consistent with the screen's own explanation that this is an offline desktop app with no cloud status page to surface ambiently.

---

### Reports

**30 total: 22 operational (generic `<ReportScreen>`/`<ReportRunner>`) + Cost-Center P&L (bespoke) + 7 financial statements** (`packages/domain/src/reports/*.ts`, confirmed by file count — not the catalog's "33 across 8 domains", which includes a promotions report and POS reports this build never implemented; see RPT-31).

**Cross-cutting contract — true for every report below unless its own scenario says otherwise:**
- **Export** (تصدير CSV / تصدير Excel) is present and enabled once rows exist, disabled while empty/exporting. The file is named `{definition.id}.{csv|xlsx}` (e.g. `sales.by-period.csv`), and contains **only the raw data rows** — no group-subtotal or grand-total rows, and cell values are the raw numbers/strings the column's `value()` returns, **not** the on-screen formatted string (a money column exports as a plain number, not "1,234.00 ج.م"). "Export matches the screen" therefore means: exported row count = on-screen data-row count (excluding total/subtotal rows), and each exported value numerically equals its on-screen figure once you strip formatting.
- **Grand total row**: rendered automatically whenever the report has at least one column flagged `total: true`; it sums that column's raw values across every row. A report with **no** `total: true` column (Stock Ledger, Make-vs-Buy, Inventory Movement Drift's own descriptive columns) shows **no** total row at all — don't expect one.
- **Invalid parameter → specific error message**: this is **half-fixed**. `useFinancialReport` (`apps/web/src/data/financial-reports-hooks.ts`) parses a 400 response's `{errors: [{field, message}]}` body into `fieldErrors`, which `<ReportRunner>` renders as a labelled red banner under the header (F3's actual fix) — this works for RPT-24–30 (the 7 financial statements, including the standalone trial-balance screen). **`useReport`** (`apps/web/src/data/reports-hooks.ts`), used by **every one of RPT-01–22**, throws `new ApiError(status, "تعذّر تحميل التقرير.")` with **no third `fieldErrors` argument** — so for all 22 operational reports, an invalid parameter reproduces F3's *original* symptom: the screen just sits on its "لا توجد بيانات."/loading placeholder with no specific message telling the user what's wrong. Test this explicitly per operational report (send a malformed date, e.g. `dateFrom=not-a-date`) and confirm no banner appears — if one ever does, `useReport` has been fixed and this note is stale.

#### المبيعات

**RPT-01 — المبيعات حسب الفترة** (`sales.by-period`, `/reports/sales/by-period`)
**Pre**: none. **Steps**: 1) Open the report — note the default `dateRange` is `2026-08-01`→`2026-08-22` (hardcoded, see preamble). 2) Change "التجميع" from يومي to أسبوعي to شهري. 3) Export CSV. 4) Set `dateFrom` to `not-a-date` in the network tab / by malformed URL param.
**Assert**: 1) Table columns: التاريخ، عدد المبيعات (qty total)، الإجمالي (money total)، الخصم (money total)، الضريبة (money total)، الصافي (money total) — all five numeric columns carry a grand total row. 2) Row grouping/bucketing changes (fewer, wider rows for شهري) and the grand totals stay constant across all three groupings (same underlying period, different bucketing). 3) `sales.by-period.csv` contains exactly the visible data rows, no total row. 4) Per the cross-cutting note: **no specific error banner** — placeholder/loading state only.

**RPT-02 — المبيعات حسب الصنف** (`sales.by-item`, `/reports/sales/by-item`)
**Pre**: none. **Steps**: Params are `dateRange` **only** — confirm there is no category/branch/channel filter despite the catalog. Change the date range narrower and wider; export.
**Assert**: Columns: الصنف، إجمالي الكمية المباعة (qty total)، الإيرادات (money total)، نسبة المساهمة (percent, not totalled). Narrowing the range strictly reduces or holds the row set and totals; export matches.

**RPT-03 — المبيعات حسب العميل** (`sales.by-customer`, `/reports/sales/by-customer`)
**Pre**: none. **Steps**: Toggle "عرض الإيرادات" between شامل الضريبة/غير شامل الضريبة (`taxMode=inc|exc`).
**Assert**: Columns: اسم العميل، عدد المبيعات (qty total)، الإجمالي (money total)، المستحق (money total, subject to D1 — cross-check against actual `remainingBalance`), نسبة المساهمة. Toggling tax mode changes الإجمالي's value (inclusive is ≥ exclusive) without changing row order or count.

**RPT-04 — المبيعات حسب المندوب** (`sales.by-salesperson`, `/reports/sales/by-salesperson`)
**Pre**: POS sales tagged with a salesperson at checkout (otherwise expect the empty state). **Steps**: Toggle عرض الإيرادات as in RPT-03.
**Assert**: Columns: المندوب، عدد الفواتير (qty total)، الإجمالي (money total)، خصم العروض (money total)، المستحق (money total)، نسبة المساهمة. With no tagged POS sales, table is empty but the report itself still "runs" (no error) — confirm the empty state is a deliberate no-data message, not a crash.

**RPT-05 — أفضل المنتجات** (`sales.top-products`, `/reports/sales/top-products`)
**Pre**: none. **Steps**: 1) Change "الحد الأقصى" (a free-text field, not a spinner) from its default to a small number (e.g. `3`) and to `0`. 2) Toggle "الترتيب حسب" بين إيرادات/كمية.
**Assert**: 1) Row count caps at the entered limit; at `0` confirm the app either shows zero rows or clamps to a sane minimum server-side — do not assume client-side validation blocks it, since this is a bare `text` field with no min/max. 2) Sort order changes to match the chosen metric; the #1 row by إيرادات need not be #1 by كمية.

#### المشتريات

**RPT-06 — المشتريات حسب الفترة** (`purchases.by-period`) — mirrors RPT-01 minus discount column: التاريخ، عدد الفواتير، الإجمالي، الضريبة، الصافي، grouping select day/week/month, no branch/channel filter (confirmed absent, matching the catalog here for once).

**RPT-07 — المشتريات حسب المورد** (`purchases.by-supplier`) — `dateRange` only (no branch filter, contra the catalog). Columns: اسم المورد، عدد الفواتير، الإجمالي، المستحق، نسبة المساهمة.

**RPT-08 — المشتريات حسب الصنف** (`purchases.by-item`) — `dateRange` only (no category/branch filter, contra the catalog). Columns: الصنف، الكمية المشتراة، التكلفة، نسبة التكلفة.
**Assert for all three**: total row sums قابل للجمع columns; export matches; malformed date → no specific error (cross-cutting note).

#### المخزون

**RPT-09 — مستويات المخزون** (`inventory.stock-levels`, `/reports/inventory/stock-levels`)
**Pre**: none. **Steps**: 1) Fill "المستودع" — read its placeholder carefully. 2) Fill "الصنف" (بحث) with a real item name.
**Assert**: 1) `[UX gap, not a missing feature]`: the "المستودع" field is a bare **text box** whose placeholder literally says "معرف المستودع (اتركه فارغاً لكل المستودعات)" — it expects a raw warehouse **id**, not a name, and offers no dropdown or autocomplete. A user without the warehouse's internal id cannot practically use this filter; confirm this is really a plain `<input type=text>`, not a disguised picker, before treating it as usable. 2) "الصنف" free-text does perform a substring name/code match. Columns: اسم الصنف، الكود، عدد المستودعات، إجمالي المخزون (qty total)، متوسط التكلفة، قيمة المخزون (money total)، الحالة.

**RPT-10 — حركة المخزون** (`inventory.movement`)
**Pre**: none. **Steps**: Toggle "الاتجاه" بين الكل/وارد/صادر; fill "الصنف"/"المستودع" (same raw-id caveat as RPT-09).
**Assert**: Filtering to وارد/صادر strictly narrows rows to that direction. Columns: التاريخ، اسم الصنف، المستودع، الاتجاه، الكمية (qty total)، نوع المرجع، المرجع.

**RPT-11 — سجل المخزون** (`inventory.ledger`)
**Pre**: none. **Steps**: Run with the default blank/wide date range; export.
**Assert**: **No grand-total row** — none of its columns (الحدث، الصنف، المستودع، الحركة، التكلفة، الرصيد) is flagged `total: true`; confirm the report simply omits the total row rather than showing a broken/empty one.

**RPT-12 — تقييم المخزون** (`inventory.valuation`)
**Pre**: none. **Steps**: Fill "بحث" and "المستودع" (raw-id caveat again).
**Assert**: Columns: الصنف، المخزون الحالي (qty total)، متوسط التكلفة، القيمة الإجمالية (money total). Cross-check "القيمة الإجمالية"'s grand total against the dashboard's `gl.inventoryValue` (DSH-03) and the Inventory hub's own figure (HUB-03) — three independently-computed numbers that should agree.

**RPT-13 — أعمار المخزون** (`inventory.aging`)
**Pre**: stock older than 30 days exists. **Steps**: Cycle through the "الشريحة العمرية" bucket select.
**Assert**: Columns: الصنف، المستودع، الكمية المتاحة (qty total)، إجمالي القيمة (money total)، العمر (يوم)، الشريحة العمرية، آخر استلام. Each bucket choice strictly narrows rows to that age band.

**RPT-14 — أصناف قاربت على الانتهاء** (`inventory.expiring`)
**Pre**: batch/lot-tracked items with expiry dates near or past due. **Steps**: Cycle "فترة الاستحقاق"; fill "بحث"/"المستودع".
**Assert**: Columns: الصنف، رقم الدفعة، المستودع، تاريخ الانتهاء، الأيام المتبقية، الحالة، الكمية المتاحة (qty total)، القيمة (money total)، تاريخ الاستلام، مستند الاستلام. Empty state when the tenant has no batch-tracked stock.

**RPT-15 — أصناف بطيئة الحركة** (`inventory.slow-moving`)
**Pre**: items with no/old sales. **Steps**: Cycle "مستوى الخطورة"; change "أيام منذ آخر بيع" (free-text number, default 90).
**Assert**: Columns: اسم الصنف، المخزون الحالي (qty total)، قيمة المخزون (money total)، أيام منذ آخر بيع، تاريخ آخر بيع، مستوى الخطورة. Lowering the day threshold widens the "حرج" bucket; items never sold show "لا مبيعات" rather than a numeric day count.

**RPT-16 — انحراف تقييم المخزون** (`inventory.drift`) — **D4 reference**
**Pre**: a tenant with confirmed purchase/sales invoices whose `occurredAt` (stamped `now()`) sorts after a document-dated movement (a transfer/adjustment carrying its own calendar date) that it should logically precede — reproducible on any demo-seeded tenant. **Steps**: 1) Cycle the "النوع" filter (الكل/فارق قيمة فقط/فارق كمية فقط). 2) Read any row with a non-zero فارق القيمة.
**Assert**: Columns: الصنف، المستودع، كمية المخزون، المتوسط المحسوب، متوسط الكاش، فارق القيمة (money total), أعلى نسبة انحراف، النوع — no reconciliation block (this report's whole purpose IS the reconciliation). **Per D4**: expect to see spurious rows here that do not indicate a real costing bug — the report replays movements in `occurredAt` order, and because confirms stamp wall-clock time rather than the document date, a later-confirmed-but-earlier-dated movement can appear to consume stock before its funding receipt. Do not re-file a drift row as a new defect without first checking whether it's explained by an `occurredAt`/document-date mismatch on the underlying movements (D4). The WAC snapshots themselves are correct per the defect note — only this replay-based report is affected.

#### التصنيع

**RPT-17 — التصنيع أم الشراء** (`manufacturing.make-vs-buy`)
**Pre**: items with both a BOM and purchase history. **Steps**: Fill "بحث"; export.
**Assert**: Columns: الصنف، قائمة المواد، تكلفة التصنيع، تكلفة الشراء، الفرق (الشراء − التصنيع)، الأرخص — **no total row** (no `total: true` column). Manufacture-only items (no purchase cost on record) should show a clear "لا توجد بيانات"-style value in تكلفة الشراء/الفرق, not `0` or `NaN`.

#### أعمار الديون

**RPT-18 — أعمار ديون العملاء** (`aging.customers`, param: single `asOfDate`, no range)
**Pre**: none. **Steps**: Change `asOfDate` to a past date and to today; export.
**Assert**: Columns: اسم العميل، جاري، 31-60، 61-90، 91-120، أكثر من 120، الإجمالي — all six money columns total. A past `asOfDate` recomputes the whole aging ladder as of that date, not just re-filters today's numbers. Feeds DSH-06 directly — cross-check.

**RPT-19 — أعمار ديون الموردين** (`aging.suppliers`) — mirror of RPT-18 for AP; same 6 totalled columns, same single-date param, feeds DSH-06 and DSH-05's "مستحقات موردين".

#### المبيعات الميدانية

**RPT-20 — مبيعات المندوبين** (`field.van-sales`, `/reports/field/van-sales`)
**Pre**: van/rep trips recorded. **Steps**: Cycle "الحالة" (كل الحالات/جارية/مسواة/ملغاة).
**Assert**: Columns: الرحلة، التاريخ، الطاقم، المحمّل، المرتجع، المنصرف (all qty, totalled)، مبيعات نقدية، تحصيلات، العهدة الافتتاحية، النقدية المتوقعة، النقدية المستلمة، فرق النقدية (all money, totalled). "فرق النقدية"'s grand total across all trips is a genuinely useful cross-check figure — verify it equals `Σ(countedCash − expectedCash)` row by row.

#### الأقساط

**RPT-21 — نظرة عامة على الأقساط** (`installments.overview`) — **no params at all** (confirm no filter bar renders). Columns: رقم الخطة، العميل، المبلغ الكلي (money total)، نسبة السداد (percent)، المبلغ المتبقي (money total)، الأقساط (qty, not totalled)، تاريخ البدء، الحالة. Empty state on a tenant with no active plans.

**RPT-22 — الأقساط المتأخرة** (`installments.overdue`)
**Pre**: overdue installments exist. **Steps**: Cycle the overdue-bucket select (الكل/1-30/31-60/61-90/91+).
**Assert**: Columns: #، اسم العميل، رقم خطة التقسيط، المبلغ (money total)، المبلغ المتبقي (money total)، تاريخ الاستحقاق، أيام التأخير. Bucket choice strictly narrows to that day range.

#### أرباح مراكز التكلفة — bespoke, not `<ReportRunner>`

**RPT-23 — أرباح مراكز التكلفة** (`/cost-center-pl`, `CostCenterPnLScreen.tsx`)
**Pre**: journal lines carrying a cost-center dimension. **Steps**: 1) Change from/to date (default hardcoded `2026-08-01`→`2026-08-31`). 2) Attempt to find an export control. 3) Send an invalid date.
**Assert**: 1) Columns: الكود، مركز التكلفة، الإيرادات، المصروفات، صافي الربح — sourced from `DocumentList`, not `ReportRunner`. The three header `StatCard`s ("إجمالي الإيرادات"/"إجمالي المصروفات"/"صافي الربح") must equal the sum of the table's own revenue/expense/profit columns — this screen's stand-in for a "total row." An unassigned catch-all "غير مخصص لمركز تكلفة" row is expected when no cost centers are actually tagged on transactions. 2) `[NOT IMPLEMENTED]`: **no export button exists on this report at all** — `DocumentList` has no export capability, unlike every one of the other 29 reports. This is the one report in the whole set where "export matches the screen" cannot be tested because there is nothing to export. 3) Same as RPT-01–22: this screen's own `useCostCenterPnL` hook has no field-error parsing either — expect only the generic "تعذّر تحميل أرباح مراكز التكلفة." card with a retry button, no specific message.

#### المحاسبة / القوائم المالية — 7 tabs, one page (`FinancialReportsScreen.tsx`, nav item "التقارير المالية")

All seven share the page's tab bar; switching tabs preserves nothing between them (`key={tab.id}` remounts each). `showGrandTotal` is `true` by default; only the balance sheet turns it off. Every account-code/name cell is expected to be clickable into a side-panel drill-down per the catalog — verify this still holds per tab, it wasn't independently re-checked in this pass.

**RPT-24 — ميزان المراجعة (tab)** — auto-runs on tab entry (`FinancialReportsScreen` explicitly overrides `onDemand={false}` here even though the underlying definition itself is `onDemand: true`). Columns: رقم الحساب، اسم الحساب، مدين (total)، دائن (total) — the two totals must be equal (an explicit reconciliation block enforces and displays `مدين = دائن`).
**`[dual-entry-point inconsistency — test explicitly]`**: the **same** trial-balance report is also reachable as its own standalone nav item, "ميزان المراجعة" under Accounting (`TrialBalanceReportScreen.tsx`, `trial-balance-report` key). That screen does **not** override `onDemand` — it reads the definition's own `onDemand: true` and therefore **requires an explicit "عرض التقرير" click**, and its default `asOfDate` is computed live (`new Date()`), unlike the tab's hardcoded `2026-08-22`. Run both, side by side, with the same `asOfDate`, and confirm they produce identical figures despite the different default-date and auto-run behaviour — and separately confirm the standalone screen really does sit on a "اختر الفلاتر…" placeholder until clicked, while the tab shows data immediately on arrival.

**RPT-25 — قائمة الدخل (tab)** — params: `periodFrom`/`periodTo` (default `2026-01-01`→`2026-08-22`) + "المقارنة" select with **two** real options, "الفترة السابقة" and "نفس الفترة من العام الماضي" (`compareTo: previous|lastYear`) — richer than the catalog's single toggle button. Columns: رقم الحساب، البند، الفترة الحالية (total)، فترة المقارنة (total)، التغيّر (a `variance`-formatted column: a small tilt-beam icon + signed money, from `beams.tsx`'s `VarianceBeam`, not plain text). **Assert**: switching "المقارنة" from السابقة to نفس الفترة من العام الماضي changes فترة المقارنة's values (and therefore التغيّر) without touching الفترة الحالية; the variance beam tilts up/green when a rise is good news and down/red when it isn't, per row.

**RPT-26 — الميزانية العمومية (tab)** — param: single `asOfDate`. Columns: رقم الحساب، الحساب، الرصيد. **`showGrandTotal: false`** explicitly — confirm no grand-total row renders even though "الرصيد" is a `total: true` column; the three-section balance check (الأصول = الالتزامات + حقوق الملكية) is shown as its own explicit summary line instead, and that's the number to verify, not a table total.

**RPT-27 — التدفقات النقدية (tab)** — params: `periodFrom`/`periodTo` + "المقارنة" select (same two options as RPT-25). Columns: البيان، التدفق النقدي (total)، فترة المقارنة (total)، التغيّر (variance beam). Reconciliation block: الرصيد الافتتاحي + صافي التغيير = الرصيد الختامي — verify the arithmetic holds exactly.

**RPT-28 — إقرار ضريبة القيمة المضافة (tab)** — params: `periodFrom`/`periodTo` only (no branch, no comparison — matches the catalog here). Columns: نسبة الضريبة، الوعاء الخاضع (total)، مبلغ الضريبة (total), rendered as two separate grouped tables (output/input) via the report's `group` config. A `renderSummary` block above the table (the **only** operational/financial report using this optional slot) reads "ضريبة المخرجات − ضريبة المدخلات = {صافي الضريبة المستحقة الدفع|صافي الضريبة القابلة للاسترداد}: {amount}" — verify the label flips correctly when net VAT goes negative (refundable) vs positive (payable). This exact `net` figure is what DSH-05's "ضريبة القيمة المضافة المستحقة" attention row reads.

**RPT-29 — دفتر الأستاذ العام (tab)** — on-demand (`onDemand: true`, not overridden here): loads to a "اختر الفلاتر…" placeholder until "عرض التقرير" is clicked. Params: `periodFrom`/`periodTo` only (a "بحث عن حساب" text box from the catalog does not exist in this definition's `paramFields` — confirm). Columns: التاريخ، رقم القيد، البيان، مدين (total)، دائن (total) — after running, confirm مدين's grand total equals دائن's (every posted period should balance).

**RPT-30 — دفتر حساب (tab)** — on-demand, **but pre-populated**: `AccountLedgerTab` builds its definition with `accountId` defaulted to the tenant's first postable account (`accounts.find(a => !a.isHeader)`), not left blank. **`[behaviour differs from the catalog]`**: the catalog documents "عرض التقرير" as **disabled** until an account is chosen; in this build the button is only ever `disabled={loading}` — it is clickable immediately on arrival, and running it without ever touching the "الحساب" select produces a real ledger for that pre-selected first account. Test both paths: (a) click "عرض التقرير" immediately — confirm it runs against the pre-selected account, not a blank/error state; (b) change "الحساب" to a different real account first, then run — confirm the ledger switches accordingly, columns التاريخ، رقم القيد، البيان، مدين (total)، دائن (total)، الرصيد الجاري (running balance, not totalled).

#### RPT-31 — Reports the catalog documents that this build does not have
**Pre**: none. **Steps**: 1) Search the sidebar "التقارير" group and the command bar for "ملخص المبيعات اليومي" / "تقارير الورديات" (POS daily summary / shift reports) and "تقرير العروض" (Promotions report). 2) Grep-equivalent: check `apps/web/src/screens/reports/*.tsx` and `apps/web/src/App.tsx`'s `ROUTABLE_SCREENS` for any POS-report or promotions-report screen or key.
**Assert**: `[NOT IMPLEMENTED]` — none of the three exist: no nav entry, no screen file, no `ROUTABLE_SCREENS` key, no domain report definition under `packages/domain/src/reports/`. The catalog's 33-report inventory includes these (POS domain, 2 reports; Promotions, 1 cross-referenced report) on top of this build's 30; confirm they are genuinely absent rather than merely unlinked (unlike, say, the settings-catalog's audit log, which exists but is only reachable via the command bar — these three have **no** reachability path at all, command bar included, since the command bar's item list is the fixed 5-entry set from SHL-09).

---

# 13. Cross-module seams


Every other file in this directory tests one module. This one tests the seams:
what has to be true **between** modules when a single business event travels
through them. Buy something and the money must leave the خزنة. Sell something
and it must arrive in the bank. Nothing in a single-module test can catch a
company whose sales module says one thing and whose treasury says another.

**Executable half**: `scripts/scenarios/cross-module.ts`, run with
`pnpm scenarios cross-module` (or `pnpm scenarios` for every suite). It runs
late — it spends stock and cash — and every id it creates is prefixed `SCN-X-`.

**Second executable half**: `scripts/scenarios/seams.ts` (`pnpm scenarios seams`)
covers the seams the money trails cannot reach — currency, tax, compliance,
concurrency, permissions and year-end. It runs **last** of all, prefixes its ids
`SCN-S-`, and is written up under "Currency, tax, compliance and platform seams"
below.

**Sources**: the module scenarios `01`–`08` for each leg, `docs/archive/catalog/04`
(الخزينة) for the treasury rules, and the wiring in
`packages/backend/src/create-backend.ts` where the modules are actually joined.

---

### The three questions every trail asks

1. **Did the money move, once, in the right direction?** The خزنة/bank is GL
   `1300-1` / `1310`; a treasury screen renders that same balance. If a document
   claims to have been paid, that number must move by exactly the amount.
2. **Did the sub-ledger and the ledger stay in step?** `/reconciliation` compares
   the inventory, AR and AP sub-ledgers against GL 1200 / 1105 / 2100. A trail
   that moves one and not the other is broken even when both look fine alone.
3. **Do the books still balance afterwards?** Trial balance debit = credit, and
   assets = liabilities + equity. Checked before and after every scenario by the
   harness itself.

**Before you start**: read `ROADMAP.md` §5. D1 (a collection voucher never
updates the invoice's `amountPaid`) reaches into most of the trails below, and
several assertions here exist to record its blast radius, not to re-file it.

---

### Setup the file performs first

Earlier suites leave approval gates configured — `platform.ts` on
`SALES_RETURN_CONFIRM`, `accounting.ts` on `TREASURY_VOUCHER_CONFIRM`. A gated
document is held `pending` mid-trail and **no route in the product ever posts an
approved-but-held document** (platform.ts's own finding), so a money trail run
behind those gates measures a journey that stopped halfway. This file deletes
those two gates before it starts, and says so in its output.

---

### Cash and bank — the core question

#### X0 — Capital injection funds the خزنة
- **Steps**: confirm a `capital_injection` voucher for 250,000 into the cash treasury.
- **Assert**: GL 1300-1 rises by exactly 250,000; equity 3100 rises by exactly the same; nothing else moves.

#### X1 — Sell something → the money lands in the bank
- **Steps**: open stock on a new item → confirm a sales invoice (10 × 100 + 14% VAT) → confirm a `customer_collection` voucher **into the bank** → allocate it to that invoice.
- **Assert**: stock falls by the sold quantity; AR rises by the grand total; revenue takes the net and 2200 the tax; COGS takes quantity × unit cost. Confirming the invoice moves **no** money at all. Only the collection moves the bank, by exactly 1,140, and the خزنة stays untouched. AR nets back to zero over the pair.
- **Known**: the invoice's own `amountPaid` stays 0 — **D1**.

#### X2 — Buy something → the money leaves the خزنة
- **Steps**: PO → confirm → goods receipt → confirm → supplier invoice → confirm → `supplier_payment` voucher **from cash** → allocate it.
- **Assert**: receiving goods moves stock with no GL and no money; the invoice puts the net into 1200, the tax into 1400 and the gross into AP; only the payment moves the خزنة, by exactly 2,280; AR/AP net out.
- **Finds**: **D18** — the AP sub-ledger never subtracts the payment.

#### X3 — A cash sale
- **Assert**: the خزنة rises by the grand total, the bank does not move at all, AR nets to zero across invoice and collection.

#### X4 — خزنة → bank transfer
- **Assert**: source falls, destination rises, by the identical amount; cash + bank together is unchanged — a transfer is a move, not income.

#### X5 — The overdraft guard, and the switch that is supposed to govern it
- **Steps**: try to pay out more cash than the خزنة holds → switch `منع الرصيد السالب للحسابات النقدية` **off** in Settings → re-read it → retry the very same voucher.
- **Assert**: the first attempt is refused and the balance is untouched; with the setting off, the same voucher should post.
- **Finds**: **D19** — it is still refused. The setting is a dead switch.

#### X16 — Reversal puts the money back everywhere
- **Assert**: reversing a confirmed expense returns the خزنة **and** the expense account to their exact prior balances, the trial balance to its prior state, and marks the voucher `reversed` rather than deleting it.

#### X18 — Company-wide money conservation
- **Assert**: over the whole file, `cash + bank` moved by exactly the net of every receipt and payment the file posted — named and totalled in the failure message if it does not.

---

### Returns and refunds

#### X6 — Sales return → refund out of the خزنة
- **Assert**: the return restocks the goods and drops AR, and refunds **nothing** — it sits `awaiting refund`. Only the separate `customer_refund` voucher moves the خزنة, by exactly the return's grand total.

#### X7 — Purchase return → refund from the supplier
- **Assert**: stock leaves, AP falls by the return's grand total, no money moves; the `supplier_refund` receipt then raises the خزنة by exactly that amount.
- **Finds**: **D18** again, from the other side.

#### X8 — Paid by cheque
- **Steps**: sale → record an incoming cheque → deposit → collect.
- **Assert**: receiving the cheque already clears AR and parks the value in 1320 شيكات تحت التحصيل; **depositing does not credit the bank**; only collection does, and 1320 empties back to where it started.

---

### Cost that travels

#### X9 — Landed cost changes what the next sale costs
- **Steps**: buy 100 units at 10 → confirm → add a 500 landed cost BY_VALUE → sell 20.
- **Assert**: unit cost rises by exactly 5, inventory value by exactly 500 (no rounding leak), and COGS on the later sale charges 20 × 15 — the landed cost, not the invoice price.

#### X13 — Manufacturing moves value, it does not create it
- **Steps**: BOM → work order → issue 20 raw at 25 → receive 10 finished → complete → sell 3.
- **Assert**: raw material genuinely leaves the warehouse; each finished unit carries the 50 of material it consumed; COGS on the sale charges the manufactured cost.

#### X14 — Write-down hits the P&L through a provision
- **Assert**: expense 5060 and provision 1190 both take the run's total; **GL 1200 is deliberately untouched**, so the stock sub-ledger and its control account stay reconciled; the entry balances.

---

### Tax, payroll, assets

#### X10 — Both halves of VAT
- **Assert**: a sale's tax reaches 2200 and a purchase's reaches 1400, the VAT return's two sides move by exactly what the ledger recorded, and a `tax_payment` voucher lowers the bank and the VAT payable by the same amount — paying tax settles a liability, it is not an expense.

#### X11 — HR spends the same خزنة everyone else does
- **Steps**: request → approve → disburse an employee advance from the cash treasury.
- **Assert**: the خزنة falls by exactly the advance; the disbursement is a real treasury voucher, visible in the treasury module like any other — one treasury, not one per module.

#### X12 — A fixed asset bought with company money
- **Assert**: paying for it moves the bank; registering it touches neither stock nor cash; the depreciation run includes it, posts a balanced entry for the run's own total, and costs the business value without costing it cash.

---

### Gates and agreement

#### X15 — Closing a period stops every module
- **Steps**: draft a sales invoice, a purchase invoice, a treasury voucher and a journal entry → close August → try to post all four → reopen → retry.
- **Assert**: all four are refused with a period error, nothing slips through, and the same voucher posts once the period reopens.
- **Finds**: **D20** (the purchase invoice answers 500, not 422) and **D21** (that crash still moved the stock).

#### X17 — The dashboard reports the money the ledger holds
- **Assert**: the dashboard's cash, receivables and payables tiles equal an independent recomputation over every postable account of the right kind, on its natural side, as of the same date.

#### X19 — A credit limit is a cross-module fact
- **Assert**: with credit control in BLOCK mode, an invoice past the customer's limit is refused and one inside it confirms.
- **Finds**: paying in full through the treasury does **not** free the limit up again — credit control reads `amountPaid`, which D1 never updates. A customer who always pays by voucher silently freezes at their limit.

#### X20 — Instalments on a real invoice
- **Assert**: the schedule's lines sum to exactly invoice total − down payment; the down payment is an ordinary treasury voucher that raises the خزنة and lowers AR.
- **Known**: collecting money never marks an instalment line paid — no route does (§10 INST-08).

#### X21 — A van trip is a custody transfer
- **Assert**: opening the trip really moves the stock into the van warehouse and the float into the van treasury; settling prices both variances and hands the counted cash back to the branch.
- **Finds**: **D22** — roadside sales recorded on the trip post nothing to the van treasury, yet settling transfers the full counted cash out of it, so every completed trip drives the van's cash account down by its own takings.

#### X22 — The bank statement must agree with the vouchers
- **Assert**: an imported CSV parses its lines, auto-match links the ones a voucher explains, the unexplained bank fee stays unmatched, and reconciling moves no money and posts nothing.

---

### Go-live, compliance and platform seams (executable)

#### X31 — Importing history must not re-post it
Crosses: data migration ▸ purchases ▸ inventory ▸ GL.

- **Steps**: dry-run then commit a purchase-history batch — one fully-paid document, one half-paid.
- **Assert**: the dry run classifies settled vs outstanding and computes remaining = total − paid. The commit archives both, moves **no** stock, adds **no** inventory value, posts at most one journal entry for the whole batch, and leaves the archives readable. AP rises by the outstanding balance only.
- **Finds**: **D23** — AP rises by nothing at all.

#### X32 — The same rule on the sales side
- **Assert**: no stock leaves for goods delivered before go-live; AR rises by what customers still owe and by nothing else.
- **Finds**: **D23** again — every migrated customer starts owing zero.

#### X33 — VAT is not one rate
Crosses: items ▸ sales ▸ tax ▸ GL.

- **Steps**: one invoice with a 14% line and a 5% line; then an invoice for a **tax-exempt** customer.
- **Assert**: tax is 14% of one base plus 5% of the other — never a blended rate over the total — and GL 2200 takes exactly that. The exempt flag overrides the line's own rate: tax total is zero, no output VAT posts, and the goods are still billed in full.
- **Why it matters**: Egypt's standard rate is 14% with a 5% reduced band, and exempt bodies are common. A per-document tax rate would quietly overcharge one of them.

#### X34 — A document-level discount, to the piastre
- **Steps**: three lines of 33.33 / 33.33 / 33.34 with a 10% invoice discount.
- **Assert**: VAT is charged on the **discounted** base (14% of 90), the grand total is 102.60, the posted entry balances, AR is debited with the discounted total, and COGS is unchanged — a discount never alters what the goods cost.

#### X35 — The same confirm, twice
- **Assert**: retrying a confirm with the same `requestId` never posts twice — stock falls once, AR rises once, and the invoice carries one document number and one journal entry.

#### X36 — Branch scope, with a real second branch
- **Steps**: create a second branch, warehouse and stock; sell from it; read the invoice list under each `x-branch-scope`.
- **Assert**: **D7 measured rather than inferred** — every scope returns the identical rows, and a caller scoped to the first branch can read the second branch's invoice. Warehouse scope, by contrast, genuinely narrows — proving the two are independent mechanisms and only one is wired.

#### X37 — A backdated document changes the past, not the present
- **Assert**: a July-dated entry posted while July is open restates July's income statement, leaves August's untouched, reaches the cumulative ledger, and does not break the aging report's date handling.

#### X38 — Module licensing is designed but not enforced
- **Assert**: manufacturing, fixed assets, installments, field sales and HR all answer 200 for a caller with no entitlement. `createModuleGate` (403 `MODULE_NOT_LICENSED`) exists and `hasModule` exists; there is no call site in `create-backend.ts`, so the licensing model in `archive/plan.md` §2.5 is unenforced at runtime. Nothing in the API can express "this tenant did not buy Manufacturing".

#### X39 — Batch, expiry and what FEFO actually decides
- **Steps**: receive two batches of one item — cheap stock expiring next year, dearer stock expiring in two months — invoice them, then sell exactly one batch's worth.
- **Assert**: the earliest-expiring batch is consumed first (the expiring report shows it gone and the later one untouched), **and** COGS charges the blended weighted-average cost, not that batch's own. FEFO decides which goods leave; it does not price them. A pharmacy asking "what did the October batch cost me" cannot get that answer today — `archive/plan.md` §6.3.6 leaves FIFO/batch costing open.

---

### Currency, tax, compliance and platform seams (executable)

`scripts/scenarios/seams.ts`, run with `pnpm scenarios seams`. It runs **after**
`cross-module.ts` — it closes periods, opens a fiscal year and sweeps forty
documents through the ledger — and prefixes every id it creates `SCN-S-`.

These are the seams the money trails could not reach: what happens when the
currency is not EGP, when the tax is not 14%, when two people confirm at the same
second, when the permission is not `*`, and when the year ends. Several assert a
gap on purpose: the assertion states the business requirement, and where the
product cannot meet it the check is inverted and labelled with the measured
evidence, so a fix flips it back rather than deleting it.

#### X23 — A foreign-currency balance, revalued at the closing rate
Crosses: exchange rates ▸ GL ▸ financial reports ▸ purchases.

- **Pre**: an approved USD rate on the transaction date (48.00) and a higher approved rate at month end (52.00).
- **Steps**: book a USD 1,000 liability with `currency`/`fxRate` on the GL line → `POST /revaluation/preview` → `POST /revaluation/post` with `autoReverse` → preview again.
- **Assert**: the foreign amount is recomputed from the booked base (48,000 ÷ 48 = 1,000 USD); the restatement is exactly 1,000 × (52 − 48); a liability that grew is a **loss**, never a gain; the entry debits the FX loss account and credits the liability by the same 4,000; **GL 1200 does not move**; the auto-reversal mirrors it on the first of the next month, so the live balance returns to what was actually booked; re-running the same revaluation reports the same figure, not a doubled one.
- **Measured**: the revaluation engine is correct end to end. What is not: a *document* cannot carry a foreign balance at all — a `currency: "USD"` purchase invoice posts EGP 1,000 for USD 1,000 with both GL lines untagged (**D24**). The engine has nothing to revalue because nothing upstream speaks currency.

#### X24 — An unapproved rate must not be spendable
Crosses: exchange rates ▸ approvals ▸ GL.

- **Steps**: record a pending EUR rate → revalue against it → approve it → revalue again → lock it → re-POST the same id with a different rate.
- **Assert**: revaluing against a **pending** rate is refused by name (`FX_RATE_MISSING`), not generically; once approved the same revaluation converts at exactly the approved rate; a locked rate cannot be changed.
- **Measured**: the first two hold — `findRate` filters to `approved`/`locked`, so an unapproved rate is genuinely unspendable. The third does not: re-POSTing a locked rate's id rewrites the rate **and resets its status to pending** (**D25**), because the create route upserts by id.

#### X26 — Project ▸ cost centre ▸ P&L
Crosses: cost centres ▸ GL ▸ reports.

- **Steps**: post a journal entry whose expense line sets `costCenterId` → read `/cost-center-pl` and the income statement → then pay an expense through a **treasury voucher** carrying the same `costCenterId`.
- **Assert**: the tagged expense appears once under its centre and once in the income statement; every posted expense sits in exactly one bucket, tagged or untagged, so the report reconciles.
- **Measured**: tagging works for journal entries. The voucher's `costCenterId` is dropped at the wire — `createVoucherSchema` has no such field — and the 400 lands in غير مخصص (**D26**). Since almost nothing a business spends is entered as a manual journal entry, the cost-centre report is blind to most real spending.

#### X28 — Promotion ▸ revenue ▸ VAT ▸ history
Crosses: promotions ▸ sales ▸ tax ▸ reports.

- **Steps**: create an item-scoped 10% promotion → confirm a qualifying invoice → read the invoice, the promotions report and GL 2200 → deactivate the promotion → re-read all three.
- **Assert**: the discount comes off the gross before VAT (VAT is 14% of 900, not of 1,000); revenue is recognised net; the invoice records **which** promotion applied; the report counts it exactly once at the discount actually granted; after deactivation the invoice, its posted VAT and the report row are unchanged.
- **Measured**: all of it holds. Deactivating a promotion does not restate what it already granted — the applied promotion is snapshotted on the invoice at confirm.

#### X29 — Confirming a document should reach the ETA queue
Crosses: sales ▸ e-invoicing.

- **Steps**: configure ETA fully with `autoSubmitOnConfirm: true` → confirm a real invoice → re-read `/eta/submissions`.
- **Measured**: the setting is stored and read by nothing; the queue is byte-identical before and after (**D5**, do not re-file). A tenant can complete e-invoicing setup, confirm invoices all day, and submit none of them.

#### X30 — One confirm, many listeners
Crosses: sales ▸ notifications ▸ webhooks ▸ GL.

- **Steps**: create a notification rule on `SALES_INVOICE_CONFIRMED` and a webhook pointed at an endpoint that cannot answer → confirm an invoice → read the inbox, the deliveries and the journal entry → confirm again.
- **Assert**: one notification per matching rule (no storm, no rule firing twice); a user no rule addresses gets nothing; the failed delivery is recorded as failed rather than swallowed or optimistically marked successful; the document stays confirmed, its entry posts once in full, and a second confirm is refused rather than posting again.
- **Measured**: holds. A dead webhook cannot roll back, duplicate or halve the document that triggered it.

#### X45 — Withholding tax on local payments
- **Steps**: look for a WHT-payable account, pay a supplier net with `withholdingAmount`/`grossAmount` supplied, ask for a withholding report, then model it by hand.
- **Measured**: no account, no field, no report (**D27**). The voucher stores the **net**, so the supplier's ledger shows them still owed the withheld amount the tenant is legally holding for the authority. The only workaround is a hand-written journal entry per payment.

#### X46 — VAT rules that are not "14% of everything"
- **Steps**: confirm one invoice with 14%, 5% and zero-rated lines → run the VAT return → try to express a partial taxable base on a tax rate.
- **Measured**: the ledger charges 140 + 50 + 0 correctly per line, and the **return** collapses them into one derived ~6.3% bucket (**D28**), because it recomputes rate = tax ÷ base per journal entry. A partial taxable base (the construction-contract 14%-on-36% treatment) cannot be expressed at all.

#### X47 — A filed VAT period should not move under the filing
- **Steps**: run July's return → look for any way to record it as filed → post a backdated July entry → re-run the return → close the period and try again → reopen.
- **Measured**: no filing state exists anywhere (**D29**); the already-"filed" figure moves by exactly 140.00 with no amendment or warning. Period close *does* refuse the same posting — the mechanism works, nothing ties it to the tax filing, and reopening needs no reason and leaves no tax-side trace.

#### X52 — Rounding, swept rather than sampled
- **Steps**: generate forty service invoices across awkward prices (33.33, 0.005, 10.005, 1.115, 99.995, 123.456), quantities (1/3/7/11), rates (14/5/0) and percent discounts (10 / 33.33 / 90 / 7.5), then four three-way instalment splits.
- **Assert**: every one confirms; each line extends to the piastre and those rounded lines sum to the gross; subtotal − invoice discount = the taxable base; grand total = taxable + tax; every posted entry balances; a three-way instalment split of an indivisible total sums back to the total.
- **Measured**: holds for all forty, and for the splits. X34 and X9 each prove one case; this proves the rule.

#### X56 — Two people, one second
- **Steps**: draft eight invoices, confirm all eight concurrently, then close the period and attempt a ninth confirm.
- **Assert**: eight distinct numbers, the counter advanced by exactly eight, and the refused confirm burned no number.
- **Measured**: holds. Numbering is allocated inside the confirm transaction, so a refused confirm leaves no gap for an auditor to ask about.

#### X57 — Branch-prefixed numbering
- **Steps**: create a second branch and warehouse, confirm a sale in each.
- **Measured**: the two branches share one tenant-global counter and no prefix says where a document came from (**D33**); the sequence definition has no branch dimension to configure. Open product decision (`archive/plan.md` §6.3.8), now measured rather than assumed.

#### X58 — Permissions are a graph, and some are sensitive
- **Steps**: call the API as a `sales.invoice.confirm` holder, a plain `sales.invoice.view` holder, and an `hr.contract.view` holder.
- **Assert**: the dependency graph is enforced server-side; `view_own` narrows to the caller's own documents; a caller without `view_cost` sees the document with its costs **hidden**, not an error; salary obeys the same rule.
- **Measured**: only the first holds. The `.confirm` holder is **403** on the list route (every read route gates `.view`), `view_own` narrows nothing, and both ⚠ sensitive permissions — `sales.invoice.view_cost` and `hr.employee.view_salary` — are checked by no route (**D31**).

#### X59 — Arabic search must forgive Arabic
- **Steps**: create أحمد / فاطمة / ليلى, query the list route with `?q=احمد`, then run the screens' own filter expression over the same names.
- **Measured**: `?q=` is a parameter of no list route, so the full table comes back unchanged; the client-side `toLowerCase().includes(q)` every screen uses returns **zero** matches for احمد, فاطمه or ليلي (**D32**). The fix is one shared normalisation helper (أإآ→ا, ة→ه, ى→ي, strip tashkeel) used by both ends; it exists nowhere in the repo today.

#### X61 — Every movement of money leaves a trace
- **Steps**: confirm a payment, reverse it, confirm a sale, then query `/audit`.
- **Assert**: each action writes a row naming the actor, the branch and the document.
- **Measured**: the actions ARE recorded — both halves of the payment, with a real actor. What is missing is *where*: the voucher names `BR-MAIN` and every row it wrote carries `branchId: null` (**D30**), because the audit sink reads the caller's scope rather than the document's branch. On a desktop install this trail is the only forensic record there is.

#### X63 — Price list, promotion and credit limit in one document
- **Steps**: assign a customer a price list quoting 80 (item default 100), add a 20% promotion, set the credit limit **between** the un-promoted and promoted payable, then confirm — and separately send a line priced off-list.
- **Assert**: the promotion discounts the price-list price; the credit check sees the final payable, not an intermediate one.
- **Measured**: the ordering holds where the server can see it — 800 − 20% = 640, +14% = 729.60, and the credit check passed on 729.60 against an 800 limit rather than refusing on the pre-promotion 912. But the price list itself is never consulted: a line at 5.00 for an item listed at 80.00 is accepted without a warning (**D35**). The ordering is real only for as long as the UI remembers to apply it.

#### X64 — Year-end
- **Steps**: generate FY2027 → look for a year-end close → compare the 2027 income statement, the revenue account, retained earnings and the balance sheet.
- **Assert**: the new year opens where the old one ended, revenue and expense accounts start at zero, and the prior year's comparatives still resolve.
- **Measured**: the twelve periods generate and open, and the reports window by date so 2027 correctly reads empty. But there is no year-end close anywhere in the product (**D34**): GL 4100 still carries 2026's revenue, GL 3900 never receives the profit, and the balance sheet balances only because the *report* derives retained earnings from the P&L accounts itself. The ledger alone can never tell you last year's result.

---

### Not yet executable — run these by hand

These cross seams `cross-module.ts` does not reach yet, written the same way so
they can be executed later without being redesigned. Ids follow the same
`SCN-X-` convention. Where a known defect makes a scenario unprovable, that is
said up front — the scenario still documents the seam.



#### X25 — POS session → treasury
Crosses: POS ▸ inventory ▸ treasury ▸ GL. **Deferred by decision**: only `GET /pos/sales` exists — there is no route to open a session, sell through it, or close it. Write the scenario; expect it to be unrunnable until POS ships.

- **Steps (intended)**: open a session with an opening float from a treasury account → make a cash sale and a card sale → close the session declaring the counted cash.
- **Assert (intended)**: stock falls by what was sold; the session's declared cash equals the float plus its cash sales; closing moves exactly that into the branch خزنة, and the card takings into the bank/clearing account instead — never both into the same one; every POS sale reaches the same AR/revenue/VAT accounts a normal invoice does, so the VAT return and the income statement include them without a separate reconciliation.
- **Watch**: this is the same shape as **D22** (a document recording cash that the treasury never received). Check it explicitly rather than assuming POS is wired differently.


#### X27 — Branch scope, end to end
**Superseded by X36**, which now creates a real second branch and measures it. What remains manual is the UI half: a user whose session grant is one branch must not be able to *widen* scope with the switcher, and the switcher must not offer branches the grant excludes.




---

### Egypt compliance — what the market actually requires

Written against the rules an Egyptian business is audited on, not against what
the product currently implements. Several of these will fail; that is the point
of writing them down before a customer does.

#### X40 — ETA B2B: an invoice is not final until the ETA clears it
Crosses: sales ▸ e-invoicing ▸ printing.

- **Pre**: ETA configured, a confirmed sales invoice.
- **Steps**: confirm → submit → simulate each of the three outcomes: accepted, rejected, and still-pending.
- **Assert**: the invoice carries a visible submission state at all times, and the ETA UUID once accepted. A **rejected** submission must be loud — the invoice must not sit there looking compliant while the ETA has refused it. A pending one must be distinguishable from an accepted one on the document, in the list, and on anything printed. Nothing about clearance may silently alter the posted journal entry.
- **Today**: **D5** — no user action enqueues anything, so this whole flow is unreachable.

#### X41 — ETA B2C: e-receipt within the window, and the QR on the paper
- **Assert**: a retail sale produces an e-receipt submitted within 72 hours (post-clearance, unlike B2B), and the printed receipt carries a QR code that resolves to the validated receipt. Reprinting must reproduce the same QR, never mint a new one.
- **Today**: POS does not exist (deferred), so this is specification, not test.

#### X42 — The offline queue has a legal clock on it
Crosses: e-invoicing ▸ desktop edition ▸ shell.

- **Steps**: with no connectivity, confirm several invoices, then let time pass.
- **Assert**: the unsent queue shows a count **and the age of the oldest unsent document**; the warning escalates as that age approaches the statutory deadline; reconnecting drains the queue in document order and never submits the same document twice. `archive/plan.md` §5.5 records this as an open product decision — the scenario exists so the decision cannot be forgotten.

#### X43 — Registration threshold and late-submission penalties
- **Assert**: the tenant can record its ETA registration status and threshold basis, and the product warns when the tenant's own annual revenue crosses the registration threshold (EGP 250,000 since Resolution 281/2025). Late submissions must be countable — the ETA's penalties escalate on how many late submissions fall inside a rolling 12-month window, so a tenant needs that number visible, not buried.

#### X44 — A credit note is an ETA document too
- **Assert**: a confirmed sales return produces its own submission, linked to the original invoice's UUID, and the VAT return nets it. A return that never reaches the ETA leaves the customer's input tax and the tenant's output tax permanently disagreeing.

#### X45 — Withholding tax on local payments
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

#### X46 — VAT rules that are not "14% of everything"
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

#### X47 — A filed VAT period should not move under the filing
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

---

### Payroll — the statutory half that is deliberately absent

`ROADMAP.md` records that payroll computes no Egyptian income tax, no social
insurance, no Article 47 seniority bonus, no end-of-service gratuity. These
scenarios test the **honesty** of that gap first, and the computation later.

#### X48 — A payslip must say what it did not compute
- **Assert**: every payslip and payroll run states plainly, in Arabic, that statutory deductions are not included and that the net shown is therefore not the amount an employee should receive. STATUS calls this the highest-priority open item in HR: a number that is silently wrong is worse than a number that is missing.

#### X49 — Social insurance is two liabilities, not one deduction
- **Assert (when built)**: the employee share reduces net pay and the employer share is a company cost; both credit separate liability accounts; the payroll journal entry balances with both present; paying the authority clears exactly those liabilities and the treasury by their sum.

#### X50 — End of service reaches the ledger before it is paid
- **Assert (when built)**: gratuity accrues as a liability over service, terminating an employee settles it from that liability rather than as a fresh expense, and the P&L is not distorted in the month someone leaves.

#### X51 — Legal constants are versioned data, not code
- **Assert**: leave presets and any statutory rate carry the law and article they came from and the date they took effect; adopting a new preset changes future calculations only and never restates a balance already earned under the old one. `archive/plan.md` §6.2 lists Egyptian regulatory change as permanent recurring work — this scenario is what keeps it cheap.

---

### Integrity at scale — the risks `archive/plan.md` §6.2 names

#### X52 — Rounding, swept rather than sampled
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

#### X53 — The same books on both engines
- **Assert**: a golden set of documents posted through SQLite and through Postgres produces identical ledgers to the minor unit — same balances, same rounding, same ordering. `archive/plan.md` calls dual-dialect drift the worst class of bug this product can have; nothing else in this file would catch it.

#### X54 — Five years of data, on a laptop
- **Assert**: with a five-year seeded tenant, each report returns inside its budget and none times out; the heavy ledger reports stay usable on-demand. Measure and record the numbers — a report that takes 40 seconds is a defect even when its figures are right.

#### X55 — Restore is part of the product
- **Assert**: back up, destroy, restore — then compare the ledger, the sub-ledgers and every document count against the pre-backup state. `archive/plan.md` §6.2 lists an untested restore path as total-data-loss risk for a desktop customer.

#### X56 — Two people, one second
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

#### X57 — Branch-prefixed numbering
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

---

### Platform seams

#### X58 — Permissions are a graph, and some are sensitive
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

#### X59 — Arabic search must forgive Arabic
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

#### X60 — The desktop edition, genuinely offline
- **Assert**: with no network, the full document lifecycle works end to end — sell, buy, pay, report, print — and nothing fails silently or hangs. The only thing that may not complete is ETA transmission (X42), and it must say so.

#### X61 — Every movement of money leaves a trace
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

#### X62 — Delivery notes, if they arrive
- **Assert (design guard)**: stock currently leaves on invoice confirm. If delivery notes are introduced, the same goods must never be able to leave twice, and an invoice raised from a delivery note must not move stock again. `archive/plan.md` §6.3.7 leaves this open — the scenario exists so the answer is chosen, not stumbled into.

#### X63 — Price list, promotion and credit limit in one document
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

#### X64 — Year-end
**Now executable** — written out in full under "Currency, tax, compliance and platform seams" above, and asserted by `scripts/scenarios/seams.ts`.

#### X65 — The sales trail as a user clicks it: quote → accept → invoice → collect
**Now executable** — `scripts/scenarios/cross-module.ts` x40. One new customer with a credit limit, a quote for two items, accept, convert, confirm, collect. What it pins: a quote moves nothing; conversion lands a **draft** with no number; confirming charges AR, output VAT and COGS and drops stock; and the invoice's own «تحصيل دفعة» marks the invoice paid while posting **no journal entry at all** (D40), so the aging report and GL 1105 part company. D39 rides along: no screen can confirm that draft.

#### X66 — The purchase trail as a user clicks it: order → receive → invoice from receipt → pay
**Now executable** — `scripts/scenarios/cross-module.ts` x41. The from-receipt invoice is created the way the screen creates it — `receiptId` with **no lines** — which is what exposes D42: the route's `resolveTaxRate` port is never wired, so every line is 0% VAT and input VAT never moves. Receiving raises stock without a GL entry (the sub-ledger legitimately runs ahead until the invoice), the invoice closes that gap, and paying the supplier through a voucher clears GL 2100 while the AP sub-ledger ignores it (D18).

---

### Sources for the compliance scenarios

- [Egypt E-Invoicing 2026: ETA Compliance Guide](https://datavalue.solutions/egypt-e-invoicing-eta-2026-sme-guide/) — registration threshold cut to EGP 250,000 (Resolution 281/2025), enforcement stage from 1 Jan 2026, graduated late-submission penalties.
- [Egypt E-Receipt Requirements: ETA Guide for 2026](https://invoicedataextraction.com/blog/egypt-e-receipt-requirements) — B2B pre-clearance vs B2C post-clearance within 72 hours, QR code on printed receipts.
- [PwC — Egypt, Corporate: Other taxes](https://taxsummaries.pwc.com/egypt/corporate/other-taxes) and [Withholding Tax in Egypt](https://www.flick.network/en-eg/withholding-tax-in-egypt) — withholding regime on local and cross-border payments.
- [VATupdate — Egypt VAT decrees effective October 2025](https://www.vatupdate.com/2025/11/19/vat-law-amendments-new-rules-for-construction-contracts-and-tax-obligations-in-egypt/) — 14% on 36% of value for pre-18-July-2025 construction contracts, no input deduction.
- [ERP Systems in Egypt: a 2026 guide](https://buildn.tech/en/blog/erp-system-egypt) and the competitive review already recorded in `docs/archive/plan.md` §"Market & competitive notes" — what an Egyptian SMB buyer compares Mezan against.

---

# 14. Posting trails — end to end, one per part


**One thread of real actions per part of the product, pulled taut across every
module it touches.** A trail is not a list of screens to open: it is a chain of
clicks where each step changes something *somewhere else*, and the check is
whether that somewhere else agrees.

The module scenarios (§5–§12) prove each screen behaves, and §13 proves the seams
between a handful of them. Neither answers the question a buyer
asks on day one: *if I do my actual day's work in this thing, do the numbers still
make sense at the end of it?*

### How to run a trail

| | |
|---|---|
| Web | `http://localhost:5174` (`pnpm --filter web dev`) |
| API | `http://127.0.0.1:3010` with `MEZAN_SEED_DEMO=1` (`pnpm server`) |
| Sign in | `admin@cyag.example` / PIN `123456` |

Take the steps **in order, in the UI**, and after each one open the screens
listed under it and check them against the stated effect. Reload the page before
you tick anything off — reloading is what catches "works until you look again".

Two rules make the checks worth doing:

- **Check a pair, never a single figure.** One plausible number hides
  everything; two that must agree cannot. Every trail names its pair.
- **A status is not a posting.** A document that says مدفوع, مؤكد or مُرحّل has
  only claimed something. The claim is true when the ledger moved with it.

### This file is the source

`pnpm trails` parses this file and rebuilds the tickable page from it
(`scripts/build-trail-pack.mjs` → published artifact). Edit here, never there.
The format is load-bearing:

```
### T01 · Sales — Quote to collection
Modules: Sales · Inventory · Accounting
Executable: cross-module.ts x40

1. [ok] The action to take, named as the screen names it.
   - Where: what must be true afterwards.
   - !Where: what is wrong today (renders as the failing branch).
Done: the pair that must agree once the trail is finished.
```

`[ok]` = walked through the running app or asserted by `pnpm scenarios`.
`[stop D43]` = a known defect blocks it; the code names the row in
`archive/defect-register.md`.

> **Five `[stop]` flags are stale.** They cite D38, D42, D43 and D44, all of which were
> closed on 2026-08-27. The steps have not been re-walked since, so the flag is unproven in
> either direction — treat those five as unrun, not as blocked, and clear the flag when you
> walk them.
— note that you saw it, do not re-file it. `[open]` = written from the routes and
the domain, not yet driven end to end. Finding it wrong is the point.

Most steps are `[ok]` because the D1–D37 sweep closed 37 defects. Where a step's
effect reads *fixed (F53) — check it has stayed fixed*, the sentence after it is
what used to happen: that is the regression the step exists to catch. Four
defects are open as this pack lands — D38, D42, D43 and D44.

---

### T01 · Sales — Quote to collection
Modules: Sales · Inventory · Accounting · Treasury · Dashboard · Reports
Executable: cross-module.ts x40 · sales.ts

1. [ok] المبيعات ← العملاء — add a customer, set a credit limit.
   - Sales: the customer appears in the quote and invoice pickers.
   - Reports: أعمار ديون العملاء does not list them — the report counts documents, not names. A zero row would be an invented one.
2. [ok] المبيعات ← عروض الأسعار — quote them for 2–3 items, save as a draft.
   - Everywhere: no stock and no ledger effect. A draft quote has no number either — the list shows «مسودة» until it is sent.
3. [ok] Quote detail ← إرسال للعميل, then قبول العميل.
   - Sales: sending mints the number (QT-…). Neither transition moves anything.
4. [ok] Quote detail ← إنشاء الفاتورة — pick the due date and the warehouse.
   - Sales: a draft sales invoice is created; still no stock, still no ledger.
   - Sales: the panel names the new invoice by its internal id and does not link to it.
5. [stop D43] المبيعات ← فواتير المبيعات — open the draft and confirm it.
   - !Blocked: there is no confirm control on the invoice page — only «رجوع». The draft cannot be posted from any screen; the route is reachable only over the API.
   - Inventory: stock falls per line at weighted-average cost.
   - Accounting: one balanced entry — Dr AR 1105 / Cr Revenue 4100 + Output VAT 2200, and Dr COGS 5100 / Cr Inventory 1200 at cost, not at price.
   - Reports: the invoice appears in المبيعات حسب الفترة / العميل / الصنف and in the customer aging at its full total.
6. [ok] Invoice detail ← المدفوعات ← تحصيل دفعة — collect the whole amount into a named treasury account.
   - Treasury: the collection creates and confirms a real سند قبض and allocates it to the invoice — the response names the voucher it made.
   - Treasury: a payment that names no treasury account is refused. Money always lands somewhere a screen can show.
   - Accounting: AR 1105 clears by exactly the amount, and the cash box rises by it. The bank, unnamed, does not move.
   - Sales: amountPaid is written back by the allocation, not by a second counter of its own — the store that used to disagree with the ledger (D1) is gone.
   - Reports: أعمار ديون العملاء drops the customer, and GL 1105 agrees with it.
7. [ok] المحاسبة ← التقارير المالية — ميزان المراجعة and قائمة الدخل.
   - Accounting: every debit above has its credit; the trial balance still balances.
Done: stock down by what was sold, revenue up by the net, VAT up by the tax — and once the collection is made the way that actually posts, the customer's balance back to zero in both the aging report and GL 1105.

### T02 · Sales — The goods come back
Modules: Sales · Inventory · Accounting · Treasury · Reports
Executable: sales.ts · cross-module.ts x6

1. [ok] المبيعات ← مرتجعات المبيعات — return part of a confirmed invoice.
   - Inventory: stock rises again at the cost it left at, not at the sale price.
   - Accounting: Dr Revenue + Dr Output VAT / Cr AR, and Dr Inventory / Cr COGS.
   - Sales: the source invoice's remaining balance nets the return.
2. [ok] Try to return the same goods twice.
   - Sales: refused. The available quantity is recomputed server-side from posted documents — an inflated one in the request body is ignored (regression guard for F7).
3. [ok] Refund the customer — الخزينة ← السندات النقدية ← سند صرف.
   - Treasury: the cash box falls by the refund.
   - Accounting: Dr AR / Cr Cash — a separate movement. Confirming a return credits the customer; it never hands money back on its own.
4. [ok] Check the reports.
   - Reports: المبيعات حسب الفترة nets the return; أعمار ديون العملاء shows the reduced balance.
Done: the customer's receivable and the item's on-hand both back where they were before the sale, with two documents explaining the round trip.

### T03 · Sales — Three mechanisms, one price
Modules: Sales · Accounting · Reports
Executable: seams.ts x63 · x28 · x34

1. [open] المبيعات ← قوائم الأسعار — create a list and assign it to the customer.
   - Sales: the list appears on the customer record and on the quote header.
2. [ok] المبيعات ← العروض — create a promotion that needs no coupon.
   - Sales: eligibility is by item, customer category and date window.
3. [ok] Raise an invoice for that customer and that item.
   - Accounting: fixed (F52) — check it has stayed fixed. Until then, the price list is never consulted server-side — a line at 5.00 against a list quoting 80.00 is accepted without a word.
   - Sales: the promotion is applied at confirm and recorded on the invoice that granted it; deactivating it afterwards restates nothing.
4. [ok] Push the customer past their credit limit.
   - Sales: the confirm is refused in Arabic, and the check sees the promoted price.
   - !Treasury: collecting through a voucher does not free the limit up again — the exposure still counts an invoice the customer has paid.
5. [ok] Apply an invoice-level discount.
   - Accounting: deducted before VAT and allocated across the lines with no rounding leak; above 100% or below zero is refused at the wire.
Done: whatever price ends up on the line is the one the tax, the credit check and the reports all use — and nothing silently sells below the list.

### T04 · Purchases — Order to payment
Modules: Purchases · Inventory · Accounting · Treasury · Dashboard · Reports
Executable: cross-module.ts x41 · purchases.ts

1. [ok] المشتريات ← الموردون — add a supplier.
   - Purchases: the supplier appears in the PO and invoice pickers.
   - Purchases: the «المستحق للمورد» column is computed from the documents — opening balance plus confirmed invoices, less payments, returns and cheques (F39–D39). It used to render the opening balance, which read 0.00 for every supplier who owed six figures.
2. [ok] المشتريات ← أوامر الشراء — order 2–3 items, then تأكيد وإرسال.
   - Everywhere: document only — no stock, no ledger. The PO takes its number at draft.
3. [ok] المشتريات ← استلام البضائع — receive against the PO and confirm.
   - Inventory: stock rises and the item's cost re-averages.
   - Accounting: no entry yet. The inventory sub-ledger legitimately runs ahead of GL 1200 by the receipt's value until the invoice lands — there is no goods-received-not-invoiced account to hold it.
4. [stop D44] المشتريات ← فواتير المشتريات ← من إيصال استلام — create and confirm.
   - !Tax: every auto-filled line arrives at 0% VAT and no screen can change it. Input VAT 1400 never moves and the tax is unreclaimable.
   - Accounting: Dr Inventory 1200 (+ input VAT, when there is any) / Cr AP 2100 — GL 1200 catches up with the receipt exactly.
5. [ok] الخزينة ← السندات النقدية ← سند صرف — pay the supplier.
   - Treasury: the cash box falls, GL 2100 falls with it.
   - Accounting: fixed (F34) — check it has stayed fixed. Until then, the AP sub-ledger does not hear the payment at all, so مطابقة الأرصدة reports it as a new mismatch.
6. [ok] المحاسبة ← التقارير المالية — ميزان المراجعة and الميزانية.
   - Accounting: both still balance after the whole chain.
Done: the received quantity on hand matches what was invoiced, GL 1200 and the stock valuation agree once the invoice is posted, and the supplier nets to zero in the ledger.

### T05 · Purchases — Shop around before you commit
Modules: Purchases · Reports
Executable: purchases.ts

1. [ok] المشتريات ← طلبات عروض الأسعار — raise an RFQ for two suppliers.
   - Purchases: the RFQ lists both suppliers and the requested lines.
2. [ok] Record each supplier's quoted prices.
   - Purchases: quotes are per supplier per line, not one price per RFQ.
3. [ok] Open the comparison.
   - Purchases: the basket totals decide, not the individual line prices.
4. [ok] Convert the winner into a purchase order.
   - Purchases: the RFQ closes and links the PO it produced; the PO drafts at the winning quote's prices.
5. [open] التقارير ← المشتريات حسب المورد.
   - Reports: counts what was actually bought, not what was quoted.
Done: a paper trail from "who did we ask" to "what did we pay", with the losing quotes still readable afterwards.

### T06 · Purchases — Returns and the true landed cost
Modules: Purchases · Inventory · Accounting · Treasury · Reports
Executable: cross-module.ts x7 · x9 · purchases.ts

1. [ok] المشتريات ← مرتجعات المشتريات — return goods against a confirmed invoice.
   - Inventory: stock falls.
   - Accounting: Dr AP / Cr Inventory, with input VAT reversed.
   - Treasury: the supplier's refund is a separate receipt into the cash box.
2. [ok] المشتريات ← التكاليف الإضافية — add freight and clearance against the receipt, BY_VALUE.
   - Inventory: the allocation sums to exactly the total entered — no rounding leak — and each target's unit cost rises by its share.
   - Inventory: the next sale's COGS charges the raised cost, not the invoice price. That is the whole point of the document.
   - Reports: fixed (F53) — check it has stayed fixed. Until then, the revaluation writes no stock movement, so انحراف تقييم المخزون reports drift on a healthy tenant and the position cannot be replayed.
3. [ok] Run one BY_QUANTITY against a single target.
   - Inventory: 100% of the cost lands on it.
4. [stop D42] Look for the freight supplier's own balance after the landed cost posts.
   - Accounting: the cost is credited to the AP control account.
   - !Purchases: with no supplier dimension — the payable exists in the ledger and on nobody's account, so the supplier statement and أعمار ديون الموردين never show it.
Done: the item's unit cost tells the truth about what it cost to get it into the warehouse, and the freight money is in the stock value rather than in an expense account.

### T07 · Inventory — One item, cradle to count
Modules: Inventory · Accounting · Reports · Settings
Executable: inventory.ts · cross-module.ts x14

1. [ok] المخزون ← الأصناف — create a stock item with its GL accounts.
   - Accounting: revenue, COGS and inventory accounts belong to the item, not to the invoice; a sale reads them from here.
2. [ok] المخزون ← تسويات المخزون — open it with INITIAL_STOCK.
   - Accounting: balanced Dr 1200 / Cr 3100. Opening stock is capital, not profit.
3. [ok] المخزون ← تحويلات المخزون — move some to another warehouse.
   - Inventory: quantity and value move together; the company total does not change and no GL entry is needed.
4. [ok] المخزون ← الجرد الفعلي — count a position short.
   - Inventory: the sub-ledger moves.
   - Accounting: fixed (F35) — check it has stayed fixed. Until then, no journal entry at all — a single-sided count leaves inventory off by exactly the shortfall.
5. [ok] المخزون ← هبوط قيمة المخزون — run a write-down.
   - Accounting: charged to the P&L through a provision account, leaving the inventory control account and its reconciliation intact.
6. [ok] Open the stock reports.
   - Reports: مستويات المخزون, حركة المخزون, سجل المخزون, تقييم المخزون and أعمار المخزون all answer, and the valuation total equals GL 1200.
7. [open] المخزون ← طباعة الملصقات — print a label.
   - Settings: three sizes; symbology comes from الإعدادات ← إعدادات الباركود.
Done: what the warehouse says it holds, what the valuation report prices it at, and what GL 1200 carries are three views of one number.

### T08 · Inventory — Batches, expiry and what the shelf is worth
Modules: Inventory · Purchases · Sales · Reports
Executable: cross-module.ts x39 · shell.ts

1. [ok] Receive one item as two batches with different expiry dates.
   - Inventory: both batches are on hand with their own costs and dates.
2. [ok] Confirm the matching purchase invoice.
   - Accounting: GL 1200 catches up with the receipt.
3. [ok] Sell part of the position.
   - Inventory: FEFO decides which batch leaves — the earliest-expiring one goes first and disappears from أصناف قاربت على الانتهاء.
   - Accounting: costing is weighted-average, so COGS charges the blended cost. "What did the October batch cost me" is a question these books cannot answer today.
4. [ok] Open أصناف بطيئة الحركة, أعمار المخزون and انحراف تقييم المخزون.
   - Reports: fixed (F53) — check it has stayed fixed. Until then, drift is reported on a healthy tenant because landed costs write no movement.
Done: the expiring report is a shelf-accurate list a pharmacy could act on, and every cost that reaches COGS came from a real receipt.

### T09 · Manufacturing — Raw material becomes a product
Modules: Manufacturing · Inventory · Accounting · Reports
Executable: cross-module.ts x13

1. [ok] التصنيع ← قوائم المواد — build a BOM for a finished item.
   - Manufacturing: components, quantities and the expected output are on one document.
2. [ok] التصنيع ← أوامر التصنيع — raise a work order and issue the materials.
   - Inventory: component stock falls at weighted-average cost.
3. [ok] Complete the work order.
   - Inventory: the finished item arrives carrying the produced cost.
   - Accounting: fixed (F36) — check it has stayed fixed. Until then, completeWorkOrder never touches GL 1200 — the raw material left the ledger and the finished goods never arrived in it. The seeded BOM at qty 10 ends 80.00 short.
4. [ok] Sell the finished item.
   - Accounting: COGS charges the produced cost, not a guess.
5. [open] لوحة الإنتاج and التقارير ← التصنيع أم الشراء.
   - Reports: compares the produced cost against the purchase price for the same item.
6. [open] التصنيع ← التصنيع المخصص — a one-off order with its own recipe.
   - Manufacturing: the instance carries its own component list without editing the template BOM.
Done: value in equals value out — material consumed plus labour absorbed equals what the finished goods are carried at, on both sides of the ledger.

### T10 · Accounting — The books themselves
Modules: Accounting · Reports · Settings
Executable: accounting.ts · seams.ts x26

1. [ok] المحاسبة ← دليل الحسابات — add an account under the right parent.
   - Accounting: type and nature come from the parent; a posting account cannot have children.
2. [ok] المحاسبة ← القيود المحاسبية — post a manual entry.
   - Accounting: an unbalanced entry cannot post. Ever.
3. [ok] Reverse it.
   - Accounting: the reversal never mutates the original, links both sides, and the books still balance. Correction is by reversal — posted entries are immutable.
4. [ok] المحاسبة ← مراكز التكلفة — tag an expense with a cost centre.
   - Reports: a tagged journal entry reaches أرباح مراكز التكلفة once and the income statement once.
   - Treasury: fixed (F44) — check it has stayed fixed. Until then, a treasury voucher cannot be tagged at all — the field does not exist on the wire — so almost all real spending lands in «غير مخصص».
5. [ok] المحاسبة ← مطابقة الأرصدة — the sub-ledgers against their controls.
   - Accounting: fixed (F34 · F56) — check it has stayed fixed. Until then, this screen is the product's own two-number check. Today it shows the ledger and the sub-ledgers disagreeing by the sum of D1, D18, D2 and D3.
Done: every figure on every financial report can be walked back to a posted, balanced, immutable entry with an actor and a date on it.

### T11 · Accounting — Periods, back-dating and the year end
Modules: Accounting · Sales · Purchases · Treasury · Reports
Executable: cross-module.ts x15 · x37 · seams.ts x64 · x47

1. [ok] المحاسبة ← الفترات المالية — close the current period.
   - Accounting: sales confirm, voucher confirm and journal post all refuse with a period error, in Arabic.
   - Purchases: fixed (F39) — check it has stayed fixed. Until then, the purchase-invoice confirm answers 500 instead — and is not atomic (D21): the stock went in before the GL refused, and nothing rolled it back.
2. [ok] Re-open the period and post into it.
   - Reports: that period's reports restate; the current period is untouched.
   - Tax: fixed (F46) — check it has stayed fixed. Until then, nothing records that a VAT period was ever filed, so a backdated document silently restates a return that has already gone to the authority.
3. [ok] Generate the next fiscal year.
   - Accounting: fixed (F51) — check it has stayed fixed. Until then, there is no year-end close — no closing entry, retained earnings never posted, last year's revenue still in 4100. The balance sheet balances only because the report derives retained earnings itself.
4. [open] Lock a closed period.
   - Accounting: locked is terminal — no reopen, no posting, and the screen must say so rather than offering a button that fails.
Done: a closed period is closed for every module by the same gate, and a new year starts where the old one ended — in the ledger, not only in the report.

### T12 · Accounting — The report pack ties out
Modules: Reports · Accounting
Executable: accounting.ts · shell.ts SCN-RPT-*

1. [ok] ميزان المراجعة.
   - Reports: total debit equals total credit.
2. [ok] الميزانية.
   - Reports: assets = liabilities + equity, and AR classifies as a current asset, not as cash.
3. [ok] قائمة الدخل.
   - Reports: the comparative window matches a direct run of the prior period, and 29 Feb clamps to 28 Feb rather than rolling into March.
4. [ok] قائمة التدفقات النقدية.
   - Reports: opening + net change = closing.
5. [ok] دفتر الأستاذ العام and كشف حساب.
   - Reports: the running balance's last row equals the reported closing balance.
6. [ok] إقرار ضريبة القيمة المضافة.
   - Reports: output minus input is the net payable.
   - Tax: fixed (the D1–D37 sweep) — check it has stayed fixed. Until then, the return re-derives one blended rate per entry instead of reporting the rates actually charged, because no posted line carries a rate.
Done: six reports, one ledger, no figure that only one of them believes.

### T13 · Accounting — The pair that catches everything
Modules: Accounting · Sales · Purchases · Inventory
Executable: accounting.ts · every cross-module scenario re-checks these three

1. [ok] AR sub-ledger against GL 1105.
   - Accounting: zero difference. Every collection — voucher or invoice-level — posts and allocates, so the two cannot drift (F34, F56).
2. [ok] AP sub-ledger against GL 2100.
   - Accounting: zero difference. The sub-ledger subtracts allocations and treasury payments, which is what D18 was.
3. [ok] Inventory sub-ledger against GL 1200.
   - Accounting: zero difference on a settled tenant. Physical counts post (F35), completed work orders post (F36), and a refused purchase confirm rolls its stock back (F39).
   - Inventory: legitimately apart between a goods receipt and its invoice — that gap must close when the invoice posts.
4. [ok] Re-run all three after every trail in this pack.
   - Accounting: the baseline is now exactly zero on all four invariants, so any difference a trail leaves behind is new, and is a finding.
Done: the three differences are zero, and any trail that moves one of them off zero has found something.

### T14 · Treasury — Where the money actually sits
Modules: Treasury · Accounting · Sales · Purchases · HR
Executable: cross-module.ts x0 · x3 · x4 · x5 · x11 · x16

1. [ok] الخزينة ← حسابات الخزينة — a cash box and a bank account, each mapped to its GL account.
   - Accounting: the treasury account's balance is the GL account's balance, not a second copy of it.
2. [ok] سند قبض / سند صرف — receive and pay against a real document.
   - Accounting: allocate the receipt onto the invoice it pays — GL AR clears exactly.
   - Sales: fixed (F34 · F56) — check it has stayed fixed. Until then, the invoice's own amountPaid stays 0 all the same.
3. [ok] Capital injection — partner money into the box.
   - Accounting: cash and equity rise together; money arrives from an owner, not from thin air.
4. [ok] Transfer between two treasury accounts.
   - Treasury: money moves without being created or destroyed; both halves are one entry.
5. [ok] Try to overdraw the cash box.
   - Treasury: it is refused.
   - Settings: fixed (F38) — check it has stayed fixed. Until then, the tenant setting «منع الرصيد السالب» that is supposed to govern the refusal is not wired to the guard — both switches are dead.
6. [ok] Reverse a confirmed payment.
   - Accounting: the box, the counter-account and the trial balance all return to their exact prior values.
7. [ok] Disburse an employee advance.
   - Treasury: it leaves the same box a supplier payment leaves — one treasury, not one per module.
8. [open] The day's close — every voucher of the day against the box's movement.
   - Treasury: the closing figure equals opening plus receipts minus payments, with each voucher listed.
Done: total treasury movement for the day equals the net of the vouchers that caused it, and each voucher names the document it settles.

### T15 · Treasury — The bank says something else
Modules: Treasury · Accounting · Reports
Executable: cross-module.ts x22

1. [ok] الخزينة ← تسوية كشوف البنك — import or enter a statement.
   - Treasury: the statement lines land unmatched, with the closing balance stated.
2. [ok] Match its lines against the vouchers that produced them.
   - Treasury: a matched pair drops out of both outstanding lists.
3. [ok] Confirm the reconciliation.
   - Accounting: it posts nothing to the ledger — reconciling is an assertion about what already posted, not a new fact.
4. [open] Leave one statement line unmatched and one voucher outstanding.
   - Treasury: both are visible as the reconciling items, with the closing difference equal to their net.
Done: the bank's balance, the treasury account's balance and GL 1310 explain their differences line by line.

### T16 · Financial papers — A cheque through all seven states
Modules: Financial papers · Treasury · Accounting · Sales
Executable: accounting.ts · cross-module.ts x8

1. [ok] الأوراق المالية ← سجل الشيكات — receive a customer cheque against a real sale.
   - Treasury: the money is not in the bank yet — receipt is custody, not collection.
2. [ok] Deposit it, then collect it.
   - Accounting: only on collection does the bank account rise and AR clear.
3. [ok] Bounce one.
   - Accounting: the reversal returns the party's control account to its prior value exactly — a bounced cheque is an undo with a trace, not an adjustment.
4. [open] Send an outgoing cheque to a supplier and walk the mirror path.
   - Treasury: issued, presented, cleared — the bank falls only on clearing.
5. [open] Check the register against the treasury movements it caused.
   - Reports: cheques under custody plus the bank balance equal what the books say the company holds.
Done: at every moment, cheques under custody plus the bank balance equal what the books say the company holds.

### T17 · Accounting — Tax, both halves, and what the authority sees
Modules: Accounting · Sales · Purchases · Reports · Settings
Executable: cross-module.ts x10 · x33 · seams.ts x29 · x45 · x46 · x47

1. [stop D44] Sell at 14% and buy at 14%.
   - Accounting: output VAT 2200 rises on the sale, input VAT 1400 on the purchase.
   - !Purchases: unless the purchase invoice came from a goods receipt — then it is 0%.
2. [ok] One invoice at two rates, plus a tax-exempt customer.
   - Reports: the ledger and the return agree with both; an exempt customer pays none.
3. [ok] إقرار ضريبة القيمة المضافة, then pay the net.
   - Accounting: paying clears both sides.
   - Reports: fixed (the D1–D37 sweep) — check it has stayed fixed. Until then, the return's rate buckets are derived, not recorded.
4. [ok] المحاسبة ← الفاتورة الإلكترونية — switch auto-submit on and confirm an invoice.
   - Tax: fixed (F33) — check it has stayed fixed. Until then, the queue has an enqueue that nothing calls — confirming a real invoice enqueues nothing. The screen is a window onto an empty pipe.
5. [ok] Withhold tax on a local B2B payment.
   - Tax: fixed (F45) — check it has stayed fixed. Until then, nowhere to put it — no account, no document field, no report. A payment cannot settle a supplier in full while paying the authority the difference.
Done: the VAT return can be filed straight from the screen, and every figure on it is a sum of posted lines rather than a derivation.

### T18 · Accounting — A debt in another money
Modules: Accounting · Purchases · Sales · Reports
Executable: seams.ts x23 · x24

1. [ok] المحاسبة ← أسعار الصرف — add a rate, approve it, lock it.
   - Accounting: fixed (F43) — check it has stayed fixed. Until then, a locked rate can be silently rewritten, and its status reset, by re-POSTing its id.
2. [ok] Raise a supplier invoice in USD.
   - Accounting: fixed (F42) — check it has stayed fixed. Until then, the currency is a label — no rate is applied, no GL line is tagged, and the payable is booked at the foreign figure as though it were pounds.
3. [ok] المحاسبة ← إعادة تقييم العملات الأجنبية — revalue at the closing rate.
   - Accounting: the restatement touches only the FX accounts and auto-reverses so it cannot be counted twice — correct machinery with nothing correct to work on until the rate is applied.
Done: a foreign debt is carried at today's rate, and the gain or loss from the move is in the P&L rather than hidden in the payable.

### T19 · CRM — A stranger becomes a customer
Modules: CRM · Sales · Reports
Executable: crm.ts

1. [ok] إدارة علاقات العملاء ← العملاء المحتملون — add a lead and walk its statuses.
   - CRM: the state machine is enforced server-side; terminal statuses accept nothing.
2. [ok] Qualify and convert it.
   - Sales: a real customer and a real opportunity are created — no dangling reference, no half-converted lead.
3. [ok] الفرص / خط المبيعات — drag the opportunity across stages.
   - CRM: status follows its destination stage's type; win and loss stay exclusive; stage reorder is guarded at the boundaries.
4. [ok] الأنشطة — log a call, complete it, cancel another.
   - CRM: both are terminal and cannot be repeated.
5. [ok] Quote the new customer — T01 continues from here.
   - Sales: the converted customer is a first-class customer, pickers included.
Done: the pipeline's total value and the quotes actually raised for those customers describe the same sales effort.

### T20 · HR — Hire, pay, and account for it
Modules: HR · Treasury · Accounting · Reports
Executable: hr.ts · cross-module.ts x11 — HR is descoped from v1: design review, not a release gate

1. [ok] الأقسام / المسميات الوظيفية / الموظفون — set up one employee.
   - HR: the employee carries a department, a job title and a branch.
2. [open] العقود — give them an active contract.
   - HR: known behaviour — a lapsed fixed-term contract keeps reporting «ساري».
3. [ok] الحضور والانصراف and طلبات الإجازات.
   - HR: a request exceeding the available balance is refused.
   - HR: an approved unpaid leave prorates the payroll deduction exactly.
4. [ok] سلف الموظفين — request, approve, disburse.
   - Treasury: the advance leaves the same cash box everything else leaves.
   - HR: the instalment schedule splits by largest remainder and always sums exactly.
5. [ok] الرواتب — run the payroll for the month.
   - HR: gross − deductions = net per payslip and for the run total.
   - HR: an employee with no active contract is excluded, not failed; approving the run recovers exactly one advance instalment.
6. [ok] Disburse the run.
   - Accounting: one balanced journal entry; the treasury falls by exactly the net.
   - HR: social insurance is two liabilities, not one deduction.
Done: what the payslips say the company owes, what the ledger carries as a liability, and what left the treasury are the same three numbers.

### T21 · Projects — Work that spans months
Modules: Projects · Accounting · Purchases · Reports
Executable: crm.ts (projects)

1. [ok] المشاريع والمقاولات — create a project.
   - Projects: code uniqueness is enforced.
2. [ok] Walk its status lifecycle.
   - Projects: guarded server-side; مكتمل and ملغي are terminal.
3. [open] Tag costs to it — purchases and journal entries.
   - Accounting: the project behaves like a cost dimension, not a note field.
4. [open] Open the project P&L.
   - Projects: thin by design in v1 — BOQ, progress certificates and retention are not built. A contractor's trail stops here, and that is the honest answer to give one.
Done: every pound spent on the project is attributable to it, and the project's own view agrees with the cost-centre P&L.

### T22 · Fixed assets — Buy, depreciate, dispose
Modules: Assets · Accounting · Treasury · Reports
Executable: crm.ts (fixed-assets) · cross-module.ts x12

1. [ok] الأصول الثابتة ← تصنيفات الأصول — a category with a method and a life.
   - Assets: code uniqueness and the numeric ranges are validated.
2. [ok] سجل الأصول — buy an asset with company money.
   - Treasury: cash falls; the asset is capitalised.
   - Inventory: it never touches stock — an asset is not inventory.
3. [ok] الإهلاك — run depreciation.
   - Accounting: each asset depreciates by its own category's method and life; the posting balances.
   - Assets: accumulated depreciation never exceeds cost − salvage, and a fully-depreciated asset flips status on posting.
4. [ok] Dispose of one.
   - Assets: fixed (F37) — check it has stayed fixed. Until then, there is no disposal route and no button. The status value and the permission both exist; the action does not. The trail cannot be finished.
Done: the register's net book value equals cost less accumulated depreciation in the ledger, asset by asset — and an asset that leaves the company can actually leave the books.

### T23 · Field sales — A van goes out and comes back
Modules: Field sales · Inventory · Treasury · Accounting · Reports
Executable: crm.ts (field-sales) · cross-module.ts x21 · shell.ts SCN-RPT-20

1. [open] المبيعات الميدانية ← رحلات المندوبين — open a trip with a stock and cash float.
   - Inventory: custody transfer — stock moves to the van warehouse, cash to the van treasury.
   - Field sales: unverified since the D1–D37 sweep — the open route discards the caller's id and mints no tripNo.
2. [ok] Record roadside sales and cash taken.
   - Treasury: fixed (F40) — check it has stayed fixed. Until then, the cash movement only mutates the trip document — nothing reaches the van treasury.
3. [ok] Settle the trip.
   - Treasury: fixed (F40) — check it has stayed fixed. Until then, settling transfers the full counted cash out of the van treasury — float plus takings that were never posted into it — so every completed trip drives the van's cash account down by what its sales brought in.
   - Field sales: stock and cash variances are computed and priced correctly.
4. [ok] التقارير ← مبيعات المندوبين.
   - Reports: the cash variance report agrees with the settled trip.
Done: float out + sales in − cash returned = zero, in the van's treasury account and not only on the trip document.

### T24 · Installments — Sell now, collect for a year
Modules: Installments · Sales · Treasury · Reports
Executable: crm.ts (installments) · cross-module.ts x20

1. [ok] الأقساط ← خطط الأقساط — build a plan on a real invoice.
   - Installments: the schedule's instalments sum to exactly the plan total — no rounding leak on any line.
2. [ok] Take the down payment.
   - Treasury: a treasury movement of its own, posted like any other receipt.
3. [open] Collect an instalment.
   - Installments: unverified since the D1–D37 sweep — no route anywhere sets an instalment line to «مدفوع». Collection is a treasury voucher never linked back to the plan line, so a plan paid in full still shows every line outstanding.
4. [ok] متابعة التحصيل — create a follow-up, complete it with an outcome, cancel another.
   - Installments: outcomes are free text over a fixed set, and both terminal states stick.
5. [ok] التقارير ← الأقساط المتأخرة.
   - Reports: exactly the late line, no others.
Done: the plan's outstanding balance, the invoice's remaining balance and GL 1110 agree — today they cannot, and that is the finding.

### T25 · Platform — The machinery under all of the above
Modules: Settings · Workflow · System · Audit
Executable: platform.ts · seams.ts x56 · x57 · x58 · x61

1. [ok] الإعدادات ← الفروع / المستودعات — a second branch and a second warehouse.
   - Shell: warehouse scope narrows the stock lists and the reports correctly.
   - Shell: fixed (F32) — check it has stayed fixed. Until then, branch scope narrows nothing — a caller scoped to one branch reads the other's documents.
2. [ok] الأدوار والصلاحيات / المستخدمون — a role without a permission.
   - Settings: the dependency graph is enforced server-side.
   - Settings: fixed (F48) — check it has stayed fixed. Until then, the visibility tiers it grants (view_own, view_cost) are enforced by no route, so a plain viewer reads every colleague's invoice, its unit cost, and HR salaries.
3. [ok] إعدادات الموافقات — put a confirm behind an approval chain.
   - Workflow: approve, reject and request-modification all work.
   - Workflow: fixed (F18) — check it has stayed fixed. Until then, an admin's approve still bypasses the chain.
4. [ok] تسلسلات الترقيم — change a prefix.
   - Settings: it affects the next document only, never a posted one. Eight simultaneous confirms take eight distinct, gap-free numbers, and a failed confirm burns none.
   - Settings: fixed (F50) — check it has stayed fixed. Until then, numbering is tenant-global — two branches share one counter and nothing on the number says where it came from.
5. [ok] قواعد الإشعارات / الويب هوك / مفاتيح API.
   - Platform: a confirm fires its rule and attempts its webhook; neither can duplicate the document or roll it back, and retries are bounded. Only emitted events may be subscribed to.
6. [ok] نقل البيانات — import opening balances and history.
   - Settings: the commit is all-or-nothing.
   - Accounting: fixed (F41) — check it has stayed fixed. Until then, a historical import records no opening AR or AP at all — a migrated business owes and is owed nothing in its ledger.
7. [open] قوالب الطباعة / إعدادات الباركود — print an invoice and a label.
   - Print: Arabic must render offline in the PDF, and the invoice must carry what an Egyptian invoice legally carries.
8. [ok] سجل المراجعة — every money-moving action names who, where and what.
   - Audit: fixed (F47) — check it has stayed fixed. Until then, rows written by an all-branches caller carry branchId: null, so the branch filter can never find them again.
9. [open] النظام ← حالة النظام — backup, restore, licensing and entitlements.
   - System: unverified since the D1–D37 sweep — module licensing is designed but not enforced — every module answers regardless of what the tenant is entitled to.
Done: a second user, in a second branch, with a narrower role, can do their job and cannot see or do anything outside it — and everything they did is in the audit log with their name on it.

### T26 · Shell — The app around the documents
Modules: Shell · Dashboard · Reports · Settings
Executable: shell.ts · cross-module.ts x17

1. [ok] Every screen has a URL.
   - Shell: #/sales/quotes/new, #/sales/sales-invoices/INV-000007 — reload it, share it, hit Back. A create form with no address cannot be linked or reloaded.
2. [open] Breadcrumbs walk back up.
   - Shell: on a document opened by id the last crumb is the raw id — worth fixing when the numbering lands.
3. [ok] The command palette and the global search.
   - Shell: fixed (F49) — check it has stayed fixed. Until then, there is no server-side search, and the client filter cannot forgive Arabic — «احمد» finds nothing for «أحمد», «ليلي» nothing for «ليلى».
4. [ok] The branch and warehouse pickers.
   - Shell: fixed (F32) — check it has stayed fixed. Until then, warehouse scope narrows أرصدة المخزون and the reports; branch scope does not.
5. [ok] Theme and language.
   - Shell: both themes and both languages on every screen; the tree re-labels itself without a reload, and RTL mirrors rather than merely translating.
6. [ok] The dashboard's tiles against the ledger.
   - Dashboard: cash and payables agree with the accounts they claim to summarise.
   - Dashboard: fixed (F54) — check it has stayed fixed. Until then, receivables does not — the tile sums every 11xx asset account while the aging report covers trade AR only, a 5,486.12 disagreement that is a scope question, not arithmetic.
7. [ok] الموافقات inbox and the notification bell.
   - Workflow: the inbox count, the bell count and the pending requests are the same number.
Done: nothing on the dashboard is a number the rest of the app cannot reproduce, and every screen can be reached, linked and reloaded.

### T27 · Sales — The customer master record
Modules: Sales · Accounting · Reports · Settings
Executable: sales.ts · crm.ts

1. [ok] المبيعات ← العملاء — create with code, terms, currency, category and price list.
   - Sales: an empty code auto-numbers; a duplicate code is refused.
   - Settings: the generated code follows تسلسلات الترقيم, not a private format.
2. [open] Set an opening balance on a new customer.
   - Accounting: it must reach GL 1105 as an opening entry, not sit on the record as a decorative number.
3. [open] Mark one customer معفى من الضريبة and set the ETA buyer type.
   - Sales: their invoices carry no VAT at all — asserted by cross-module x33.
4. [ok] Open the customer detail and its statement.
   - Sales: opening balance, every confirmed invoice, every return, every allocated collection, running balance.
   - Reports: the statement's closing balance equals the customer's row in أعمار ديون العملاء.
5. [open] Deactivate a customer who has documents.
   - Sales: they leave the pickers and stay in the reports — history is not deleted by deactivation.
6. [ok] Search the list by an Arabic name typed without its hamza.
   - Shell: fixed (F49) — check it has stayed fixed. Until then, no match. Search is client-side and does not normalise Arabic.
Done: the customer's statement, the aging report and GL 1105 tell the same story about the same person.

### T28 · Purchases — The supplier master record
Modules: Purchases · Accounting · Reports
Executable: purchases.ts

1. [ok] المشتريات ← الموردون — create with code, payment terms, currency and category.
   - Purchases: duplicate codes are refused; an empty code auto-numbers.
2. [ok] Read the balance column on the list.
   - Purchases: it is the live payable, and it equals that supplier's row in أعمار ديون الموردين. Until F39–D39 it rendered the opening balance under a payable header.
3. [ok] Open the supplier detail and its statement.
   - Purchases: opening balance, confirmed invoices, returns, landed costs, allocated payments, running balance.
   - Reports: the statement's closing balance equals the supplier's row in أعمار ديون الموردين.
4. [open] Set payment terms of 60 days and raise an invoice.
   - Purchases: the due date is derived from the terms, and the aging buckets follow the due date, not the document date.
Done: what the supplier statement says is owed, what the aging report says, and what GL 2100 carries are one number.

### T29 · Sales — The paths that must be refused
Modules: Sales · Accounting
Executable: sales.ts

1. [ok] Create an invoice line with quantity zero.
   - Sales: refused.
2. [ok] Post an invoice with an empty lines array.
   - Sales: refused at the wire boundary, before any domain check runs.
3. [ok] Enter a negative unit price.
   - Sales: refused server-side, not merely by the input's min attribute.
4. [ok] Apply a percent discount above 100, then an amount discount below zero.
   - Sales: both refused at the wire.
5. [ok] Discount an invoice to a zero total and try to confirm it.
   - Sales: the total floors at zero rather than going negative, and a zero-total invoice cannot be confirmed.
6. [ok] Confirm the same invoice twice, and convert an already-converted quote.
   - Sales: both refused with 409, not silently repeated.
7. [ok] Accept a quote that was never sent.
   - Sales: refused — the lifecycle is a state machine, not a set of buttons.
8. [stop D38] Post a quote or invoice line carrying an itemId that is not in the catalogue.
   - !Sales: accepted. Neither line schema checks the id against the item repository, so an invented id reaches the document, the report and the ledger with a plausible name beside it.
Done: every refusal is in Arabic, names what is wrong, and leaves the document exactly as it was.

### T30 · Purchases — Partial receipts and over-receipt
Modules: Purchases · Inventory
Executable: purchases.ts

1. [open] Raise a PO for 100 units and receive 40.
   - Purchases: the PO goes مستلم جزئياً and the line's receivedQty is 40.
   - Inventory: stock rises by 40 only.
2. [open] Receive the remaining 60.
   - Purchases: the PO goes مستلم بالكامل; a further receipt against it is refused.
3. [open] Try to receive more than was ordered.
   - Purchases: refused, or accepted only against an explicit tolerance — either way the answer must be deliberate and visible on the screen.
4. [ok] Confirm an already-confirmed PO, receipt or invoice.
   - Purchases: 409, all three.
Done: the sum of the receipts equals the ordered quantity, and no receipt can invent stock the order never covered.

### T31 · Inventory — Templates, specifications and configurable products
Modules: Inventory · Manufacturing · Sales
Executable: inventory.ts · §7 §2–4, §13

1. [open] المخزون ← المواصفات — define a specification and its values.
   - Inventory: values are ordered and reusable across items.
2. [open] المخزون ← قوالب المنتجات — build a template from two specifications.
   - Inventory: the variant matrix is the product of the value sets, and the count is stated before generation.
3. [open] المخزون ← المنتجات القابلة للتهيئة — generate the variants.
   - Inventory: each variant is a real item with its own code, barcode and stock position — not a label on one shared item.
4. [open] Sell one variant.
   - Inventory: only that variant's stock falls.
5. [open] التصنيع ← التصنيع المخصص — configure an instance for a customer order.
   - Manufacturing: the instance carries its own component list and price without editing the template.
Done: a variant behaves exactly like an ordinary item everywhere downstream — stock, costing, reports and print.

### T32 · Inventory — Transfers, in-transit and the refusals
Modules: Inventory · Accounting · Settings
Executable: inventory.ts

1. [ok] Transfer stock between two warehouses.
   - Inventory: quantity and value leave one and arrive at the other; the company total is unchanged.
   - Accounting: no GL entry — nothing left the company.
2. [open] Transfer into مخزون بالطريق, then receive it at the destination.
   - Inventory: in-transit holds the value while it is neither here nor there, and the destination's cost re-averages on arrival.
3. [open] Transfer more than the source holds.
   - Inventory: refused, with the available quantity recomputed server-side.
4. [open] Transfer to the same warehouse.
   - Inventory: refused.
5. [ok] Narrow the warehouse scope in the shell and re-open أرصدة المخزون.
   - Shell: the list narrows to the scoped warehouses only.
Done: every unit is in exactly one place at every moment, and the sum across warehouses never changes on a transfer.

### T33 · Inventory — Every adjustment reason and what it posts
Modules: Inventory · Accounting
Executable: inventory.ts · cross-module.ts x14

1. [ok] INITIAL_STOCK — open a position.
   - Accounting: Dr 1200 / Cr 3100.
2. [open] DAMAGE / SHRINKAGE — write stock off.
   - Accounting: Dr an expense or provision / Cr 1200, at weighted-average cost.
3. [ok] PHYSICAL_COUNT — book a counted difference.
   - Accounting: fixed (F35) — check it has stayed fixed. Until then, no entry at all; the sub-ledger moves alone.
4. [open] An adjustment IN with a unit cost.
   - Inventory: the position's weighted-average cost re-averages; it does not simply take the new cost.
5. [open] Reverse or void a confirmed adjustment.
   - Accounting: by reversal, never by edit — and the reversal is visible in سجل المخزون.
Done: every reason code has one, stated, balanced posting, and the reason is on the movement so a report can group by it.

### T34 · Inventory — Labels and barcodes
Modules: Inventory · Settings · Print
Executable: §7 §9 · §11 §13

1. [open] الإعدادات ← إعدادات الباركود — pick the symbology and the code source.
   - Settings: the setting is tenant-wide and persists across a reload.
2. [open] المخزون ← طباعة الملصقات — print in all three sizes.
   - Print: each size renders the price, the name and a scannable barcode within its own bounds.
3. [open] Print a label for an item with a long Arabic name.
   - Print: the name wraps or truncates deliberately — it never overlaps the barcode.
4. [open] Scan a printed label at the invoice line.
   - Sales: the scan resolves to the same item the label was printed for.
Done: a label printed from this screen scans back to its own item on the till.

### T35 · Inventory — Write-downs and the aging bands
Modules: Inventory · Accounting · Reports
Executable: cross-module.ts x14

1. [ok] المخزون ← هبوط قيمة المخزون — run a write-down over the aging bands.
   - Accounting: the charge goes to the P&L through a provision account; GL 1200 keeps its gross value and the reconciliation stays exact.
2. [open] Re-run the same period.
   - Inventory: the second run charges only the incremental provision, not the whole amount again.
3. [ok] Open أعمار المخزون and انحراف تقييم المخزون.
   - Reports: the aging bands sum to the valuation total.
Done: the provision on the balance sheet equals the sum of the write-down runs, and gross stock value is never quietly rewritten.

### T36 · Manufacturing — The production floor's own screens
Modules: Manufacturing · Inventory · Reports
Executable: §7 §11–14

1. [open] التصنيع ← لوحة الإنتاج — read the open work orders and their stages.
   - Manufacturing: the counts match the work-order list under the same filters.
2. [open] Raise a work order for a BOM whose components are short.
   - Inventory: the shortage is named before issue, not discovered at completion.
3. [open] Record scrap on a work order.
   - Inventory: scrapped material leaves stock at cost and is visible as scrap, not as output.
4. [open] Change a BOM that has open work orders against it.
   - Manufacturing: open orders keep the recipe they were raised with.
5. [open] التقارير ← التصنيع أم الشراء.
   - Reports: produced cost vs purchase price, per item, over a chosen window.
Done: the floor's view of what is in progress and the ledger's view of what has been consumed never contradict each other.

### T37 · Accounting — The chart of accounts as a structure
Modules: Accounting · Settings · Reports
Executable: accounting.ts · §8 §دليل الحسابات

1. [ok] Add a posting account under a group account.
   - Accounting: type and nature are inherited; the code fits the parent's range.
2. [open] Try to post to a group account.
   - Accounting: refused — only leaf accounts take entries.
3. [open] Try to give a posting account with movements a child.
   - Accounting: refused, or the account is converted only when it has no entries.
4. [open] Deactivate an account that carries a balance.
   - Accounting: refused or warned — a balance cannot be hidden by deactivation.
5. [ok] Re-run the trial balance.
   - Reports: the new account appears with its movements, in code order, under the right section.
Done: the chart's shape and the financial statements' shape are the same shape.

### T38 · Accounting — Cost centres end to end
Modules: Accounting · Treasury · Reports
Executable: seams.ts x26

1. [ok] المحاسبة ← مراكز التكلفة — create two centres.
   - Accounting: codes are unique; a centre can be deactivated without deleting its history.
2. [ok] Tag a journal entry line to one of them.
   - Reports: أرباح مراكز التكلفة counts it once, and the income statement counts it once.
3. [ok] Pay an expense by treasury voucher and try to tag it.
   - Treasury: fixed (F44) — check it has stayed fixed. Until then, there is no field — the expense lands in «غير مخصص», which is where most real spending ends up.
4. [open] Run the cost-centre P&L for a period with no tagged activity.
   - Reports: an honest empty state, not a zero-filled table.
Done: the sum of the cost centres plus «غير مخصص» equals the income statement, exactly.

### T39 · Accounting — The e-invoicing screen
Modules: Accounting · Sales · Settings
Executable: seams.ts x29 · platform.ts D5

1. [open] المحاسبة ← الفاتورة الإلكترونية — read the queue and its states.
   - Tax: submitted, accepted, rejected and pending are distinguishable, with the authority's reason on a rejection.
2. [ok] Turn auto-submit on and confirm a sales invoice.
   - Tax: fixed (F33) — check it has stayed fixed. Until then, nothing is enqueued — the producer does not exist.
3. [open] Retry a failed submission.
   - Tax: retrying never creates a second submission for the same invoice.
4. [open] Print an invoice that has been accepted.
   - Print: the QR code and the authority's UUID are on the printed document.
Done: every confirmed invoice is either in the queue, accepted with its UUID, or explicitly excluded — with no fourth state.

### T40 · Treasury — Every voucher type, one at a time
Modules: Treasury · Accounting · Sales · Purchases · HR
Executable: cross-module.ts x0 · x2 · x3 · x11 · §8 §السندات

1. [ok] Customer collection, supplier payment.
   - Accounting: each hits its own control account and the treasury account named on the voucher.
2. [ok] Capital injection, owner withdrawal.
   - Accounting: equity moves, not revenue or expense.
3. [ok] Expense payment, other income.
   - Accounting: the counter-account is chosen on the voucher and appears on the entry.
4. [ok] Employee advance, payroll disbursement.
   - HR: the advance's schedule and the payroll's net both settle through the treasury, not through a private account.
5. [ok] Treasury transfer.
   - Treasury: one entry, two treasury accounts, no net change.
6. [open] Under-collection and bounced-cheque vouchers.
   - Accounting: 1320 and 1360 carry them, and each has a documented way back out.
Done: the ten types cover every way money enters or leaves, and each one names both the treasury account and the counter-account on its face.

### T41 · Treasury — Approvals, reversal and the audit line
Modules: Treasury · Workflow · Audit
Executable: accounting.ts · platform.ts

1. [ok] Put voucher confirm behind an approval chain and confirm as a non-admin.
   - Workflow: the voucher holds as pending, and the ledger does not move.
2. [ok] Approve it.
   - Accounting: it posts once, on approval, with the approver named.
3. [ok] Reverse a confirmed voucher.
   - Accounting: the treasury, the counter-account and the trial balance return to their exact prior values.
4. [ok] Filter the audit log by branch for those actions.
   - Audit: fixed (F47) — check it has stayed fixed. Until then, rows written by an all-branches caller carry branchId: null and never appear under their document's branch.
Done: no money moves without a named actor, and everything that moved can be walked back out the way it came in.

### T42 · HR — Employees, departments and job titles
Modules: HR · Settings · Reports
Executable: hr.ts · §9 §2–4

1. [open] الأقسام — create a department, nest one under it.
   - HR: the tree is real; deleting a parent with children is refused.
2. [open] المسميات الوظيفية — create a job title and attach a salary band.
   - HR: the band is guidance on the contract form, not a second source of truth for pay.
3. [ok] الموظفون — create an employee with a code, branch, department and title.
   - HR: duplicate codes refused; the branch scopes them everywhere downstream.
4. [open] Walk the status transitions to termination.
   - HR: a terminated employee is excluded from the next payroll run and stays in history.
5. [open] لوحة الموارد البشرية — the headcount tiles.
   - Reports: the tiles equal the list counts under the same filters.
Done: one employee record drives the org tree, the payroll run and the reports without being retyped anywhere.

### T43 · HR — Contracts, holidays and attendance
Modules: HR · Reports
Executable: hr.ts · §9 §5–7

1. [open] العقود — a fixed-term and an open-ended contract.
   - HR: pay, allowances and the period are on the contract, not on the employee.
2. [open] Let a fixed-term contract lapse.
   - !HR: known behaviour — it keeps reporting «ساري» past its end date.
3. [open] الإجازات الرسمية — add a public holiday inside the period.
   - HR: attendance and leave both treat it as non-working, and payroll does not deduct for it.
4. [open] الحضور والانصراف — record absence, lateness and overtime.
   - HR: each maps to a payroll consequence that the payslip names.
Done: the payslip's working days, the attendance record and the holiday calendar agree for every employee in the period.

### T44 · HR — The payroll run, state by state
Modules: HR · Accounting · Treasury
Executable: hr.ts

1. [ok] الرواتب — create a run for the month.
   - HR: مسودة, with the scope notice naming every rule this build does not compute.
2. [ok] Calculate it.
   - HR: gross − deductions = net, per payslip and for the run.
3. [ok] Approve it.
   - HR: exactly one advance instalment is recovered per employee with an open advance.
4. [ok] Disburse it.
   - Accounting: one balanced entry; the treasury falls by exactly the net.
5. [ok] Try each transition from the wrong state.
   - HR: refused in Arabic, every time.
6. [open] Re-run a month that already has an approved run.
   - HR: refused or explicitly a correction run — never a silent duplicate.
Done: the run's net, the payslips' sum, the journal entry and the treasury movement are one number in four places.

### T45 · HR — Advances and the whole leave stack
Modules: HR · Treasury · Reports
Executable: hr.ts · §9 §9–14

1. [ok] سلف الموظفين — request, approve, disburse, recover.
   - Treasury: disbursement leaves the cash box; recovery comes back through payroll.
   - HR: the instalment split sums exactly, by largest remainder.
2. [open] سياسات الإجازات — define an accrual policy.
   - HR: the policy drives the balance; the balance is not typed in by hand.
3. [open] استحقاقات الإجازات — run an accrual batch.
   - HR: each employee's balance rises by the policy's rate, once, for that period.
4. [ok] طلبات الإجازات — request more days than the balance holds.
   - HR: refused with the available balance named.
5. [open] Approve an unpaid leave and run payroll.
   - HR: the deduction is prorated exactly for the days taken.
6. [open] إجازاتي — the same request from the employee's own screen.
   - HR: self-service sees only their own balances and requests.
Done: balance = accruals − approved leave, on the balances screen and inside the payroll calculation, with no third answer.

### T46 · Reports — The sales five
Modules: Reports · Sales
Executable: shell.ts SCN-RPT-*

1. [ok] المبيعات حسب الفترة.
   - Reports: the period total equals the sum of confirmed invoices minus returns for the same window.
2. [ok] المبيعات حسب العميل, حسب الصنف, حسب المندوب.
   - Reports: each grouping sums to the same grand total as the period report.
3. [ok] أفضل المنتجات — with a limit.
   - Reports: the limit narrows the rows and the ranking stays by value, not by insertion order.
4. [open] Drill from a report row to the documents behind it.
   - Reports: the drill-down lists exactly the documents the figure was built from.
Done: four ways of slicing one month all produce the same grand total, and that total equals revenue in the income statement.

### T47 · Reports — Purchases, aging and collections
Modules: Reports · Purchases · Sales · Installments
Executable: shell.ts · accounting.ts

1. [ok] المشتريات حسب الفترة / المورد / الصنف.
   - Reports: the three groupings agree on the grand total.
2. [ok] أعمار ديون العملاء against the dashboard's receivables tile.
   - Dashboard: fixed (F54) — check it has stayed fixed. Until then, they disagree by 5,486.12 — the tile's scope is every 11xx account, the report's is trade AR.
3. [ok] أعمار ديون الموردين against GL 2100.
   - Reports: the aging total equals the payables control account, less what D18 has left adrift.
4. [ok] الأقساط المتأخرة and نظرة عامة على الأقساط.
   - Reports: the overdue list is exactly the late lines; the overview's outstanding equals the plans' remaining.
Done: every aging bucket is a slice of a control account, and the sum of the buckets is that account.

### T48 · Reports — The eight inventory reports
Modules: Reports · Inventory
Executable: shell.ts SCN-RPT-16 · inventory.ts

1. [ok] مستويات المخزون and أرصدة المخزون.
   - Reports: the same on-hand quantity per item and warehouse, under the same scope.
2. [ok] حركة المخزون and سجل المخزون.
   - Reports: every movement has a document behind it, and the running balance ends at today's on-hand.
3. [ok] تقييم المخزون against GL 1200.
   - Reports: equal, to the piastre, on a tenant with no open receipts.
4. [ok] أعمار المخزون, أصناف قاربت على الانتهاء, أصناف بطيئة الحركة.
   - Reports: the three answer over the same population and never disagree about what is on hand.
5. [ok] انحراف تقييم المخزون with the type filter.
   - Reports: fixed (F53) — check it has stayed fixed. Until then, cacheDrift is nonzero on a healthy tenant because landed costs write no movement.
Done: eight reports over one sub-ledger, and the valuation total equals the control account.

### T49 · Reports — How a report behaves, not what it says
Modules: Reports · Shell · Print
Executable: shell.ts

1. [open] Run every report with no filters, then with a narrow date window.
   - Reports: the narrow run is a subset; the totals row recomputes rather than staying stale.
2. [open] Pick a preset (this month, last month, this year) on each report.
   - Reports: the dates the preset sets are visible and editable, not hidden.
3. [open] Run a report over a window with no data.
   - Reports: an honest empty state, not a zero-filled table pretending to be a result.
4. [open] Export to Excel and print.
   - Print: the export carries the same rows and totals as the screen, with Arabic intact.
5. [open] Reload a report screen by URL.
   - Shell: the filters and the result come back, because they are in the address.
Done: what you see, what you export and what you print are the same report.

### T50 · Settings — Company, branches and warehouses
Modules: Settings · Shell · Accounting
Executable: platform.ts · §11 §4–6

1. [open] الإعدادات ← عام — company identity, tax number, base currency, fiscal year start.
   - Print: the identity reaches the printed invoice; the tax number appears where the law requires it.
2. [open] Change the base currency after documents exist.
   - Accounting: refused, or an explicit, warned migration — never a silent relabel.
3. [ok] الفروع — add a branch, deactivate one.
   - Shell: the picker updates; a deactivated branch keeps its history.
4. [ok] المستودعات — add one under a branch, of each type (main, transit, van).
   - Inventory: the type decides where transfers may land; a van warehouse pairs with a van treasury.
5. [ok] Scope a user to one branch and read the other's documents.
   - Shell: fixed (F32) — check it has stayed fixed. Until then, nothing narrows — branch scope is not enforced on the read routes.
Done: the branch a document was raised in is on the document, in the audit row, and in every scoped list — or the scope is honestly labelled as not yet enforced.

### T51 · Settings — Users, roles and the permission matrix
Modules: Settings · Audit · Every module
Executable: platform.ts · seams.ts x58

1. [ok] الأدوار والصلاحيات — build a role from the ~286-permission matrix.
   - Settings: the dependency graph is enforced — granting confirm implies view.
2. [ok] المستخدمون — create a user, assign the role, set branch and warehouse scope.
   - Settings: the PIN is set by the user, and the role can be changed without recreating them.
3. [ok] Sign in as that user and hit a guarded route.
   - Every module: 403 without the permission, and the action is hidden rather than dead on the screen.
4. [ok] Give a user only the view tier and read a colleague's invoice and its unit cost.
   - Every module: fixed (F48) — check it has stayed fixed. Until then, the visibility tiers are enforced by no route — view_own and view_cost are decorative.
5. [open] Remove a permission from a role while its holder is signed in.
   - Settings: the next request is refused; a stale session does not keep the old rights.
Done: every screen a user can reach is one their role grants, and every refusal is a 403 from the server, not a hidden button.

### T52 · Settings — Numbering, print templates and barcode
Modules: Settings · Print · Every document
Executable: platform.ts · seams.ts x56 · x57

1. [ok] تسلسلات الترقيم — change a prefix and a padding length.
   - Every document: the next document takes the new format; posted documents keep theirs.
2. [ok] Confirm eight documents at once.
   - Every document: eight distinct, gap-free numbers, and a failed confirm burns none.
3. [ok] Sell from two branches on the same day.
   - Settings: fixed (F50) — check it has stayed fixed. Until then, one tenant-wide counter, and nothing on the number says which branch raised it.
4. [open] قوالب الطباعة — the nine template tabs and a per-document override.
   - Print: the override wins for that document only; the tab's setting is the default for the rest.
5. [open] Print A4 and thermal for the same invoice.
   - Print: both carry the legal content, both render Arabic offline, and the thermal receipt fits its width.
Done: a document's number and its printed face are both decided by settings a tenant can see and change, not by code.

### T53 · Settings — Integrations, notifications and keys
Modules: Settings · Platform · Audit
Executable: platform.ts · seams.ts x30

1. [ok] مفاتيح API — issue a key, use it, revoke it.
   - Platform: the key is shown once; a revoked key is refused immediately.
2. [ok] الويب هوك — subscribe to an emitted event, then to one that is not emitted.
   - Platform: only emitted events may be subscribed to.
3. [ok] Confirm a document and watch the delivery.
   - Platform: retries are bounded, and a failing webhook never rolls back or duplicates the document.
4. [ok] قواعد الإشعارات — a rule on document confirm.
   - Shell: the bell count and the panel agree, and mark-all-read sticks across a reload.
5. [open] Delete a rule that has fired.
   - Platform: past notifications survive the rule's deletion.
Done: an integration can fail loudly without ever changing what the ledger says.

### T54 · Settings — Migration, backup and the licence
Modules: Settings · System · Accounting
Executable: platform.ts D16 · cross-module.ts x31 · x32 · x38

1. [ok] نقل البيانات — import a file with one bad row.
   - Settings: all-or-nothing — nothing is committed, and the bad row is named.
2. [ok] Import outstanding customer and supplier invoices.
   - Accounting: fixed (F41) — check it has stayed fixed. Until then, aR and AP move by 0.00 — the opening entry's branch never runs because the import is wired without gl/accounts.
3. [open] النظام ← حالة النظام — take a backup, restore it into a fresh install.
   - System: the restored tenant produces the same trial balance, to the piastre.
4. [open] Remove a module from the licence and use it.
   - System: unverified since the D1–D37 sweep — it answers anyway — entitlement is designed but not enforced.
5. [open] Run the app with the licence expired.
   - System: a clear, Arabic, non-destructive block — never data loss and never a silent read-only mode.
Done: a tenant can leave with their data and come back with it, and the books survive the round trip unchanged.

### T55 · Workflow — The approvals inbox
Modules: Workflow · Sales · Treasury · Audit
Executable: platform.ts

1. [ok] إعدادات الموافقات — a chain on sales-invoice confirm and on voucher confirm.
   - Workflow: the chain names the step, the approver role and the order.
2. [ok] Submit as a non-admin and approve.
   - Sales: the document posts once, on approval, with the approver on the audit row.
3. [ok] Reject, and request a modification.
   - Workflow: rejection is terminal for that submission; a modification request returns it to the author with the note.
4. [ok] Approve as an admin.
   - Workflow: fixed (F18) — check it has stayed fixed. Until then, the chain is bypassed entirely.
5. [ok] الموافقات — the inbox, its counts and its filters.
   - Shell: the inbox count equals the pending requests the user may act on.
Done: nothing behind a chain posts without an approval, and every approval names a person.

### T56 · Shell — Navigation, URLs and state that survives a reload
Modules: Shell
Executable: shell.ts SHL-01..06

1. [ok] Open every nav entry and check the heading matches.
   - Shell: 17 groups, every item reaches a real screen — none dead-ends.
2. [ok] Collapse a group, collapse the rail, reload.
   - Shell: both persist; the active item stays indicated.
3. [ok] Deep-link to a document, a create form and a report.
   - Shell: all three reload into the same state, and Back returns to the list.
4. [ok] Change the branch and warehouse scope and reload.
   - Shell: the scope persists, and the warehouse list cascades from the branch.
Done: the address bar describes the screen well enough to send it to a colleague.

### T57 · Shell — Keyboard, command bar and search
Modules: Shell
Executable: shell.ts SHL-07..16

1. [ok] ⌘K from anywhere.
   - Shell: the command bar focuses, filters as you type and routes with the keyboard alone.
2. [ok] `?` for the shortcut list, `g` + letter to jump, ⌘N to create, ⌘S to save.
   - Shell: ⌘S never surfaces the browser's own Save dialog.
3. [open] `j`/`k` on a table.
   - Shell: currently dead — either wire it or drop it from the shortcut list.
4. [ok] Type into a text field and press `g`.
   - Shell: the literal character wins; shortcuts do not fire while typing.
5. [ok] Search a customer by an Arabic name without its hamza.
   - Shell: fixed (F49) — check it has stayed fixed. Until then, no result — no server-side search, and no Arabic normalisation on either side.
Done: a data-entry clerk can raise a document without touching the mouse, and the search finds what they typed.

### T58 · Shell — Theme, language and RTL
Modules: Shell · Settings
Executable: shell.ts SHL-17..18 · §11 §1–2

1. [ok] Toggle the theme on every module's list and detail.
   - Shell: both themes are legible; no token resolves to a colour that only exists in one of them.
2. [ok] Switch to English and back.
   - Shell: direction flips live, the nav re-labels without a reload, and the choice persists.
3. [open] Check numerals, dates and currency in both languages.
   - Shell: Arabic-Indic vs Latin numerals are a deliberate choice, applied consistently, and dates never silently switch order.
4. [open] Check a mixed Arabic/Latin string — a code inside an Arabic sentence.
   - Shell: bidi is correct; the code does not jump to the wrong end of the sentence.
Done: nothing in either theme or either language is unreadable, mirrored the wrong way, or left in the other language.

### T59 · Dashboard — Every tile against its source
Modules: Dashboard · Accounting · Sales · Purchases · Reports
Executable: shell.ts DSH-01..12 · cross-module.ts x17

1. [ok] The KPI strip against /dashboard/summary and the ledger.
   - Accounting: cash and payables agree with the accounts they claim to summarise.
2. [ok] Receivables against أعمار ديون العملاء.
   - Dashboard: fixed (F54) — check it has stayed fixed. Until then, 47,079.28 vs 52,565.40 — the tile's scope is every 11xx account.
3. [ok] The period toggle.
   - Dashboard: every figure that depends on the period changes, and none that should not.
4. [ok] The aging matrix, the expense donut and the top-items list.
   - Reports: each equals its own report under the same window.
5. [ok] The needs-attention queue.
   - Dashboard: each row links to a screen whose filtered count is the number on the tile.
6. [open] The error and retry state.
   - Dashboard: with the API down, an honest failure and a retry that works — never a zeroed dashboard.
Done: every number on the dashboard can be reproduced on another screen in two clicks.

### T60 · Hubs — The nine overview screens
Modules: Shell · Every module
Executable: shell.ts HUB-01..10

1. [open] Open each hub: sales, purchases, inventory, manufacturing, accounting, treasury, CRM, assets, production, system.
   - Shell: each hub's tiles equal its module's list counts under the same scope.
2. [open] Click through every hub tile.
   - Shell: each lands on the screen it names, pre-filtered to what the tile counted.
3. [open] Read each hub with an empty tenant.
   - Shell: honest zeros and a way to create the first record.
Done: a hub is a filtered view of its module, never a second set of numbers.

### T61 · Every document — Draft, confirm, cancel, void
Modules: Sales · Purchases · Inventory · Treasury · Accounting
Executable: sales.ts · purchases.ts · accounting.ts

1. [open] For each of the twelve document types, save a draft and reload.
   - Every module: the draft persists with every field, and nothing has posted.
2. [ok] Confirm each one.
   - Accounting: exactly one balanced entry, one number issued, one set of movements.
3. [ok] Confirm each one a second time.
   - Every module: 409, and no second entry.
4. [open] Cancel a draft, and try to cancel a confirmed document.
   - Every module: a draft cancels cleanly; a confirmed one is corrected by return, reversal or void — never by edit and never by delete.
5. [open] Void a confirmed document where voiding exists.
   - Accounting: the reversal is a new entry that references the original, and both remain readable.
6. [open] Delete anything at all.
   - Accounting: there is no delete for a posted document, anywhere, for anyone.
Done: the twelve lifecycles behave identically at their common states, and the ledger only ever grows.

### T62 · Concurrency — Two people, one second
Modules: Every module · Accounting · Settings
Executable: seams.ts x56 · cross-module.ts x35

1. [ok] Fire eight confirms simultaneously on eight documents.
   - Settings: eight distinct, gap-free numbers.
2. [ok] Retry the same confirm with the same request id.
   - Accounting: one journal entry, one stock movement — the retry is idempotent, not a second posting.
3. [open] Two users edit the same draft.
   - Every module: the second save is refused or merged deliberately — never a silent overwrite.
4. [open] Two tills sell the last unit of one item at the same moment.
   - Inventory: one succeeds, one is refused; stock never goes negative behind the guard.
Done: no sequence of simultaneous actions can produce a duplicate number, a duplicate posting or negative stock.

### T63 · Money — Rounding as a property, not an example
Modules: Accounting · Sales · Purchases
Executable: seams.ts x52 · cross-module.ts x34

1. [ok] Post forty awkward documents — odd quantities, odd rates, line and header discounts.
   - Accounting: every one balances to the piastre; the allocations sum exactly to their totals.
2. [ok] Allocate a header discount across three lines that do not divide evenly.
   - Accounting: largest-remainder — the parts sum to the whole, and the same input always allocates the same way.
3. [open] Check any money value rendered anywhere for float artefacts.
   - Shell: no 478.79999, no 0.1+0.2 — money crosses the wire as a decimal string and is parsed as Money.
4. [open] Set the tenant's rounding to the nearest 5 piastres, if the setting exists.
   - Accounting: rounding happens only at the named boundaries, and the difference lands in a rounding account rather than vanishing.
Done: the sum of the lines equals the header, the sum of the allocations equals the payment, and no report has to be told which figure to believe.

### T64 · Volume — Five years of data on a shop laptop
Modules: Every module · Reports · System
Executable: seams.ts x54 (design) — measure, do not guess

1. [open] Seed five years: ~60k invoices, ~200k journal lines, ~15k items.
   - System: the database file size and the backup time are recorded, not assumed.
2. [open] Open every list screen.
   - Shell: first paint under two seconds, with paging or virtualisation — never the whole table.
3. [open] Run the trial balance, the general ledger and the inventory valuation.
   - Reports: each answers in seconds, and the query plan uses an index rather than a scan.
4. [open] Confirm a document.
   - Accounting: posting latency does not grow with history — numbering and posting are indexed, not scanned.
5. [open] Restart the app.
   - System: startup time is unchanged from an empty tenant, within reason.
Done: the fifth year feels like the first, on the machine the desktop edition actually ships to.

### T65 · Desktop — Genuinely offline
Modules: System · Every module · Print
Executable: manual, on the packaged build

1. [open] Pull the network and do a full day: sell, buy, pay, report, print.
   - Every module: nothing hangs, nothing silently fails, no spinner waits on a server that is not there.
2. [open] Confirm an invoice with auto-submit to the authority switched on.
   - Tax: it queues and says so — the only thing that may not complete offline, stated plainly.
3. [open] Reload the packaged app from file://.
   - Shell: hash routing survives; no route 404s because a dev server is not there to rewrite it.
4. [open] Kill the app mid-confirm.
   - Accounting: on restart, either the document posted completely or not at all.
Done: the shop keeps trading with the internet down, and the books are intact when it comes back.

### T66 · System — Backup, restore and the one machine that holds the books
Modules: System · Settings · Accounting
Executable: manual

1. [open] Take a backup while the app is in use.
   - System: consistent, timestamped, and the size is stated before it is written.
2. [open] Restore it into a clean install.
   - Accounting: same trial balance, same document numbers, same audit rows.
3. [open] Restore a backup taken on an older version.
   - System: migrations run on restore, or the restore is refused with the version named — never a half-migrated tenant.
4. [open] Two tills on a LAN against one machine.
   - System: both post to the same books; the second till's numbers are gap-free and its documents carry its own user.
Done: the business can lose the machine and not the year.

### T67 · Accessibility — A keyboard-only day
Modules: Shell · Every module
Executable: manual, plus the a11y agent

1. [open] Raise an invoice using the keyboard alone.
   - Shell: every field is reachable in a sane order, every control has a visible focus ring, and no trap holds the tab.
2. [open] Check every form field has a real label.
   - Shell: an accessible name on each input — not a floating caption div.
3. [open] Read a document screen with a screen reader in Arabic.
   - Shell: headings are a real outline, status pills announce their state, and the table has headers.
4. [open] Check contrast in both themes on the busiest screens.
   - Shell: every text/background pair passes; anything failing on every screen is the measurement, not the product.
5. [open] Check target sizes and motion.
   - Shell: touch targets are large enough for a counter, and prefers-reduced-motion is honoured.
Done: the fastest way to use Mezan is the keyboard, and nothing on any screen is unreachable without a mouse.

### T68 · Localisation — Arabic first, English second
Modules: Shell · Every module · Print
Executable: scripts/i18n · §11 §1

1. [open] Walk every screen in Arabic looking for a raw catalogue key or an English fragment.
   - Shell: none — a raw key on screen is a defect, not a cosmetic issue.
2. [open] Walk the same screens in English.
   - Shell: no untranslated Arabic left behind, and the layout survives longer English strings.
3. [open] Check the accounting register in Arabic.
   - Shell: مدين/دائن, قيد, ترحيل, مرتجع — the words an Egyptian accountant uses, consistently, screen to screen.
4. [open] Check a domain refusal in both languages.
   - Every module: the error is a sentence a user can act on, never a raw enum like PERIOD_NOT_OPEN_FOR_POSTING.
5. [open] Print an invoice in both languages.
   - Print: Arabic shapes and joins correctly in the PDF, offline, with no boxes.
Done: an Arabic-first product that never leaks its plumbing in either language.

### T69 · Security — What a dishonest employee can do
Modules: Security · Settings · Audit · Every module
Executable: manual, plus the security and internal-audit agents

1. [open] Read the SQLite file directly.
   - Security: what is readable at rest is a deliberate decision, and the licence and session material are not sitting in plain text next to it.
2. [ok] Fail the PIN repeatedly.
   - Security: fixed (S6, hardened S19–S20) — a SIX-digit PIN (not four), five free attempts
     then a 60s lock doubling to a 15-minute ceiling, decaying after a quiet hour. Confirm the
     asymmetry: a REMOTE caller (through the LAN socket or `apps/server`) is counted per
     (account, source) and locks out only that source; the HOST-LOCAL console is counted per
     account and cannot be locked out by someone else's failures over the wifi. Confirm
     `POST /users/:id/unlock` (needs `admin.users.unlock`) clears it and resets the streak to
     zero — this is different from what a served lock does on its own, which steps the ladder
     down one rung rather than resetting it (see `docs/INSTALL.md` §5). `UsersPage.tsx` now
     has a "فكّ القفل" row action wired to this route, so the wait or the screen are both
     in-product recourse; calling the route directly is only needed for a scripted rollout.
3. [ok] Guess `admin@cyag.example` / `123456` against a PACKAGED build.
   - Security: fixed (S7) — refused. A packaged build seeds that account with a random,
     unprinted PIN; `123456` only ever works in a development process. See `docs/INSTALL.md`
     §1 for the real first-run path and §5 for the lockout support answer.
4. [ok] Retry `POST /bootstrap/admin` against an already-claimed tenant, naming a real admin's email.
   - Security: fixed (S1, hardened S17) — a bare 409 `TENANT_ALREADY_PROVISIONED` with NO
     session, even for a duplicate email. It used to hand back that admin's own session —
     confirm nothing does any more, including from `apps/server` (dev mount, no LAN
     allow-list) and from a LAN-connected till (blocked earlier: `/bootstrap/*` is not on the
     LAN path allow-list at all — see `apps/desktop/src/main/lan-host.ts`).
5. [open] Call the API with another user's key and a wider scope header.
   - Security: the server decides the scope from the session, never from a header the client can set.
6. [open] Backdate a document into an open period as a clerk.
   - Audit: allowed only with the permission, and the audit row shows both the document date and the entry time.
7. [open] Delete or edit a posted entry by any route you can find.
   - Accounting: impossible — and the attempt is in the audit log.
8. [ok] Reset a colleague's PIN as an admin, then check the audit log for it.
   - Audit: fixed (S23) — `CREDENTIAL_RESET_BY_ADMIN` at CRITICAL, distinct from the plain
     `UPDATE` row a phone-number edit leaves. A SELF-service PIN change (Profile screen)
     still records under the existing self-service event, not this one.
9. [open] Give a discount above the allowed ceiling, then look for the exception report.
   - Audit: overrides are reportable; if no report exists, that is the finding.
10. [ok] Point a phone's browser at the LAN host's IP on `lan.multi_till` and request `/users` or `/gl`.
   - Security: 404, not 403, and byte-identical to Hono's own not-found body — `LAN_ALLOWED_ROUTES`
     in `apps/desktop/src/main/lan-host.ts` allows only `/auth/login`, `/auth/logout`, `/tenant`,
     `/health` and `/lan/*`, and nothing else is forwarded to the app at all. Repeat from a device
     NOT on the host's own subnet (a phone hotspot works): every request refuses with 403
     `OFF_SUBNET`, checked fresh per request rather than cached at bind time.
Done: everything a person can do to the money is either impossible, permissioned, or on a report someone reads.

### T70 · Seed and empty states — Nothing untestable, nothing invented
Modules: Every module
Executable: pnpm check:seed

1. [ok] Run pnpm check:seed.
   - Every module: every list endpoint returns rows — an empty list surface is a finding, not a starting point.
2. [open] Create a fresh tenant with no seed and open every screen.
   - Shell: every empty state says what is missing and offers the action that fixes it.
3. [open] Look for any figure on any screen that is not traceable to a record.
   - Every module: no placeholder, no illustrative number, no "coming soon" figure dressed as data.
Done: every screen is either populated from the API or honestly empty, and no number on any screen was invented by the front end.

### T71 · Failure — When the API is not there
Modules: Shell · Every module
Executable: manual

1. [open] Stop the server and open every list screen.
   - Shell: a stated error and a retry that works, never an empty table that looks like no data.
2. [open] Fail a confirm mid-flight.
   - Every module: the button returns to its normal state, the document is unchanged, and the message says what to do.
3. [open] Submit a form that the server rejects with a validation error.
   - Shell: the field-level message appears next to the field, in Arabic.
4. [open] Lose the connection while a report is running.
   - Reports: the report says it failed; it does not show yesterday's numbers under today's filters.
Done: no failure is silent, and no failure leaves a screen showing something that is not true.

### T72 · Compliance — What an Egyptian invoice must carry
Modules: Tax · Print · Sales
Executable: docs/catalog · the tax and print agents

1. [open] Print a confirmed sales invoice.
   - Print: seller and buyer names, both tax numbers, the invoice number and date, the line detail, the VAT rate and amount, and the total in words where required.
2. [ok] Check the e-invoice UUID and QR on an accepted document.
   - Tax: fixed (F33) — check it has stayed fixed. Until then, nothing is submitted, so nothing comes back to print.
3. [open] Print a B2C receipt on the thermal printer.
   - Print: within 72 hours the e-receipt rules apply — the receipt carries what they require or the product says it does not.
4. [ok] Pay a local B2B supplier subject to withholding.
   - Tax: fixed (F45) — check it has stayed fixed. Until then, no withholding concept exists — the payment cannot be split between supplier and authority.
5. [ok] File a VAT period, then post into it.
   - Tax: fixed (F46) — check it has stayed fixed. Until then, nothing records the filing, so the restatement is silent.
Done: every document a tax inspector could ask for prints from this product, complete, in Arabic, offline.

### T73 · Onboarding — First run to first invoice
Modules: Settings · Accounting · Inventory · Sales
Executable: the implementation-consultant path

1. [open] Start the setup wizard on an empty database.
   - Settings: company, branch, warehouse, fiscal year, currency, chart of accounts — in that order, each one explained.
2. [open] Import the customer, supplier and item lists.
   - Settings: a template to fill, an all-or-nothing commit, and a report of what was created.
3. [ok] Enter opening balances — cash, bank, stock, AR, AP.
   - Accounting: fixed (F41) — check it has stayed fixed. Until then, the AR/AP half of the import posts nothing; only a manual opening journal entry gets them onto the books today.
4. [open] Check the opening trial balance.
   - Accounting: it balances, and it equals the balances the client gave you.
5. [open] Raise the first real invoice.
   - Sales: numbering starts where the client's old system stopped, because تسلسلات الترقيم was set during setup.
Done: a client can be live in a day, with an opening trial balance that ties to the books they arrived with.

### T74 · Month end — What the accountant actually does
Modules: Accounting · Treasury · Inventory · Reports
Executable: the accountant path

1. [open] Reconcile the bank for the month.
   - Treasury: every statement line matched or explained.
2. [ok] Run مطابقة الأرصدة for AR, AP and inventory.
   - !Accounting: the three known gaps (D1/D40, D18, D2/D3) are the only differences — anything else is new.
3. [open] Post accruals and prepayments.
   - Accounting: manual entries with a reversal date, and the reversal actually posts next period.
4. [ok] Run the VAT return and pay it.
   - Tax: output − input = the payment, and paying clears both sides.
5. [open] Close the period.
   - Accounting: every module refuses to post into it afterwards — and the purchase-invoice route must stop answering 500 (D20).
6. [ok] Produce the pack: trial balance, income statement, balance sheet, cash flow.
   - Reports: all four tie to each other and to the ledger.
Done: the month closes in an afternoon, and every figure in the pack can be walked back to a document.

### T75 · Year end — Can this be signed?
Modules: Accounting · Audit · Reports
Executable: the chartered-accountant path

1. [ok] Run the year-end close.
   - Accounting: fixed (F51) — check it has stayed fixed. Until then, there is no close — no closing entry and no posting to retained earnings.
2. [open] Produce the statutory statements for the year.
   - Reports: they balance, but retained earnings is derived by the report rather than carried by the ledger.
3. [open] Trace ten sampled figures back to their documents.
   - Audit: each has an entry, an actor, a timestamp and an unbroken chain to the source document.
4. [open] Look for anything that changed after it was posted.
   - Accounting: nothing — corrections are reversals, and the audit log shows both.
5. [open] Ask what a auditor would qualify.
   - Audit: the year-end close, the sub-ledger gaps and the missing withholding are the honest list.
Done: the statements can be signed, or the exact reasons they cannot are written down and tracked.

### T76 · Owner — The five-minute review
Modules: Dashboard · Reports
Executable: the owner path

1. [ok] Open the dashboard and read the day.
   - Dashboard: cash, receivables, payables, profit — four numbers, no jargon.
2. [ok] Ask why receivables differs from the aging report.
   - Dashboard: fixed (F54) — check it has stayed fixed. Until then, it does, by 5,486.12, and nothing on the screen explains the scope difference.
3. [open] Ask which customer owes the most and which item makes the most margin.
   - Reports: two clicks each, from the dashboard.
4. [open] Ask what changed since last month.
   - Dashboard: the period toggle answers it without exporting anything.
Done: an owner who opens Mezan once a day learns something true in under five minutes.

### Coverage map

| Nav group / concern | Trails |
|---|---|
| سير العمل (approvals) | T25, T55 |
| المبيعات | T01, T02, T03, T27, T29, T46 |
| المشتريات | T04, T05, T06, T28, T30, T47 |
| المخزون | T07, T08, T31, T32, T33, T34, T35, T48 |
| التصنيع | T09, T36 |
| المحاسبة | T10, T11, T12, T13, T17, T18, T37, T38, T39 |
| الخزينة | T14, T15, T40, T41 |
| الأوراق المالية | T16 |
| إدارة علاقات العملاء | T19 |
| الموارد البشرية | T20, T42, T43, T44, T45 |
| المشاريع | T21 |
| الأصول الثابتة | T22 |
| المبيعات الميدانية | T23 |
| الأقساط | T24, T47 |
| التقارير | T12, T46, T47, T48, T49 |
| الإعدادات | T25, T50, T51, T52, T53, T54 |
| النظام | T54, T64, T65, T66 |
| Shell / لوحة التحكم / hubs | T26, T56, T57, T58, T59, T60 |
| Cross-cutting: lifecycles, concurrency, money, failure | T61, T62, T63, T71 |
| Non-functional: volume, offline, a11y, i18n, security | T64, T65, T67, T68, T69 |
| Data honesty and compliance | T70, T72 |
| Role journeys: consultant, accountant, auditor, owner | T73, T74, T75, T76 |

### What a trail is worth

A module scenario asks "does this screen do what it says". A trail asks "does the
rest of the product agree with what this screen just did" — and that is the
question that found D39, D40, D41 and D42 in one afternoon, none of which any
screen-level test could have seen, because every screen involved answered 200 and
looked right.

---

# 15. Reference-parity pass


### Sources

- `docs/archive/gap-inventory.md` — the live diff of 101 reference routes against 116 Mezan routes, plus the round-2 deep pass over forms, detail panels, tabs and row menus.
- `ROADMAP.md` §1 — the ordered work list these scenarios verify.
- `ROADMAP.md` §5 — D43 (four "(المرحلة الثانية)" placeholders), D44 (cost-centre columns), D45 (three empty list surfaces).

### Conventions

- Run every scenario in **both locales** (ar/RTL default, en/LTR) and **both themes**. A scenario passes only if it passes in all four combinations.
- **Reload the page after every save.** Several past defects only appeared on the second look.
- A scenario tagged **`[PARITY]`** describes behaviour the reference has and Mezan does not yet. It is expected to fail until its `ROADMAP.md` §2.2 item is ticked — record the failure, do not re-file it.
- A scenario tagged **`[AHEAD]`** protects something Mezan does that the reference does not. It must keep passing; a regression here is a real defect.
- IDs are `PAR-001`, `PAR-002`, … grouped by the phase in `ROADMAP.md` §2.2.

---

### P0 — defects

**PAR-001 — no placeholder text survives on a wired surface (D43).**
Open `#/inventory/items`, open any item, go to the المخزون tab. Expect per-warehouse rows with متاح / محجوز / الإجمالي whose totals equal what `/reports/inventory/stock-levels` reports for the same item. Expect **no** occurrence of the string «المرحلة الثانية» anywhere in the app: search the rendered DOM of the item detail, the chart-of-accounts detail and the treasury-account detail. Currently fails on all three.

**PAR-002 — cost centres show cost-centre columns (D44).**
Open `#/accounting/cost-centers`. Expect headers الكود / الاسم / النوع / مرتبط بـ / المركز الرئيسي / الحالة. Currently shows the Chart-of-Accounts headers.

**PAR-003 — no list surface is empty (D45).**
Open `#/inventory/configurable-products`, `#/manufacturing/custom-manufacturing`, `#/installments/installment-follow-ups`. Each must render at least one seeded row. Then run `pnpm check:seed` and confirm all three appear in its surface list.

### P1 — shell

**PAR-010 — the sidebar nests three levels.**
Expand التقارير. Expect six sub-groups (المبيعات، المشتريات، المخزون، التصنيع، الأعمار، الأقساط), each collapsed, each expanding to its own reports — not 22 flat entries. Repeat for المخزون → المنتجات, التصنيع → الإنتاج, الإعدادات, المحاسبة, الموارد البشرية.

**PAR-011 — keyboard reaches every level.**
With the sidebar focused, Tab/Arrow through the tree in RTL. Focus order must follow visual order, and a collapsed sub-group's children must not be focusable.

### P2 — reports

**PAR-020 — every report opens with today's date.**
Open `#/reports/report-sales-by-period`. The من/إلى defaults must bracket the real current date, not 2026-08-22. Repeat on three other reports.

**PAR-021 — KPI strip and charts.**
On sales-by-period expect a KPI strip (الصافي، الإجمالي، متوسط قيمة الفاتورة، نسبة الخصم، عدد المبيعات) and at least the four reference charts: current-vs-previous trend, gross→net waterfall, revenue-vs-count dual axis, total composition. Values in the strip must equal the table's grand totals.

**PAR-022 — period chips re-run the report.**
Click هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة. Each must change the date inputs, fire one request, and change the KPI strip. Reload and confirm the chip state is in the URL.

**PAR-023 — % contribution sums to 100.**
On sales-by-item, sum نسبة المساهمة across all pages. Expect 100.0% ± 0.1.

**PAR-024 — GL reconciliation tile.**
On sales-by-item, the مطابقة دفتر الأستاذ tile must compare the report total against the GL revenue account and show the difference. Force a mismatch by posting a manual journal to the revenue account and confirm the tile reports it.

**PAR-025 — drill-down panel.**
Click a customer cell on sales-by-customer. Expect a side panel with that customer's detail, not a navigation.

**PAR-026 `[AHEAD]` — export survives.**
Every report keeps تصدير CSV and تصدير Excel. The reference has neither; do not drop them.

### P3 — document detail

**PAR-030 — sales-invoice tab set.**
Open a confirmed sales invoice. Expect eight tabs: البنود، المدفوعات، المرتجعات، الأقساط، القيود المحاسبية، الفاتورة الإلكترونية، المرفقات، سجل المراجعة.

**PAR-031 — actions reachable from the document.**
From the invoice: تحصيل creates a receipt voucher pre-filled with the customer and outstanding amount; مرتجع جديد from the المرتجعات tab opens a return bound to this invoice; إنشاء خطة أقساط from الأقساط opens a plan bound to this invoice; إرسال from the ETA tab enqueues a submission. Each must post and then be visible after a reload.

**PAR-032 — totals block is complete.**
Expect المجموع الفرعي، الضريبة، الإجمالي الكلي، إجمالي التكلفة، إجمالي الربح، هامش الربح. `المجموع الفرعي + الضريبة` must equal `الإجمالي الكلي` exactly.

**PAR-033 `[AHEAD]` — return-adjusted net.**
خصم المرتجعات المؤكدة and الصافي بعد المرتجعات must stay on the invoice. The reference has neither.

**PAR-034 — "تأثيرات هذا المستند" states all three effects.**
Stock decrement, AR increase, and explicitly that no collection happens automatically, each with the action that does it.

**PAR-035 — attachments round-trip.**
Attach a file to an invoice, reload, confirm it is listed and downloadable. Repeat on an item, a customer and an employee.

**PAR-036 — purchase-invoice line grid.**
Expect المستهلك / المستلم alongside الكمية, and a التكاليف الإضافية tab listing any landed-cost document that allocated onto this invoice.

### P4 — entity 360

**PAR-040 — customer statement ties to the ledger.**
Open a customer, open كشف حساب. Columns التاريخ / المرجع / النوع / مدين / دائن / الرصيد الجاري. The closing الرصيد الجاري must equal that customer's balance on the customers list **and** their share of GL 1100.

**PAR-041 — supplier statement ties to the ledger.** Same, against GL 2100.

**PAR-042 — customer action bar.**
إنشاء فاتورة / تحصيل دفعة / عرض سعر جديد each open the right form with the customer pre-selected.

**PAR-043 — item stock by warehouse includes reserved.**
متاح + محجوز must equal الإجمالي for every warehouse row, and the sum across warehouses must equal the stock-levels report.

**PAR-044 — cost layers are visible and ordered.**
The item's التكلفة tab lists layers with الكمية المتبقية / تكلفة الوحدة / المصدر / التاريخ, oldest first, and their weighted average equals the item's WAC to the cent.

**PAR-045 — row overflow menus.**
Every list row exposes عرض / تعديل / تعطيل / حذف, gated by permission. تعطيل on a referenced record must refuse in Arabic, not with a raw enum.

**PAR-046 — inline opening-balance actions.**
تحديد الرصيد الافتتاحي on a zero-stock item and إضافة رصيد افتتاحي on a treasury account each post a balanced entry dated the document's date, not `now()`.

### P5 — missing features

**PAR-050 — eleven voucher types.**
سند جديد opens a card grid of eleven types, each with its explanatory sentence. Create one of each; every one posts a balanced entry, and the type survives a reload. Check the GL accounts specifically for ضخ رأس مال من الشريك and سحب شخصي للشريك (equity, not income/expense) and for دفع لمصلحة الضرائب (the tax payable account, not a generic expense).

**PAR-051 — six item types.**
منتج / خدمة / مادة خام / منتج نهائي / مستهلك / وصفة. A خدمة must not create stock movements; a مادة خام must be selectable on a BOM; a وصفة must not be sellable directly.

**PAR-052 — purchase-invoice line types.**
A مصروف line must post to an expense account and create no stock movement; a شحن line must be capitalisable into landed cost; a مخزني line behaves as today.

**PAR-053 — adjustment reason wizard.**
New adjustment offers the eight reasons. Each must map to its own GL contra account, and the reason must appear on the resulting journal entry's description and on the adjustment list.

**PAR-054 — work-order shop-floor actions.**
صرف إضافي، إرجاع مواد، تسجيل فاقد، تسجيل تكلفة، استلام المنتج. After each, the materials grid's الصادرة / المرجعة / الصافي / النقص must recompute, and WIP must equal issued cost minus received cost.

**PAR-055 — returns start from a source document.**
Creating a sales return without picking a source invoice must be impossible. Same for purchase returns. The returnable quantity must be recomputed server-side from posted documents, never taken from the request body.

**PAR-056 — coupon on a sales invoice.**
Entering a valid coupon applies its discount; an expired or over-limit coupon refuses in Arabic; the applied coupon is recorded on the invoice and appears in the promotions report.

**PAR-057 — customer form advanced options.**
الشعار، رقم التسجيل التجاري، إعفاء ضريبي، نوع العميل، جهة الاتصال all save and survive a reload. إعفاء ضريبي must suppress tax on that customer's next invoice.

**PAR-058 — transfer import from Excel.**
Import a sheet of item/qty rows; unknown SKUs must be reported by row number, not silently dropped. The line grid shows المخزون المتاح per line and refuses a transfer above it.

### P6 — list surfaces

**PAR-060 — purchase-invoice payment dimension.**
Chips متأخرة / تستحق قريباً / مدفوع جزئياً / مدفوع filter correctly, and the KPI strip shows money (المدفوع للموردين، إجمالي المرتجعات، المدفوعات غير المخصصة، رصيد الفواتير غير المدفوعة) whose total ties to GL 2100.

**PAR-061 — items list shows stock.**
A المخزون column with a low/out-of-stock state, chips for each state, and تصنيفات الأصناف / تصدير actions.

**PAR-062 — every document list filters by branch, warehouse and date.**
Walk each list in `ROADMAP.md` §2.2 P6 and confirm the filter bar, the active-filter count, and that filters survive a reload.

**PAR-063 — ETA has all five tabs.**
الإعدادات العامة، بيانات الاعتماد، ربط الأصناف، ربط الوحدات، الإرسالات. Credentials must never render in plain text after save.

**PAR-064 — settings has all policy tabs.**
البريد الإلكتروني، ضبط الائتمان، سياسة المخزون، ضبط المشتريات، سياسة الخزينة. Changing a credit-control setting must change what the sales invoice does at the credit limit.

**PAR-065 — approvals has three tabs.**
صندوق الوارد / طلباتي / إجراءاتي, each scoped to the signed-in user.

**PAR-066 — leave requests can be created.**
The طلب إجازة جديد action exists on `#/hr/leave-requests` and produces a request visible to the approver.

### Locale pass

**PAR-070 — English/LTR sweep.**
Switch to English and re-walk every screen touched above. No Arabic string may remain in the English UI, no English enum may leak into the Arabic UI, the layout must mirror, and digits must render Latin in en and Arabic-Indic in ar.

---
