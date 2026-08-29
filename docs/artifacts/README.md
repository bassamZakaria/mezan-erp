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
| `mezan-ui-mockups.html` | The parity UI mockups the shared primitives were built from — `DocumentList`, `DocumentDetail`, `SidePanel`, `AccountTree` and the charts all cite it |
| `mezan-directions.html` | The six visual directions, side by side, with the reasoning for each |
| `directions/` | Each direction as a full working page — `1-mizan`, `2-mishkah` (the chosen light identity), `3-shubbak`, `4-daftar`, `5-tiraz`, `6-thil` (the dark palette) — plus the shell, nav, reports, components and frames studies they were judged on. `2-mishkah.html` is the type and colour authority; `6-thil.html` is its dark half |
| `mezan-roadmap.html` | The roadmap as a page, for showing rather than reading |

## Review and strategy

| File | What it is |
|---|---|
| `simplification-review.html` | **What to cut, what to fix** — 32 reviewers (the domain panel, every buyer persona, the craft specialists) read the docs and the code on 2026-08-28 and answered one question: what would make this simpler and better. 134 findings, each with file evidence, each carrying a status re-read against the code at `f8a1bb0`; 18 ranked "act on these first"; 16 decisions taken with what would reverse each. Filter by severity or status in the page |
| `egypt-scope-and-compliance.html` | **Best ERP in Egypt** — the scope brief that inverts the frame: Egyptian statute sets what must exist and QuickBooks is demoted to an instrument for deciding how few screens can carry it. Fourteen statutory obligations audited against the code (nine handled, two partial, three missing), the 2026 threshold and Law 6/2025 shifts, the moat, and all 115 nav entries verdicted screen by screen |

Both are point-in-time and say so. Where either disagrees with `../ROADMAP.md`, the roadmap is
what is maintained — but check which is actually newer before assuming. They also cite the
document names that existed when they were written — `docs/defects.md`, `docs/STATUS.md`,
`docs/tasks.md`, `docs/scenarios/*` — all of which are now `../ROADMAP.md`, `../TESTING.md`
and `../archive/`; the review's own finding that four documents disagreed is what caused that
merge. Neither file is edited to keep its links current: editing a point-in-time record is how
it stops being one.

## Generated

| File | Rebuilt by |
|---|---|
| `trail-pack.html` | `pnpm trails` — parses the 76 posting trails out of `../TESTING.md` §14 and rebuilds this page whole. Edit the markdown, never the page. Not committed |

## The rule

**Any new artifact goes in this folder.** A published Artifact page, a generated report, a
mockup, a diagram — write it here, commit it here, and add a row above saying what it is. An
artifact nobody can find is an artifact nobody uses, and one sitting loose at the repo root
gets mistaken for source.
