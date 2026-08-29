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

## Retired 2026-08-29 in the second pass — `docs/` reduced to two documents and two directories

| File | What it is | Why it was retired |
|---|---|---|
| `plan.md` | The whole original plan: architecture and tech stack (§1–§3), module build order (§4), risks and open questions (§5–§7), the competitor and market study (§8), the deferred HR/POS/Cloud build plans (§9) | The architecture it describes is the architecture that got built, so it is a record rather than a plan. Still the answer to "why is it shaped like this?", and the lint rule in `eslint.config.js` cites its §3.2 by name |
| `phase-backlog.md` | The original catalog-derived phasing — 15 phases, 233 candidate issues | Retired in the first pass; see the table above |
| `catalog/01..10` | The reference product's 125 screens, field by field | A label snapshot of somebody else's product, taken before the build started. Parity is complete; it is now provenance |
| `reference-parity/` | `REQUIREMENTS.md` — the ~90-requirement register (R1.1 … R12.2) read from the running reference product, plus 8 reference defects not to reproduce. `API-SURFACE.md` — 201 GET endpoints with their query contracts. `screenshots/` — Mezan's own screens only | The R-ids are cited throughout `ROADMAP.md` §2.2 and from source comments, so this stays readable — but it is a 2026-08-26 capture, not a live specification |
| `distribution.md` | Which bundle is sold to which industry, what could honestly be sold then (§2), and how to branch and release when every customer self-hosts (§4–§5) | Point-in-time commercial positioning; §2's "what can be sold today" was measured against a build three weeks old |
| `workflows.md` | The customer-facing flow behind each bundle, in the words a prospect hears; §3.5 is a dated verification table | Demo script, not a specification |
| `enhancements/requirements.md`, `enhancements/workflows.md` | The beyond-parity requirements (ENH-###) and the 17 workflows they enable (WF-##) | The backlog that ranks them is `ROADMAP.md` §7, which cites these ids. Nothing here is started |
| `ux-enhancement-spec.md` | The prose behind the enhanced mockup: why the identity evolved and what each decision was weighed against | The mockup itself is the design authority and is live in `../artifacts/`. The prose explaining it is history |
| `mezan-ui-mockups.html` | The earlier parity UI mockups | Superseded by `../artifacts/mezan-enhanced-mockups.html`. Kept because five shared UI primitives — `DocumentList`, `DocumentDetail`, `SidePanel`, `AccountTree` and the charts — were built from it and still cite it |
| `mezan-directions.html` | The six visual directions side by side, with the reasoning for each | The decision it exists to support was taken: المِشكاة won. The chosen direction's own page stays live in `../artifacts/directions/` because it is the type and colour authority |
| `mezan-roadmap.html` | The roadmap as a page | Superseded by `../ROADMAP.md` |

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
