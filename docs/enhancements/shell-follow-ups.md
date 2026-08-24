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
