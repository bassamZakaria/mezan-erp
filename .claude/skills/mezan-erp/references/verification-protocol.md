# Verification protocol

Automated business-logic tests are **disabled by decision** (`docs/testing-policy.md`):
do not write, repair or run test files; `pnpm test` and `pnpm test:e2e` are stubs that
print the policy. The reason is measured — a live click-through found five user-facing
defects that 2,080 passing unit tests missed, because each test asserted its own
component's contract rather than anything a user can do. The accepted risk is that the
49 domain modules (GL balancing, WAC, landed cost, period gates, permission
resolution) are unguarded against regression; if you change that arithmetic, prove it
by driving documents through the running app and reading the resulting balances.

## Always-on gates

```bash
pnpm typecheck && pnpm lint && pnpm build   # lint = eslint + RTL logical-CSS + colour tokens
pnpm smoke                                  # boots the real backend, seeds, hits every read surface
pnpm check:seed                             # every list surface must return rows
pnpm scenarios                              # the executable suite — 1,412 assertions
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

Log in as `محمد الشهابي` / PIN `1234`. Use a **fresh database** each run — a previous
run's writes change what later phases see. Cross-check a screen against its endpoint
with `curl` and headers `x-user-id`, `x-permissions: *`, `x-branch-scope: *`,
`x-warehouse-scope: *`.

**Gate: no list surface may be empty.** `pnpm check:seed` reports which list endpoints
return zero rows (102 surfaces populated, 0 empty at last run). Any empty surface is a finding — a
seeding gap or a broken route — and testing past it tests nothing.

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

Run in **both themes** and **both locales** (ar/RTL and en/LTR). Stub
`window.confirm/alert/prompt` before the first click — a native dialog blocks the
automation channel and ends the session. A background tab clamps `setTimeout` to ≥1s,
so a sweep can stall silently.

Then activate every enabled control and record whether the app reacted (DOM mutation,
network call, navigation, dialog). No reaction is a *candidate* dead control —
confirm each by hand before reporting. Already-selected toggles and disabled controls
are expected non-reactions.

## Behaviour, not reaction

Automation proves a control reacts; only a scenario proves it did the right thing.
`docs/testing-scenarios.md` holds ~29 end-to-end lifecycles taken from the captured
catalog, `docs/scenarios/` holds 964 numbered per-screen scenarios with
`[NOT IMPLEMENTED]` markers where the build diverges, and `scripts/scenarios/` holds
the executable subset behind `pnpm scenarios`. Making all 102 list surfaces non-empty
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
