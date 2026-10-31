# Mezan — documentation map

Three documents, two directories. That is all of it.

| | What it is |
|---|---|
| **`ROADMAP.md`** | What is built, what is open, which defects are known, which decisions wait on a human, and the whole task list. **Maintained.** If it disagrees with the running app, the app wins and this file is corrected in the same pass |
| **`TESTING.md`** | The testing policy, the regression plan, and all 1,686 scenarios across every screen. Maintained when the product changes under a scenario |
| **`INSTALL.md`** | Install, rollout and recovery — what a consultant does at a client's counter on install day: first run, claiming the tenant, migrating old data, backup/restore, login lockout, LAN multi-till setup, and what is not secure yet. Maintained when any of that machinery changes |
| **`artifacts/`** | Every artifact this project produces — the design source of truth, the review panel's findings, the Egypt compliance brief, and anything `pnpm` generates. Its `README.md` says what each one is |
| **`archive/`** | Everything retired: the original plan, the catalog, the reference audit, the distribution and demo notes, the enhancement requirements, the closed defect register, superseded mockups. Kept for evidence, not for current state. Read its `README.md` before trusting anything inside |

## Find it by question

| Question | Where |
|---|---|
| What is done, and what is broken right now? | `ROADMAP.md` §1–§2, §5 |
| What is left to do? | `ROADMAP.md` §3, §7, §8 |
| What is waiting on a human decision? | `ROADMAP.md` §6 |
| What is the testing policy, and are tests required? | `TESTING.md` §1 |
| How do I test after a big change? | `TESTING.md` §2, then the scenarios for the domains you touched |
| Does the whole product still agree with itself? | `TESTING.md` §14 — 76 posting trails, one per part, each crossing every module it touches (`pnpm trails` rebuilds the tickable page) |
| I'm standing at a client's counter on install day — where do I start? | `INSTALL.md` §1 |
| A trainee just locked an account and the till is stuck — now what? | `INSTALL.md` §5 |
| A laptop died — how do I get the client back into their books? | `INSTALL.md` §4.2 |
| What does this build NOT protect against yet, that I need to tell the client? | `INSTALL.md` §7 |
| What should the UI look like? | `artifacts/mezan-enhanced-mockups.html` — the design source of truth. `artifacts/directions/2-mishkah.html` is the type and colour authority in light, `6-thil.html` in dark |
| What did the review panel find, and what is still open from it? | `artifacts/simplification-review.html` |
| What does Egyptian law require that we do not have? | `artifacts/best-erp-in-egypt.html` |
| Where do I put a mockup, a generated page, or an Artifact I just published? | `artifacts/` — always, and add a row to its `README.md` |
| What was the original architecture and phasing, and why? | `archive/plan.md` §1–§7, `archive/phase-backlog.md` |
| Who do we compete with, and where are the gaps? | `archive/plan.md` §8 |
| What is the plan for HR / POS / Cloud? | `archive/plan.md` §9 |
| What was the requirement behind `R4.7` / `A2` / `D31`? | `archive/reference-parity/REQUIREMENTS.md`, `archive/gap-inventory.md`, `archive/defect-register.md` |

## The rules these documents are kept under

- **Three documents, not four (or one).** `ROADMAP.md`, `TESTING.md` and `INSTALL.md` are
  the whole live set — and the number stays a hard limit, not a starting point. The four
  files `ROADMAP.md`/`TESTING.md` replaced spent months disagreeing with each other about
  what was broken; an unbounded document count is how that starts again. `INSTALL.md` earned
  the third slot rather than folding into one of the other two because it answers to a
  different reader on a different clock: `ROADMAP.md` is what is built and what is still
  open, for whoever is building it next; `TESTING.md` is how any of that is proven, for
  whoever is testing it; `INSTALL.md` is how it reaches a paying customer's machine, for a
  consultant standing at a counter with a client watching, who has never opened this repo and
  never will. That reader does not want the regression plan or the open-defect list — they
  want the four steps of the first-run wizard and what to say when a trainee locks a till.
  Burying a rollout runbook inside `TESTING.md` is how it stops being found on install day;
  keeping it out of `ROADMAP.md` is why a rollout's day-to-day churn — a new client, a new
  machine, a recovered install — never has to touch the file that records what is built and
  broken. Before this file existed, a consultant with no install guide had two bad options:
  try the published dev password `Cyag@2026` (works in dev, fails silently on a packaged build with
  a bare `INVALID_CREDENTIALS`) or reverse-engineer the source — which is the defect that
  justified the third document, not a preference for tidiness. Do not propose a fourth
  document for a fourth kind of reader; propose folding it into one of these three first, and
  only add one if that folding actively hides what a reader of the other two needs.
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
