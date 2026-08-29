# Mezan — documentation map

Six documents and three directories. Start with the one that answers your question.

## The three you will use daily

| Document | What it answers | Goes stale? |
|---|---|---|
| **`ROADMAP.md`** | What is built, what is open, which defects are known, which decisions wait on a human, and the whole task list | Yes — and it is maintained. If it disagrees with the running app, the app wins and the file is corrected in the same pass |
| **`TESTING.md`** | The testing policy, the regression plan, and all 1,686 scenarios across every screen | Only when the product changes under a scenario |
| **`plan.md`** | Architecture and tech stack (§1–§3), module build order (§4), risks (§5–§7), the market and competitor study (§8), the deferred HR/POS/Cloud plans (§9) | No |

## The rest

| Document | What it answers |
|---|---|
| `distribution.md` | Which bundle is sold to which industry, what can honestly be sold today (§2), and how to branch and release when every customer self-hosts (§4–§5) |
| `workflows.md` | What to show a prospect in a demo, and in what words (§2–§3); which periodic actions are proven to work (§3.5, a dated measurement) |
| `catalog/01..10` | The reference product's 125 screens, field by field — a label snapshot. It records that a field exists, not whether it is a picker or a text input |
| `reference-parity/` | `REQUIREMENTS.md` — the ~90-requirement register read from the running reference product, plus 8 reference defects not to reproduce. `API-SURFACE.md` — 201 GET endpoints with their query contracts. Where this and `plan.md` disagree about the scope of a screen, **the register wins** |
| `design/` | `ui-revamp.md` (approved, in build), `visual-identity-and-shell.md` (the المِشكاة identity, superseding the revamp's §3.4 and §3.6), and `ux-enhancement-spec.md` with its clickable mockup at `design/mezan-enhanced-mockups.html` |
| `enhancements/` | `requirements.md` (ENH-###) and `workflows.md` (WF-##) — the beyond-parity requirements and the workflows they enable. The backlog that ranks them is `ROADMAP.md` §7 |
| `archive/` | Retired documents, kept for their evidence. Read its `README.md` before trusting anything inside |

## Find it by question

| Question | Where |
|---|---|
| What is done, and what is broken right now? | `ROADMAP.md` §1–§2, §5 |
| What is left to do? | `ROADMAP.md` §3, §7, §8 |
| What is waiting on a human decision? | `ROADMAP.md` §6 |
| Why are we not writing unit tests? | `TESTING.md` §1 |
| How do I test after a big change? | `TESTING.md` §2, then the scenarios for the domains you touched |
| Does the whole product still agree with itself? | `TESTING.md` §14 — 76 posting trails, one per part, each crossing every module it touches (`pnpm trails` rebuilds the tickable page) |
| What is the architecture, and why? | `plan.md` §1–§3 |
| Who do we compete with, and where are the gaps? | `plan.md` §8 |
| What is the plan for HR / POS / Cloud? | `plan.md` §9 |
| What does the reference app actually do? | `catalog/01..10`, then `reference-parity/REQUIREMENTS.md` for what was read from it running |
| What should the UI look like? | `design/` |

## The rules these documents are kept under

- **An item is ticked only when it has been driven in the running app** on seeded data, in
  both locales (ar/RTL and en/LTR) and both themes. A green test is not a tick.
- **A defect is never deleted.** It moves to `archive/defect-register.md` with its fix
  commit, because that is how its regression is recognised.
- **A decision is never deleted either.** Taking it records the option chosen and why, so
  the next person knows the alternative was considered.
- **Point-in-time measurements carry their date**, and are moved to `archive/` once they
  stop describing the present.
