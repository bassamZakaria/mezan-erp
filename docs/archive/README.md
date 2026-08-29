# Archive — retired documents, kept for their evidence

**Nothing here describes the current state of the product.** Every file was retired on
2026-08-29 because its job was finished, its content moved into a live document, or it was a
point-in-time measurement that is now stale by design. They are kept rather than deleted
because each still answers a question the live documents cannot: *what did we measure, and
when?*

Read `../ROADMAP.md` for what is built and what is next, and `../TESTING.md` for how any of
it is verified.

| File | What it is | Why it was retired |
|---|---|---|
| `defect-register.md` | D1–D64 with the commit that fixed each, plus the readings that looked like defects and were not | Every defect is closed. Kept because a fixed defect is how its regression is recognised — `ROADMAP.md` §5 points here |
| `phase-backlog.md` | The original catalog-derived phasing: 15 phases, 233 candidate issues, sized and sequenced before the build started | Superseded by `ROADMAP.md` §2.2. Kept for traceability, and for the own-UI ruling in its §8 |
| `gap-inventory.md` | The screen-by-screen diff against the reference product, with the C1–C13 "do not copy" list | Parity work is complete; the diff is a 2026-08-26 measurement. Still cited from `ROADMAP.md` §2.2 and §4.2 for its ids |
| `audit-status-2026-08-26.md` | The route map and status of the three-round live audit | A point-in-time snapshot; the route counts have moved since |
| `audit-actions.md` | Every reference control, its effect, and the modal or menu it opened | Point-in-time audit evidence |
| `audit-coverage.md` | What the audit did **not** see | Point-in-time audit evidence; read it only to understand what that audit missed |
| `reference-enumeration-01-sales-quotes.md`, `-02-sales-invoices.md`, `-03-purchases.md` | Per-screen enumerations driven from the running reference product | Point-in-time; the requirements they produced live on in `../reference-parity/REQUIREMENTS.md` |
| `web-data-wiring.md` | The pattern for migrating a screen off `*-sample-data.ts` onto real persisted data | The migration is done — there is no mocked data anywhere in `apps/web`. Kept as the shape of the wiring |

## What was deleted rather than archived, and where it went

- **`STATUS.md`, `tasks.md`, `decisions.md`** → merged into `../ROADMAP.md`.
- **`testing-policy.md`, `testing-plan.md`, `scenarios/01..10`** → merged into `../TESTING.md`,
  scenario ids unchanged.
- **`/files`** at the repo root — the `site-feature-audit` skill's own example output
  (`demo.example.com`, "SCR-001 Home") committed by accident, plus a copy of the skill
  itself. It described no part of Mezan.

All of it is in git history.

## A note on links inside these files

They cite the paths that existed when they were written, so some point at documents that
have since moved or merged. The table above is the map. Nothing in here is edited to keep
its links current — editing an archived measurement is how a record stops being one.
