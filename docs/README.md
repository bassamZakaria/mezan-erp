# Mezan — documentation map

Two documents, two directories. That is all of it.

| | What it is |
|---|---|
| **`ROADMAP.md`** | What is built, what is open, which defects are known, which decisions wait on a human, and the whole task list. **Maintained.** If it disagrees with the running app, the app wins and this file is corrected in the same pass |
| **`TESTING.md`** | The testing policy, the regression plan, and all 1,686 scenarios across every screen. Maintained when the product changes under a scenario |
| **`artifacts/`** | Every artifact this project produces — the design source of truth, the review panel's findings, the Egypt compliance brief, and anything `pnpm` generates. Its `README.md` says what each one is |
| **`archive/`** | Everything retired: the original plan, the catalog, the reference audit, the distribution and demo notes, the enhancement requirements, the closed defect register, superseded mockups. Kept for evidence, not for current state. Read its `README.md` before trusting anything inside |

## Find it by question

| Question | Where |
|---|---|
| What is done, and what is broken right now? | `ROADMAP.md` §1–§2, §5 |
| What is left to do? | `ROADMAP.md` §3, §7, §8 |
| What is waiting on a human decision? | `ROADMAP.md` §6 |
| Why are we not writing unit tests? | `TESTING.md` §1 |
| How do I test after a big change? | `TESTING.md` §2, then the scenarios for the domains you touched |
| Does the whole product still agree with itself? | `TESTING.md` §14 — 76 posting trails, one per part, each crossing every module it touches (`pnpm trails` rebuilds the tickable page) |
| What should the UI look like? | `artifacts/mezan-enhanced-mockups.html` — the design source of truth. `artifacts/directions/2-mishkah.html` is the type and colour authority in light, `6-thil.html` in dark |
| What did the review panel find, and what is still open from it? | `artifacts/simplification-review.html` |
| What does Egyptian law require that we do not have? | `artifacts/best-erp-in-egypt.html` |
| Where do I put a mockup, a generated page, or an Artifact I just published? | `artifacts/` — always, and add a row to its `README.md` |
| What was the original architecture and phasing, and why? | `archive/plan.md` §1–§7, `archive/phase-backlog.md` |
| Who do we compete with, and where are the gaps? | `archive/plan.md` §8 |
| What is the plan for HR / POS / Cloud? | `archive/plan.md` §9 |
| What was the requirement behind `R4.7` / `A2` / `D31`? | `archive/reference-parity/REQUIREMENTS.md`, `archive/gap-inventory.md`, `archive/defect-register.md` |

## The rules these documents are kept under

- **Two documents, not three.** `ROADMAP.md` and `TESTING.md` are the whole live set. The
  four files they replaced spent months disagreeing with each other about what was broken;
  a third live document is how that starts again.
- **An item is ticked only when it has been driven in the running app** on seeded data, in
  both locales (ar/RTL and en/LTR) and both themes. A green test is not a tick.
- **A defect is never deleted.** It moves to `archive/defect-register.md` with its fix
  commit, because that is how its regression is recognised.
- **A decision is never deleted either.** Taking it records the option chosen and why, so
  the next person knows the alternative was considered.
- **Every artifact goes in `artifacts/`** — a mockup, a diagram, a generated page, a
  published Artifact. Never a folder at the repository root, never left in a scratch
  directory. One left loose gets mistaken for source; one nobody can find goes unused.
- **Point-in-time measurements carry their date**, and move to `archive/` once they stop
  describing the present. Nothing in `archive/` is edited afterwards — editing a record of
  what was measured is how it stops being one.
