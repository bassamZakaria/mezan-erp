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
| 1B — hourly/daily pay + FX contracts (`feat/hr-hourly-daily-fx-pay`) | `worked-time.test.ts`: working day capped at the standard day; unclocked day pays a daily wage and no hours; rest day/holiday pays only approved time; half days; paid leave and unworked holidays on scheduled days only, no double count with worked days or overlapping requests. `calculate-payroll-run.test.ts`: hourly and daily basic lines (bigint, rounded once), paid leave line, no unpaid-leave deduction for non-monthly, overtime at the contract's own hourly/day rate (rest day = base + one extra day, holiday = base + two), martyrs' fund skipped for daily, insurance on period earnings with the floor prorated, FX conversion at the approved rate on or before period end with gross/net in contract currency, `FX_RATE_MISSING` refusal (ar + `messageEn`), exclusion warnings when the worked-time or FX seam is unbound. `payroll-run.test.ts`: the two removed unimplemented-rule codes (`hourly_daily_basis`, `multi_currency`) — the assertion at :130–143 is now stale. `hr-payroll-store.test.ts`: `basis_json` round-trip and migration on an old table. `post-payroll-run.test.ts`: a run with an FX payslip posts balanced in EGP. API: `/hr/payroll/runs/:id/calculate` 422 body on a missing rate; payslip `basis` serialised. Browser: run screen basis/FX block and printed payslip terms in ar/en; contract form rate label switches with the pay basis. Seed: `ECT-DEMO-9` hourly rate is now 32 (was a monthly-looking 4200) — re-check any scenario reading it. Review fixes to guard: the insurance floor/ceiling for hourly/daily prorated by contract-live days before clamping; overtime now read over the contract-live window, not the whole period (also changes monthly joiners/leavers — re-check the OT scenarios) |
| 0C — SaaS follow-ups (#91) | `createCloudApp` → router → gate end-to-end; sign-out clears cached tenant data; plan-editor decimal price and 422 rendering; per-operator tenant memory across two tenants on one email; archived-tenant mapping forgotten on 404 |

## Open gaps filed while building

| Gap | Where |
|---|---|
| `GET /tenant` still answers a tenant's name to a guessed code | `packages/backend/src/auth-routes.ts` — ROADMAP §4.3 |
| Law reading (1B): is an unworked weekly rest day paid to a daily/hourly worker (12/2003 Art. 83 / 14/2025)? Today it earns nothing; official holidays on scheduled days are paid | `packages/domain/src/hr/worked-time.ts` — hr-payroll review, DEC-12 |
| Law reading (1B, pre-existing): any approved minutes on a rest day or holiday earn the whole extra day's wage; confirm no minimum-presence or pro-rata rule | `packages/domain/src/hr/attendance-overtime.ts` `summarizeOvertime` |
| Paid-leave crediting reads the calendar only, while pay reads the attendance status too; an entry whose status disagrees with the calendar can be treated two ways | `packages/domain/src/hr/worked-time.ts` `isScheduled` |
