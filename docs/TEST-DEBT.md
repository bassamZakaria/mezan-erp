# Test debt — the deferred build (from 2026-09-19)

The owner's rule for the deferred build (DEC-23): **features first, tests after.** Lanes write no new
tests and run no suites; `pnpm typecheck` is the only gate. Every lane records here what it skipped,
so the test pass that follows the features has a complete list. Nothing ships to `production` before
that pass runs `FULL=1` — the whole vitest suite, the scenarios with the four invariants exactly 0,
smoke, check:seed, e2e, every-screen and the phone checks.

## Known red on main (fix in the test pass)

| Where | Reading | Found |
|---|---|---|
| `pnpm scenarios` — installments | `lines #2-6 are still 'pending'` — reproduces on main without any lane's change; looks date-dependent, like D281 | lane 0C, 2026-09-19 |
| D281 | A5 drill-down vs trial balance disagree for documents dated after today; the scenario suite depends on the real calendar | 2026-09-19, fix in flight |

## Owed, per lane

| Lane | Tests owed |
|---|---|
| 0B — HR D186–D189 (#90) | API-level tests of department-eligibility wiring and the return report; browser check of the holiday-choice field and the «راحة بديلة» status; half days and the calendar-days divisor on rest days and holidays. Reviews owed: hr-payroll + tax-expert on the 14/2025 rows (insurable-wage treatment of rest-day/holiday pay under 148/2019; ineligible staff; night = 19:00–07:00 vs sunset–sunrise) |
| 0C — SaaS follow-ups (#91) | `createCloudApp` → router → gate end-to-end; sign-out clears cached tenant data; plan-editor decimal price and 422 rendering; per-operator tenant memory across two tenants on one email; archived-tenant mapping forgotten on 404 |

## Open gaps filed while building

| Gap | Where |
|---|---|
| `GET /tenant` still answers a tenant's name to a guessed code | `packages/backend/src/auth-routes.ts` — ROADMAP §4.3 |
