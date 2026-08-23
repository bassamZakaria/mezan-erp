# Testing policy — automated test execution is disabled

**Set 2026-08-23. This is a deliberate, reversible product decision, not an oversight.**

## The rule

- **Do not write new test files.** Do not update or repair existing ones.
- **Do not run tests anywhere** — not locally, not in CI. `pnpm test`, `pnpm test:e2e` and
  `pnpm test:e2e:ui` are stubs that print this policy and exit 0.
- **Verify in the running app, against real seeded data**, instead.

## Why

A live click-through of the app found five user-facing defects — a refresh that silently
logged the user out, six dead dashboard buttons, a dead command palette, no logout anywhere,
and a fabricated notification badge — that **2,080 passing unit tests did not catch**, because
each test asserted its own component's contract rather than anything a user can do. Live
verification against real data was measurably the higher-yield check, so that is where the
effort goes for now.

## How to verify instead

Start a backend seeded with a realistic tenant, and drive the real UI against it:

```bash
# Backend with the demo tenant (customers, suppliers, items, and confirmed
# purchase + sales invoices posted through the real services to the ledger)
MEZAN_SEED_DEMO=1 MEZAN_DB=./dev.db PORT=3187 pnpm exec tsx apps/server/src/index.ts

# Web, proxying /api to it
cd apps/web && MEZAN_API_URL=http://127.0.0.1:3187 pnpm exec vite --port 5183
```

Log in as `محمد الشهابي` / PIN `1234`, then exercise the screens you changed: open them, run
their actions, and **reload the page to confirm what you saved actually persisted**. Cross-check
what the screen displays against what the endpoint returns (`curl` with headers
`x-user-id: t`, `x-permissions: *`, `x-branch-scope: *`, `x-warehouse-scope: *`).

The demo profile lives in `packages/backend/src/demo-seed.ts` and runs **only** when
`createBackend({ seedDemoData: true })` is passed — apps/server passes it solely on
`MEZAN_SEED_DEMO=1`, and apps/desktop never passes it, so a real install never receives it.

## What still runs

`pnpm typecheck` and `pnpm lint` (including the RTL logical-CSS rule) remain required and are
still enforced in CI.

## Known risk, accepted

Live UI verification catches wiring and integration defects well. It does **not** cover the
arithmetic the ERP's correctness rests on — GL balancing, weighted-average costing, landed-cost
allocation, fiscal-period gates, permission resolution. Those 49 domain modules are now
unguarded against regression.

## Re-enabling

The test files were left in place, so this is a one-line reversal: restore `"test": "vitest run"`
and `"test:e2e": "playwright test"` in `package.json`, and put the `Test (vitest, SQLite)` step
back in `.github/workflows/ci.yml`.
