# UI revamp — design record

The working record behind the 2026-08 interface revamp: what was wrong, what was decided, and
what is still open. Every finding in these documents cites the file and line it was read from,
and the load-bearing ones were re-verified by hand against the running app.

Open the HTML files in a browser (they are self-contained — no build step, no network).

| Document | What it is |
|---|---|
| [`2026-08-27-ui-revamp-design.md`](../superpowers/specs/2026-08-27-ui-revamp-design.md) | The approved spec: the problem, twelve non-negotiable ground rules, thirteen decisions, and the build order. Start here. |
| [`interface-directions.html`](interface-directions.html) | The options that produced the spec — navigation model, dashboard content, reports and configuration placement, visual language, depth, rail behaviour, action placement, drawers versus pages, feedback, page frame, learnability, filtering, and where the product's distinctiveness lives. |
| [`element-audit.html`](element-audit.html) | Every one of the 56 UI elements audited across four lenses — design, information design, accessibility, and the everyday operator. Filterable by verdict and priority. 19 came back clean; the rest trace to seven root causes. |
| [`design-plan.html`](design-plan.html) | The nine design decisions still open, each drawn as a figure showing the real difference between the choices. |

## The audience constraint

Everything here is subordinate to one fact: the person who opens this app every morning is a
non-technical Egyptian SMB operator who never trained on software. The twelve ground rules in the
spec exist to make that constraint checkable in review rather than aspirational.

## Status at the time of writing

Phase one has landed on the revamp branch: the six-workspace navigation, the rail that learns what
a user pins and opens, honest list-filter semantics with zero-count suppression, the shared toast /
confirm / skeleton system, and a measured content column.

Still open, in the order they pay off:

1. **Touch** — raise the shared control-size floor, then the eight controls that size themselves.
2. **Truth** — the `Math.abs` sign-drop in the pie view, the numeral split between display and input,
   and the hover-hidden row action.
3. **Focus** — port `ConfirmDialog`'s focus trap into `SidePanel`, `CommandPalette` and
   `NotificationsPanel`.
4. **Words and paper** — the ten worst strings, and the print output.
