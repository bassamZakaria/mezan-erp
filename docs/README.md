# Mezan — documentation map

Start here. Every document under `docs/` is in exactly one of four categories, and
the category tells you how much to trust it.

| Category | Goes stale? | Files |
|---|---|---|
| **Live** — kept current, read before acting | yes, and it is maintained | `STATUS.md`, `defects.md`, `decisions.md`, `tasks.md` |
| **Durable reference** — the product, the market and the architecture | no | `plan.md`, `catalog/`, `reference-parity/` |
| **Procedure** — how to do a recurring job | only when the job changes | `testing-policy.md`, `testing-plan.md`, `scenarios/`, `web-data-wiring.md`, `enhancements/` |

## The two documents most work starts from

- **`plan.md`** — the whole plan in one file. Architecture and tech stack (§1–§3),
  module build order (§4), risks and open decisions (§5–§7), reference parity and the
  operational-depth candidates, then **§8 the market analysis and gap study** (competitor
  matrix, per-competitor detail, the five structural gaps, the recommended differentiators)
  and **§9 the deferred roadmap** for HR/Payroll, POS and Cloud/SaaS.
- **`tasks.md`** — the whole work list in one file. Parity P0–P6, what is **open now**,
  what is deferred by decision, the beyond-parity enhancement backlog, the shell
  follow-ups, and the original catalog-derived phase backlog kept for traceability.

## Find it by question

| Question | Document |
|---|---|
| What is done, and what is broken right now? | `STATUS.md` — **the only status document** |
| What is left to do? | `tasks.md` — **the only task document** |
| What defects are known? | `defects.md` — the register, read before every test run |
| What is waiting on a human decision? | `decisions.md` |
| What is the architecture, and why? | `plan.md` §1–§3 |
| Who do we compete with, and where are the gaps? | `plan.md` §8 |
| What is the plan for HR / POS / Cloud? | `plan.md` §9 |
| What does the reference app actually do? | `catalog/01..10` — the spec, captured from the live product |
| What did a live re-enumeration of one reference screen find? | `reference-parity/` |
| How is anything verified now? | `testing-policy.md` |
| How do I test after a big change? | `testing-plan.md`, then `scenarios/01..09` |
| Does the whole product still agree with itself? | `scenarios/10-posting-trails.md` — 76 trails, one per part, each crossing every module it touches (`pnpm trails` rebuilds the tickable page) |
| How do I wire a screen to real data? | `web-data-wiring.md` |

## The four live documents, and who updates them

- **`STATUS.md`** — updated when a capability lands or a claim in it turns out to be
  false. It is measured against the running app, not against a checklist.
- **`tasks.md`** — an item is ticked only when it has been driven in the running app on
  seeded data, in both locales and both themes. A green test is not a tick.
- **`defects.md`** — read before a test run, updated in the same commit as any fix. A
  defect is never deleted; it moves to FIXED, because that is how its regression is
  recognised.
- **`decisions.md`** — a decision lands here when work stops on a question with more than
  one defensible answer. Taking it moves the row to DECIDED.

If any of them disagree with the running app, the app wins and the file is corrected in
the same pass.

## Directories

- **`catalog/`** — 10 files capturing the reference product's 125 screens, field by
  field. A label snapshot: it records that a field exists, not whether it is a picker or
  a text input — for that, re-enumerate live (`reference-parity/`).
- **`reference-parity/`** — per-screen enumerations driven from the *running* reference
  product, plus the audit evidence: the ~90-requirement register (`audit/REQUIREMENTS.md`),
  201 GET endpoints (`audit/API-SURFACE.md`), every control (`audit/ACTIONS.md`), what was
  **not** seen (`audit/COVERAGE.md`), 28 screenshots, and the screen-by-screen diff
  (`gap-inventory.md`). Where this and `plan.md` disagree about the scope of a screen, the
  register wins — it was read from the running product.
- **`scenarios/`** — business-scenario files, one per domain plus the cross-module money
  trails. Each is paired with an executable suite in `scripts/scenarios/`; run them with
  `pnpm scenarios`.
- **`enhancements/`** — the beyond-parity requirements (`requirements.md`), the workflows
  they enable (`workflows.md`), and the UX enhancement spec. The enhancement *backlog*
  moved into `tasks.md` §4.

## What was removed on 2026-08-27

`backlog.md`, `deferred-plan.md`, `reference-parity/parity-tasks.md`,
`enhancements/backlog.md`, `enhancements/shell-follow-ups.md` and
`enhancements/market-analysis.md` were merged into `plan.md` and `tasks.md` and deleted.
`archive/`, `enhancements/meeting/` and `enhancements/design-review-2026-08-23.md` were
point-in-time documents already stale by design; they are in git history.
