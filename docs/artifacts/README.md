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

## Generated

| File | Rebuilt by |
|---|---|
| `trail-pack.html` | `pnpm trails` — parses the 76 posting trails out of `../TESTING.md` §14 and rebuilds this page whole. Edit the markdown, never the page. Not committed |

## The rule

**Any new artifact goes in this folder.** A published Artifact page, a generated report, a
mockup, a diagram — write it here, commit it here, and add a row above saying what it is. An
artifact nobody can find is an artifact nobody uses, and one sitting loose at the repo root
gets mistaken for source.
