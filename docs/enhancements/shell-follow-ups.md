# Shell follow-ups — requested 2026-08-24

Queued behind the i18n sweep, in the order requested.

## 1. A better Arabic typeface

The Arabic face is currently whatever `font-ar` resolves to in
`packages/ui/src/tokens.css`. Pick a face that carries the design's weight range
and reads well at 12–13px, the size most of the app's body copy runs at, and
check it against the Latin face already in use so mixed runs (an Arabic label
next to `INV-000001`) sit on the same baseline.

## 2. A real icon per sidebar item

Every nav row currently renders a single letter in place of an icon — "S" for
Sales invoices, "P" for Price lists, and so on. Two rows starting with the same
letter are indistinguishable at a glance, which is the whole job an icon does.
115 nav entries need icons, or a rule that produces one per entry.

## 3. Organising the sidebar

115 entries in 17 groups. Worth revisiting grouping and order once icons land,
since the two decisions interact.

## 4. Search in the sidebar

The topbar command bar (`⌘K`) already searches nav entries, so this is about
whether the rail ALSO needs a filter. Note the command bar currently matches nav
items only — searching it for a report title ("قائمة الدخل") returns nothing,
which is worth fixing whichever way this goes.

## 5. A customisable main dashboard

`apps/web/src/dashboard/DashboardScreen.tsx` renders a fixed layout: the
balance-beam hero, the KPI strip, the attention queue, then four panels in a
hard-coded order (aging matrix, expense donut, top items, recent activity),
plus four fixed quick actions and a month/year/all range selector. Every
figure is real, but every user sees the same arrangement. A warehouse keeper
and an accountant want different things at the top of the screen.

The task is to let a user choose which panels appear, in what order, and keep
that choice. Concretely:

- Turn each panel into an addressable widget with a stable id, so a stored
  layout can name it. `Panel` is already a local component; the widget
  registry is the new part.
- A layout editor — show/hide per widget, reorder, and a reset-to-default. Two
  or three column-span sizes are probably enough; a free-form drag grid is more
  than this screen needs.
- Let the quick-action row be chosen too. It currently hard-codes four screens
  in `quickActions`; the set that matters differs per role.

Open questions worth settling before building: whether the layout is per user
or per role (per user is the usual answer, per role is what makes it useful on
day one of a rollout without every clerk configuring their own), and whether an
admin can push a default layout to everyone.

## 6. Somewhere to store per-user preferences

There is no per-user preference store anywhere in the repo — confirmed by
search across `packages/domain/src`, `packages/persistence/src` and
`packages/contracts/src`. Task 5 needs one, and it is not the only thing that
will: saved list filters, default branch, and the range the dashboard opens on
all want the same shelf.

Build it once as a small keyed store scoped to `(userId, key)` holding a JSON
value, behind the existing repository-port pattern so the Postgres dialect
comes free later. Do this before task 5, not inside it.

## 7. Widget visibility follows permissions

Whatever a user can put on their dashboard has to respect the permission
matrix — a user without `reports.aging.read` must not be able to add the aging
matrix, and a layout stored before a permission was revoked must degrade
quietly rather than render an error card. Worth building into the widget
registry from the start; retrofitting a permission check onto a stored layout
is where this kind of feature usually leaks data.

## 8. Mirror the directional icons under RTL

The app is Arabic-first and runs RTL, but almost nothing in the icon set is
mirrored. `packages/ui/src/primitives/beams.tsx` is the only place that does it
(`rtl:-scale-x-100`, and its comment explains why: a rise must lift towards the
reading direction). Everything else — the lucide set imported in
`apps/web/src/nav-icons.tsx` and the inline icons across the screens — renders
LTR-handed in an RTL layout.

Icons that carry a direction have to flip; icons that carry an object must not.
`Send` pointing away from the reader, `Undo2` and `RotateCcw` curving back,
`ArrowLeftRight` / `ArrowRightLeft` on the transfer screens, `TrendingDown`,
and the list/indent family (`ListOrdered`, `ListChecks`, `ListTree`,
`ClipboardList`) all read backwards in Arabic. A clock, a coin, a building or a
magnifier does not — mirroring those is the usual overcorrection, and
`PackageSearch` is the borderline case worth deciding once.

Do it as a rule, not per call site: mark the directional subset in one place
(the icon registry is already centralised in `nav-icons.tsx`) and have the
wrapper apply `rtl:-scale-x-100`, so a new screen cannot reintroduce an
unmirrored arrow. Then sweep the inline SVGs and glyph arrows outside that
registry — the chevron in `Select.tsx` rotates on the vertical axis and is
correct as-is, but the sweep is what proves there are no others.

Verify in the running app in both directions, not by reading the diff: this is
exactly the class of defect that passes typecheck and every test.
