# Verification protocol

The 2026-08-23 ban on automated tests was **reversed on 2026-08-30** (`docs/TESTING.md
§1`): the unit suite, the scenarios and the e2e specs run again, locally, in addition
to live verification — never instead of it. During a build phase the owner's rule is
**features first, tests after**: a lane may land on `pnpm typecheck && pnpm lint` and
must list the tests it owes. The lesson behind the old ban still stands — a live
click-through found five user-facing defects that 2,080 passing unit tests missed,
because each test asserted its own component's contract rather than anything a user
can do — so a test that only restates a prop proves nothing; test the user path.

## Always-on gates

```bash
pnpm typecheck && pnpm lint && pnpm build   # lint = eslint + RTL logical-CSS + colour tokens
pnpm smoke                                  # boots the real backend, seeds, hits every read surface
pnpm check:seed                             # every list surface must return rows
pnpm scenarios                              # the executable suite — 1,899 assertions, 10 suites
pnpm scenarios seams cross-module           # or just the named suites
```

`pnpm lint`'s colour-token rule exists because a Tailwind class naming a token that
does not exist emits **no CSS at all**: the element silently inherits and every other
gate passes. `pnpm scenarios` asserts the behaviour each fixed defect restored, so a
regression turns it red; the assertions that fail are the register's open defects,
deliberately.

`pnpm smoke` catches an unmounted route — the failure mode that has bitten this
codebase repeatedly (four inventory-ops routes existed as files, were mounted only
when `createBackend` supplied a dep it never supplied, and 404'd live).

## A run against real data

```bash
S=$(mktemp -d)
MEZAN_SEED_DEMO=1 MEZAN_DB=$S/test.db PORT=3300 pnpm exec tsx apps/server/src/index.ts &
cd apps/web && MEZAN_API_URL=http://127.0.0.1:3300 pnpm exec vite --port 5300 --host 127.0.0.1 &
```

Log in as `admin@cyag.example` / password `Cyag@2026`. Use a **fresh database** each run — a previous
run's writes change what later phases see. Cross-check a screen against its endpoint
with `curl` and headers `x-user-id`, `x-permissions: *`, `x-branch-scope: *`,
`x-warehouse-scope: *`.

**Gate: no list surface may be empty.** `pnpm check:seed` reports which list endpoints
return zero rows (102 surfaces populated, 0 empty at last run). Any empty surface is a finding — a
seeding gap or a broken route — and testing past it tests nothing.

## Trails, not screens

`docs/TESTING.md §14` holds 76 posting trails (372 steps) covering every
nav group, every report, the non-functional concerns (volume, offline, a11y, i18n,
security) and four role journeys — each a single thread of real clicks with the
cross-module effects each click must produce, plus the pair to check and the known
stops. `pnpm trails` regenerates the tickable page from that file; the markdown is
the source, the HTML is output. Run the trail for whatever you touched **before** the per-screen sweep: a
screen-level pass cannot see a document that posts one-sidedly, and every trail ends
on a pair that must agree. Update the trail's step whenever its behaviour changes,
and reference the defect number rather than re-describing the symptom.

## Two rules that make results trustworthy

1. **Never test an empty screen.** A button with no rows to act on cannot be proven.
2. **One tester, one backend, one database, one browser tab.** Two testers sharing a
   tab produce confidently wrong results — while A measures screen X, B navigates to
   Y and A records Y's DOM under X's name. This happened; a 72-screen report was
   thrown away. Parallel testing requires a private port, database file and tab each.

## What to measure, per screen

| Check | Pass condition |
|---|---|
| Renders | exactly one non-empty `<h1>` |
| Console | no errors, no unhandled rejections |
| Network | no 4xx/5xx |
| Layout | `document.body.scrollWidth <= innerWidth` |
| Contrast | ≥4.5:1, or ≥3:1 at ≥24px / ≥18.66px bold |
| Labels | every input, select, textarea has an accessible name |
| Placeholders | no «قريباً» outside HR |
| Field binding | every field naming an entity (صنف، مستودع، فرع، عميل، مورد، حساب، مركز تكلفة) is a picker over that entity's endpoint — not a text input |
| Persisted row | create one document, then read the row back from SQLite: every foreign id is a real id from the seed, not a client-invented string |

Run in **both themes** and **both locales** (ar/RTL and en/LTR). Stub
`window.confirm/alert/prompt` before the first click — a native dialog blocks the
automation channel and ends the session. A background tab clamps `setTimeout` to ≥1s,
so a sweep can stall silently.

Then activate every enabled control and record whether the app reacted (DOM mutation,
network call, navigation, dialog). No reaction is a *candidate* dead control —
confirm each by hand before reporting. Already-selected toggles and disabled controls
are expected non-reactions.

## Before building or reviewing a document screen

`docs/archive/catalog/` is a **label snapshot, not a spec of controls**. Its line
`البنود: الصنف, الكمية, سعر الوحدة, الإجمالي` reads identically whether الصنف is a
combobox over `/items` or a bare `<input type="text">`. A screen can match the catalog
word for word and still let a user type an item that does not exist. It also omits
defaults, validation, what each control does on save, and every field the capture
missed.

So before writing or judging a document form, **open the reference screen live** and
enumerate, per field: label · control type · where its options come from · what is
required · what the form does with it on save. The reference is credential-gated and
login is the user's to perform — ask them to sign in on the tab in this session's
Chrome tab group, then read the DOM (see the `reference-app-is-the-arbiter` memory).
Write the enumeration down before building; that list, not the catalog line, is the
acceptance criterion.

**Sub-pages, not drawers.** In the reference product a *document* create form and a
document itself are their own addressed pages (`/sales/quotes/new`,
`/sales/quotes/<id>`), while a short *master-data* form (Add Customer) is a centred
modal. Mezan's shell routes on the hash (`#/sales/quotes/new`) — see
`apps/web/src/routing.ts` and `useSubPage()` — so a document screen must render its
create form and its detail as sub-pages, and never as a `SidePanel`. Check which of the
two the reference uses before converting a screen; "make everything a page" is as wrong
as "make everything a drawer".

**"Wired to the real API" is not "correct".** `docs/archive/web-data-wiring.md`'s status table
grades screens on data provenance — does this screen read and write the real backend —
and a form posting fabricated ids to a real endpoint scores full marks on it. Provenance
is necessary and nowhere near sufficient; field fidelity is a separate gate and has to
be checked separately.

## Writing an executable scenario

`scripts/scenarios/` runs in-process against a freshly seeded backend, through the
**same HTTP routes the UI calls**. It exists because driving the browser proved
unreliable for money paths (a background tab clamps timers to once a minute) while
this path found and proved real defects in an evening. It does not replace UI testing
— it cannot see layout, focus or contrast — it replaces the part a click-through is
worst at: asserting a document left the books correct.

Rules learned the hard way, all of them from a failure:

- **Assert the business requirement, not the current behaviour.** Where the product
  cannot meet it, invert the check deliberately and label it with the measured
  evidence *and the root cause file* — so a fix flips it back rather than deleting it.
  Never weaken an assertion to get green; a failure is either a defect or a wrong
  assertion, and you must work out which before changing anything.
- **Probe the response shape before writing assertions.** A throwaway script that
  prints one real response saves an afternoon of arguing with wrong field names.
- **Every assertion must hold standalone *and* in the full ordered run.** Suites share
  one seeded tenant and run in a fixed order, so a claim about global state ("every
  audit row has a null branch") can pass alone and fail in the suite. Scope claims to
  the rows the scenario itself created.
- **Keep the harness invariants meaningful.** `scenario()` re-checks the trial balance
  and the inventory/AP reconciliation around every scenario, so hand-posted journal
  entries must use **non-control** accounts (2170, 2190) — posting to 1200/1105/2100 by
  hand breaks the very check that catches real defects.
- **Use service lines (`isStock: false`) for anything about tax, discount, rounding,
  numbering or pricing.** A forty-document sweep on stock lines drains the warehouse
  and moves the invariants for every later scenario.
- **Prefix every id with the suite's own tag** (`SCN-X-`, `SCN-S-`) so it can collide
  neither with the seed nor with another suite.
- **Leave the tenant as you found it**: reopen any period you closed, restore any
  setting you flipped, and clear approval gates an earlier suite left configured — a
  money trail measured behind a gate is a journey that stopped halfway.

## Behaviour, not reaction

Automation proves a control reacts; only a scenario proves it did the right thing.
`docs/TESTING.md §5–§15 ` holds 964 numbered per-screen scenarios with
`[NOT IMPLEMENTED]` markers where the build diverges, and `scripts/scenarios/` holds
the executable subset behind `pnpm scenarios`. `docs/TESTING.md §13` is
the seam file: money trails across modules (`cross-module.ts`) plus the currency, tax,
Egypt-compliance, concurrency, permission, search, audit, pricing and year-end seams
(`seams.ts`). What is still manual is listed there and named — POS, the ETA lifecycle,
statutory payroll, Postgres parity, five-year volume, restore, offline. Making all 102 list surfaces non-empty
is what surfaced four of the six currently-open defects — none was visible on an empty
tenant.

Every money scenario asserts these two invariants **before and after**:

1. The trial balance balances — debit == credit exactly.
2. The inventory sub-ledger reconciles to GL 1200 exactly. (AR and AP will not, until
   D1 is fixed — see the register for the expected gaps.)

If a scenario moves stock or money and *neither* invariant moves, that is the finding:
the document posted nothing.

For every entity: create through the UI and **reload** to confirm it persisted; open
the detail and check each field; update, save, reload; delete or void — and confirm
that what should be voided is voided, leaving its trail. Test the reverse of every
forward flow: login implies logout, create implies the row appears, allocate implies
unallocate restores both sides.

## Reporting

State what the browser showed, not what the source implies. Give figures, not
adjectives. If you could not verify something, say so — an unverified claim in a
status document is how "the van sales report is missing" survived for weeks while the
report sat in the nav.
