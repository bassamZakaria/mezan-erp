# UX enhancement — review pack

**2026-08-23 · branch `ui-enhancements` · reviewed against `docs/enhancements/design/ux-enhancement-spec.md`**

The enhancement is code-complete. This pack exists so people, not a checklist,
sign it off: it separates what was verified in the running app from the four
things that need a human decision.

## How this was verified

Against a real backend on a clean demo seed, not a fixture: `MEZAN_SEED_DEMO=1`,
115 nav entries, 3 posted invoices, live GL.

- **13 screens × 2 themes** driven in a browser, each measured for WCAG contrast
  and horizontal overflow. Result: **0 contrast failures, 0 overflow** — after
  the fix below.
- **Palette and geometry read out of the running document** and compared value
  for value with the spec.
- **Keyboard flows exercised live** — not asserted in a test.
- `pnpm typecheck`, `pnpm lint` (1,183 files, RTL + colour tokens), `pnpm build`,
  `pnpm smoke` (114 read surfaces) all pass.

## What the sweep found

One real defect, and it is the interesting one:

**The selected financial-statement tab was unreadable.** It used `text-on-brand`
— a token that exists nowhere — so Tailwind emitted no rule and the button
inherited body ink: near-black on the dark teal brand, **1.52:1** where 4.5:1 is
the floor. Two sibling bugs of the same shape: two inputs with no focus
indicator (`focus:border-primary`), three leave screens with no banner
background (`bg-surface-muted`).

This class of bug passes typecheck, lint, build and 2,400 unit tests, because a
misspelled colour token is not an error in Tailwind — the class just vanishes.
`pnpm lint` now fails on it, using the compiled stylesheet as ground truth.

## Fidelity to the spec

Read out of the live document, light theme:

| Spec | Built | |
|---|---|---|
| `--brand` `#0C463E` | `#0c463e` | ✅ |
| `--accent` `#B0862F` | `#b0862f` | ✅ |
| `--bg` `#F2EFE9` | `#f2efe9` | ✅ |
| `--chrome` `#0B3A34` | `#0b3a34` | ✅ |
| Radii 5 / 8 / 14 | 5px / 8px / 14px | ✅ |
| Focus ring 2px brass, 2px offset | `rgb(176,134,47) solid 2px`, offset `2px` | ✅ |
| Reduced-motion gate | global rule present | ✅ |

Behaviour, exercised live:

| Spec §7 | Observed |
|---|---|
| `?` shows the shortcut list | opens, `Esc` closes |
| `g` then a letter jumps modules | `g i` → المخزون |
| `/` focuses the in-page search | focuses the list's own search on a list screen; falls back to the command bar where a screen has none |
| Typing guard | with the caret in the command bar, `gis` inserts the literal text and does not navigate |

§4 (fulcrum rule, balance beam, variance beams), §5 (rail, command bar, 36px
tables, sticky header, zebra, hover row action), §6 (KPI micro-beams, needs-
attention queue, heat-tinted aging, donut, ranked items) are all present in both
themes and both directions.

## Four things that need a decision

**1. The rail's company card is not the switcher §5 describes.**
The spec pins the branch/company switcher to the top of the rail. What is built
is a display-only card there (`Cyag · All branches` — a plain `div`, not
focusable), with the working branch and warehouse switchers in the topbar. Both
switchers function; this is a placement question, not a broken control.
*Designer's call: move them into the rail, or amend the spec to match the build?*

**2. English mode is only half translated.**
The shell and the new components are bilingual — the dashboard renders fully in
English. Most screen bodies are still inline Arabic literals, so switching to EN
gives an English shell around an Arabic financial report. i18n was deferred by an
earlier decision and this is that decision's visible edge, not a regression.
*Product's call: is a half-translated EN acceptable to ship, or should the
switcher be hidden until the catalogue is complete?*

**3. Variance beams are not on the report comparison columns.**
The mockup shows them there. No report computes a period-over-period variance —
the income statement has three columns and no prior-period field — so the beams
are applied only where a real signed delta exists: physical counts, FX
revaluation, van-trip settlement. A `"variance"` column format is ready in
`ReportRunner`. Filling those columns would have meant inventing the numbers.
*Product's call: is a comparative report worth scheduling?*

**4. 28 assertions in 13 spec files describe the old markup.**
Business-logic test execution is disabled by decision (`docs/testing-policy.md`);
2,407 assertions still pass, 28 do not. Every one checked is a stale expectation,
not a defect — e.g. `SEQUENCE_DEFINITIONS` now has 33 entries where the spec says
31 (two sequences were added), and template attributes gained a
`specificationCode` field. Nothing is broken; the specs are simply older than the
code.
*Engineering's call: refresh them, or delete them while execution stays off?*

## Recommendation

Merge `ui-enhancements` into `main`. Items 1–3 are product and design decisions
that do not block the merge; item 4 is inert while test execution is off.
