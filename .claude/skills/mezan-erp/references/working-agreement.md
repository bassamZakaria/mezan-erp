# Working agreement — standing preferences from this project's sessions

These are the user's own instructions, repeated across many sessions. Following them
without being asked again is the point of writing them down.

## Priorities

- **Land it correctly, then land it quickly.** Parallelism is a means, never a goal:
  "efficiency and better work is more important than working in parallel". Do not
  fan out just to look busy, and do not force parallel work onto one file.
- **Token spend is a real constraint.** No agent logs, no narration, no long recaps.
  Short answers. Prefer plain `.md` files over artifacts when an artifact would cost
  more, and say so rather than silently producing both.
- **Finish what is open before starting anything new.** Repeatedly: "finalize the
  current work and don't start any new work".
- **Handle what needs no input yourself.** Only bring back the decisions that
  genuinely need the user.

## Data and fixtures

- **No mocked or sample data in application code — ever, in any project.** Fixtures go
  in the backend seeder and reach the UI through the real API. Seeded demo data must
  be development/testing-only and never reach a real install.
- If an endpoint does not exist yet, build the endpoint. Do not stand in a constant.
- Placeholders must be visibly incomplete and tracked in a register with a stated
  owner condition — a fabricated plausible number is indistinguishable from a bug, and
  a user who finds one stops trusting every other number on the screen.

## Verification

- **Open the running app and click it.** Code reading, green tests and "the component
  exists" prove nothing about whether a control is wired.
- **Reload the page** after every save — that check alone has caught several
  "works until you look again" bugs.
- Browser work goes in **this session's own Chrome tab group** in the user's current
  window (`tabs_context_mcp` with `createIfEmpty: true`), reused for the whole session.
  Never hijack one of the user's tabs, never scatter loose ones.
- Audit against the **running** reference, not a written catalog, and count operable
  screens — usable end to end against the real API — not files.

## Git and process

- Work on a **worktree branch**, not directly on the current branch.
- **No `Co-Authored-By` trailers.** Author is Bassam Zakaria.
- Branch model the user asked for: `main` faithful to the captured catalog, a UI
  branch off main, and a features branch off the UI branch for new workflows.
- Serial merges, not races: when several agents finish, one coordinator integrates.
- Preserve the repo's PR template; fill in sections rather than deleting them.
- Keep CI interaction light; local gates first.

## UI and language

- **Arabic-first, RTL.** Domain refusals must surface in Arabic — an English state
  machine error inside the Arabic UI is a defect (D15).
- Light theme is the default; dark must still work.
- Sidebar uses real outline icons (lucide), never first-letter monograms; readable
  sizes; a readable Arabic font.
- The language switcher must actually change the UI language — the settings copy of it
  was removed; the switcher is the one control.
- Design authority is `design/mezan-enhanced-mockups.html` (serve over HTTP; `file://`
  is refused by the browser tooling). The older `mezan-ui-mockups.html` loses where
  they disagree. No human designer is reachable — ClickUp returns nothing for this
  project and Slack is unauthenticated.
- Functionality first when the two compete: "I care more about the functionality at
  first" — but a token that does not exist silently renders nothing, so colour and
  contrast still get checked (F2).

## Naming and content

- Company name is **cyag**. Demo user is **محمد الشهابي** (Mohamed el Shehaby), PIN `1234`.
- **Never mention the competing product this catalog was captured from** — not in code,
  docs, UI, commit messages or artifacts.

## Module priority

Accounting, Treasury (الخزينة), Installments (الأقساط), Inventory, Purchases and Sales
are the highest priority. POS and the SaaS website are deferred by decision. HR exists
but its statutory payroll rules are unbuilt and must be visibly flagged rather than
silently computing a wrong net.

## Documentation

- One status document (`docs/ROADMAP.md §1`); audits get archived, not left to rot in place.
- Record decisions and known defects where the next person will actually read them —
  a comment promising a follow-up sweep tracks nothing.
- When something is lost in a merge, say what was lost and restore it explicitly; two
  capabilities were silently dropped that way once.
