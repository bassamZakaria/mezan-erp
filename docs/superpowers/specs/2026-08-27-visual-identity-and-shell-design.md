# Mezan visual identity and shell — design

Date: 2026-08-27
Status: proposed, awaiting approval
Supersedes: §3.4 (visual language) and §3.6 (sidebar) of
`2026-08-27-ui-revamp-design.md`. Every other section of that spec still binds,
including all twelve ground rules in its §2.

## ملخّص بالعربية

الهوية الجديدة اتجاه واحد اسمه **المِشكاة**: الهندسة الإسلامية كبنية لا كزخرفة —
ألواح متراصة حافة بحافة، وزوايا مقصوصة بدل الحدود، وحجر دافئ، ولون فعل واحد.
له لوحتان لونيتان: فاتحة (افتراضية) وداكنة مستمدّة من اتجاه **الظِّل**.
**اللون وحده هو ما يتغيّر بين الثيمين** — لا الخط ولا الاستدارة ولا الكثافة.
والشريط الجانبي يصير مُسمّى بالكلمات، رأسه شغل المستخدم، وقابلًا للطي، ومحفوظًا على الخادم.

## 1. Decisions

### 1.1 One structure, two palettes

The identity is **المِشكاة (Lantern)**: Islamic geometry as structure rather than
ornament — panels tiling edge to edge, notched corners instead of drawn borders,
warm stone neutrals, and a single high-chroma action colour.

Light is the default palette. Dark is a first-class second palette that takes its
qualities from the **الظِّل (Nightdesk)** direction: deep warm surfaces, a gold
action colour, and mono figures.

**A theme change alters colour only.** This was the load-bearing finding: measured
across the two directions as originally drawn, 12 of 14 structural tokens differed,
including `--h-btn` at 44px in Lantern and 38px in Nightdesk. Shipping them as a
light/dark pair would mean the dark theme silently violates ground rule §2.1 that
the light theme satisfies, and would change the typeface, corner radius and row
density on toggle — breaking muscle memory, training screenshots and support scripts.

Therefore the dark palette redefines **only** colour tokens. Geometry, type and
size tokens are deliberately absent from the dark block. This is enforceable: a
lint rule asserting the dark block contains no `--h-*`, `--fs-*`, `--pad*`, `--r`
or `--font-*` declaration.

The lapis action colour (`#2E3A8C`) cannot carry a dark surface at accessible
contrast, so the dark palette substitutes gold (`#E0A93B`) for the action role.
This is a role substitution, not a second brand colour: light uses exactly one
action colour and so does dark.

### 1.2 Type

Display: **Zain**. UI and body: **Readex Pro**. Figures: **IBM Plex Mono in both
themes**. Latin: IBM Plex Sans.

An earlier draft of this section said "Readex Pro in light, IBM Plex Mono in dark".
That was a contradiction of §1.1 — a typeface that changes on theme toggle is
precisely what the colour-only rule forbids, and the lint rule written to enforce
§1.1 rejects it. Figures use one face in both themes.

All faces ship as subsetted `woff2` inside `packages/ui/src/assets/fonts/` with
local `@font-face`. The remote `@import` in `tokens/fonts.css` is deleted.

**Correction of record.** An earlier draft of this spec claimed the repository
contained zero font files and loaded fonts over `https://fonts.googleapis.com`.
That was true when the design audit ran, and was fixed independently in commit
`daa7291` before implementation began — fonts were already self-hosted via
`@fontsource/*` npm packages. What this section changes is therefore the *choice of
faces*, not the hosting: `@fontsource` carries Tajawal / Reem Kufi / IBM Plex Sans
Arabic, and the identity needs Zain / Readex Pro. Vendored woff2 replaces the
npm dependency; the now-unused `@fontsource/*` packages must be removed from
`packages/ui/package.json`.

**Verified constraint — the figure face.** IBM Plex Mono contains **no Arabic-Indic
digits** (U+0660–0669); this was confirmed by cmap inspection, not assumed. Readex
Pro's Arabic subset carries all ten. Ground rule §2.3 requires one numeral system
per user, so `--font-mono` must keep Readex Pro in its fallback chain and that
fallback is load-bearing: if a user selects Arabic-Indic numerals, dark-theme
figures fall through to Readex Pro rather than rendering nothing. Do not trim it.

### 1.3 The shell

Navigation is a **word-labelled rail, personal at the top, collapsible**:

1. Search over all destinations.
2. This user's pinned screens.
3. This user's recently opened records.
4. The six workspaces, labelled.
5. One control that collapses the rail to a 60px icon column.

The personal block leads because it is what stops a labelled rail reading as the
category's default silhouette: the first thing on screen is this person's six or
seven daily screens, not the software's own map. The full tree stays one click
away behind كل الشاشات, unfiltered by personalisation.

Rejected: the current 56px wordless icon spine (meaning lives in a tooltip, which
ground rule §2.5 forbids), and role-differentiated navigation (already rejected in
the parent spec §5, and for the same reason).

### 1.3b Already landed before implementation

Two defects this spec was written to fix were closed independently in `daa7291`
and are recorded here so nobody re-opens them: `SidePanel` now moves focus into
itself on open and traps Tab with a working Escape, and the sidebar `<nav>` now
carries an accessible name. `.mz-eyebrow` no longer applies `text-transform` and
scopes `letter-spacing` to the Latin path only. The lesson is worth keeping: a
design audit's defect list has a shelf life, and every item must be re-verified
against HEAD immediately before it is worked, not when it was written.

Still open at the time of writing: `ExpenseDonut` and `TopItems` remain mounted on
`DashboardScreen`, contrary to the parent spec §3.2.

### 1.4 Personalisation persists server-side

Pins, recents, collapsed state, dashboard layout, shortcut tiles, chosen columns
and numeral system move from `localStorage` to a per-user preferences service.

Every customisable screen carries a **«استعادة الوضع الافتراضي»** control in a
fixed position, layouts are **named** so a caller can read the name aloud, and an
admin can view any user's layout read-only.

This is not cosmetic: support ranked device-divergent pins and a silently emptied
dashboard as its top two predicted ticket sources, and the second reads to a
panicked user as data loss even though the ledger is untouched.

### 1.5 The signature instrument

`BalanceBeam` is promoted from a dashboard element to the product's signature
component, generalised over two kinds of truth:

- `equal` — these two must agree: daily cash close, trial balance, bank
  reconciliation, stock count, any sub-ledger against its control account.
- `ceiling` — this must not exceed that: credit limit, budget, reorder point.

It renders both sides, a plain-Arabic verdict, and a «أين الفرق؟» control that
opens the entries making up the difference.

**A ceiling not yet reached is good news and must never render as a shortfall.**
The first build of this component printed «ناقص بمقدار ٢١٬٩٧٨٫٤٠» for a customer
comfortably inside their credit limit; the verdict sentence must be parameterised
by mode, not by arithmetic sign alone.

### 1.6 Borrowed mechanics

Generic, adopted deliberately, none carrying another product's visual signature:

- **Money bar** — status as a clickable money total rather than a filter chip.
- **Relative dates** — «متأخرة ٢١ يومًا» rather than a date the reader must subtract.
- **Record pager** — walk a filtered list from inside the document.
- **Related-record counters** — counted links to issues, payments, returns, the journal entry.
- **Unapplied credit on the document** — apply a credit note without leaving the invoice.
- **طابِق / جديدة / استبعد** — bank review with no debit or credit vocabulary.
- **Report control bar** — period presets, compare period, accounting basis, column split.
- **Printed filter line** — the applied filters print with the report.
- **Report groups** — a saved set that runs and prints in one action.

Explicitly not adopted: hiding accounting vocabulary permanently. Guided flows show
the colloquial phrasing and the formal term together («تحصيل فلوس من عميل» →
«المصطلح الرسمي: سند قبض»), because this user works with an accountant and the ETA.

## 2. Non-goals

No business logic, ledger arithmetic or posting behaviour changes in this work.
No new reports — the catalogue of 32 definitions is already deeper than the
comparison set. No role-differentiated navigation. No dense default layout.

## 3. Build order

Each phase ends on a running, seeded app that can be opened and judged, and on the
always-on gates: `pnpm typecheck && pnpm lint && pnpm build`, then `pnpm smoke`,
`pnpm check:seed`, `pnpm scenarios`.

1. **Tokens and fonts.** Normalise `tokens.css` to the shared contract; fill it with
   the Lantern light values; add the dark block (colour only); vendor the woff2
   files and delete the remote `@import`; remove `text-transform`/`letter-spacing`
   from the Arabic path; add the lint rule from §1.1.
2. **Atoms.** 44px minimums; retire `Card`, `StatCard`, `DocumentListStat`;
   `Chip` becomes an honest segmented control; hairlines replace shadows.
3. **Shell.** The rail from §1.3, workspace bar, and the gutter slot in `AppShell`.
4. **Preferences service.** The endpoint from §1.4 plus reset, naming and admin
   read-only. Migrate existing `localStorage` pins on first run.
5. **The instrument.** Generalise `BalanceBeam` per §1.5; first uses are the daily
   cash close, the trial balance and customer credit.
6. **List and document primitives.** Money bar, relative dates, column chooser,
   record pager, related counters, credit box; `SidePanel` reduced to short master
   data and its focus defect fixed.
7. **Reports.** The control bar, the printed filter line, drill-down on every figure,
   and report groups.
8. **Create flows.** Create hub, blank-document state, quick create in context, and
   the five guided flows.

## 4. Open questions

- **Frame.** §1.3 fixes the navigation but not the page frame. The candidates and
  their cost in remaining content width are drawn in `design/directions/frames.html`.
  Phase 3 cannot start until this is chosen.
- **Dark theme rollout.** Whether dark ships with phase 1 or after phase 8. Shipping
  it late risks the same drift the parent spec suffered, where §3.4 decided hairlines
  and the code kept shadows.

## 5. Artefacts

Live mockups, all Arabic/RTL on seeded data, in `design/directions/`:
`index.html` (entry), `frames.html`, `nav.html`, `changes.html` (before/after),
`components.html` (the 59-component map), `learn.html`, `reports.html`, and the six
direction pages.
