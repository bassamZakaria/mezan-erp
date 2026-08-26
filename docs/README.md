# Mezan — documentation map

Start here. Every document under `docs/` is in exactly one of four categories,
and the category tells you how much to trust it.

| Category | Goes stale? | Files |
|---|---|---|
| **Live** — kept current, read before acting | yes, and it is maintained | `STATUS.md`, `defects.md`, `decisions.md` |
| **Durable reference** — describes the reference product or the architecture | no | `catalog/`, `plan.md`, `backlog.md`, `deferred-plan.md`, `reference-parity/` |
| **Procedure** — how to do a recurring job | only when the job changes | `testing-policy.md`, `testing-plan.md`, `scenarios/`, `web-data-wiring.md`, `enhancements/` |
| **Archive** — point-in-time, kept for evidence not conclusions | already stale by design | `archive/` |

## Find it by question

| Question | Document |
|---|---|
| What is done, and what is broken right now? | `STATUS.md` — **the only status document** |
| What defects are known? | `defects.md` — the register, read before every test run |
| What is waiting on a human decision? | `decisions.md` |
| What does the reference app actually do? | `catalog/01..10` — the spec, captured from the live product |
| What did a live re-enumeration of one reference screen find? | `reference-parity/` |
| What is the architecture, and why? | `plan.md` |
| What is left to build, as issues? | `backlog.md` |
| What is the plan for HR / POS / Cloud? | `deferred-plan.md` |
| How is anything verified now? | `testing-policy.md` |
| How do I test after a big change? | `testing-plan.md`, then `scenarios/01..09` |
| Does the whole product still agree with itself? | `scenarios/10-posting-trails.md` — 76 trails, one per part, each crossing every module it touches (`pnpm trails` rebuilds the tickable page) |
| How do I wire a screen to real data? | `web-data-wiring.md` |
| Is the UX enhancement signed off? | `enhancements/design-review-2026-08-23.md` |
| What did an earlier audit find? | `archive/` — and see its README first |

## The three live documents, and who updates them

- **`STATUS.md`** — updated when a capability lands or a claim in it turns out to
  be false. It is measured against the running app, not against a checklist.
- **`defects.md`** — read before a test run, updated in the same commit as any
  fix. A defect is never deleted; it moves to FIXED, because that is how its
  regression is recognised.
- **`decisions.md`** — a decision lands here when work stops on a question with
  more than one defensible answer. Taking it moves the row to DECIDED.

If two of them disagree, `STATUS.md` loses to whatever the running app says, and
the file gets corrected in the same pass.

## Directories

- **`catalog/`** — 10 files capturing the reference product's 125 screens, field
  by field. The source every other planning document traces back to. A label
  snapshot: it records that a field exists, not whether it is a picker or a text
  input — for that, re-enumerate live (`reference-parity/`).
- **`reference-parity/`** — per-screen enumerations driven from the *running*
  reference product, written when a catalog label proved too thin to build from.
  Re-run the enumeration before changing the screen it covers.
- **`scenarios/`** — 9 business-scenario files, one per domain plus the
  cross-module money trails. Each is paired with an executable suite in
  `scripts/scenarios/`; run them with `pnpm scenarios`.
- **`enhancements/`** — the UX enhancement direction, its sign-off pack, and the
  shell follow-ups queued behind it.
- **`archive/`** — point-in-time documents. Accurate when written, kept for their
  evidence. Do not read them for current state.
