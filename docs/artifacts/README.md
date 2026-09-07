# Artifacts

**Every artifact this project produces lives here.** Mockups, direction studies, published
Artifact pages, generated report pages — anything that is a rendered thing to look at rather
than prose to read. Nothing goes in a folder at the repository root, and nothing is left in
a scratch directory: if it is worth keeping, it is worth putting here.

Open any of them straight from the filesystem — they are self-contained HTML with no build
step and no external requests.

## Design

| File | What it is |
|---|---|
| `mezan-enhanced-mockups.html` | **The design source of truth.** The clickable enhanced mockup — where a question about what a screen should look like gets settled. Its prose companion is `../design/ux-enhancement-spec.md` |
| `mezan-contracting-designs.html` | **The المقاولات module design.** Twelve decisions the research in `../archive/contracting/` left open, each with the source that settles it and what would reverse it; the مستخلص modelled end to end — cumulative lines, the eleven-line deductions block, two approval states — plus the screens, the controls and the build order that follow. Palette and geometry are the shipped tokens, not a new identity |
| `directions/` | Each direction as a full working page — `1-mizan`, `2-mishkah` (the chosen light identity), `3-shubbak`, `4-daftar`, `5-tiraz`, `6-thil` (the dark palette) — plus the shell, nav, reports, components and frames studies they were judged on. **`2-mishkah.html` is the type and colour authority; `6-thil.html` is its dark half** — `tokens/fonts.css` and `check-theme-colour-only.mjs` both cite them |

The earlier mockups and the six-directions comparison page are in `../archive/`: the parity
`mezan-ui-mockups.html` that the shared primitives were built from, the
`mezan-directions.html` side-by-side that settled which identity to take, and
`mezan-roadmap.html`, which `../ROADMAP.md` replaced.

## Review and strategy

| File | What it is |
|---|---|
| `simplification-review.html` | **What to cut, what to fix** — 32 reviewers (the domain panel, every buyer persona, the craft specialists) read the docs and the code on 2026-08-28 and answered one question: what would make this simpler and better. 134 findings, each with file evidence, each carrying a status re-read against the code at `f8a1bb0`; 18 ranked "act on these first"; 16 decisions taken with what would reverse each. Filter by severity or status in the page |
| `best-erp-in-egypt.html` | **Every module Mezan ships, audited against the field** — 23 modules against QuickBooks, Odoo and 24 other products, plus the fourteen Egyptian statutory obligations that decide whether any of it is sellable. Five modules ahead of the field, nine at par, seven behind, two absent. Supersedes the 28-Aug scope brief, which is `../archive/egypt-scope-and-compliance-rev1.html` |
| `audit-2026-09-07.md` / `.html` | **The 7 September 2026 full audit.** Six specialist passes (sysadmin, security, product, accountant, performance, support) over `ab699559`, every claim verified in code. Nine blockers on licence and updates, the LAN operator gaps, eleven book-breaking defects, the performance floor at year-three volume, a support-ticket forecast, the doc drift table and a six-slice order. The `.md` is the source; the `.html` is generated from it by the session's `md2html` script |

Both are point-in-time and say so. Where either disagrees with `../ROADMAP.md`, the roadmap is
what is maintained — but check which is actually newer before assuming.

They also name documents that no longer exist under those names: a defect register, a status
file, a task list, a `scenarios/` directory and a `plan.md` at the top of `docs/`. Those are
now `../ROADMAP.md`, `../TESTING.md` and `../archive/`, and the review's own finding — that
four documents described this system and three of them disagreed — is what caused that merge.
Neither file is edited to keep its links current: editing a point-in-time record is how it
stops being one.

## Generated

| File | Rebuilt by |
|---|---|
| `trail-pack.html` | `pnpm trails` — parses the 76 posting trails out of `../TESTING.md` §14 and rebuilds this page whole. Edit the markdown, never the page. Not committed |

## The rule

**Any new artifact goes in this folder.** A published Artifact page, a generated report, a
mockup, a diagram — write it here, commit it here, and add a row above saying what it is. An
artifact nobody can find is an artifact nobody uses, and one sitting loose at the repo root
gets mistaken for source.
