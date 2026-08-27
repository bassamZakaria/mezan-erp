# Mezan UI revamp — design

Date: 2026-08-27
Status: approved, in build
Audience constraint: the daily operator is a non-technical, non-specialist Egyptian
SMB user. Every decision below is subordinate to the ground rules in §2.

## 1. Problem

The app is not disliked because it looks dated. It is overwhelming because it is
organised around how the software is built, and because it hides nothing.

Measured on the running seeded build:

| Observation | Count |
|---|---|
| Top-level sidebar groups (plus 11 more in the gear menu) | 14 |
| Navigable destinations, all at one depth in one tree | 117 |
| Reports quarantined away from the data they describe | 22 |
| Hub screens nested *inside* the group they front | 10 |
| Equally-weighted action buttons on the dashboard | 8 |
| Unranked panels on the dashboard | 7 |
| Screens editing inside a fixed 430px drawer | 62 |
| Screens hand-rolling their own status message | 54 |
| Toasts, confirm dialogs or skeletons in the product | 0 |
| Max width on `<main>` | none |

Plus: `DocumentList` renders status chips at zero count while the useful filter bar
starts collapsed; chips are `aria-pressed` buttons inside a `role="tablist"`; chip
targets are 31px; the sales-invoice page prints `SalesInvoiceService (...)` as its
subtitle; the aging matrix heads columns in Arabic-Indic numerals and fills cells in
Western ones.

## 2. Ground rules (bind every section below)

1. Every control ≥44px in its smallest dimension.
2. Never colour alone — colour + shape/icon + word.
3. One numeral system per user, never mixed on a screen.
4. Label by the task first, the accounting term second.
5. Nothing appears only on hover.
6. Irreversible actions state their consequence in one plain Arabic sentence.
7. No English on the product surface — no class names, enum values or raw errors.
8. Empty is never blank: name what is missing, offer the button that creates it.
9. Everything works at 125% browser zoom with no overlap and no sideways scroll.
10. The control a screen exists for is never collapsed by default.
11. Uniqueness is never spent on controls. Buttons, fields, tables and menus behave
    conventionally; distinctiveness goes into structure, typography and one signature
    instrument (§3.13).
12. Shop test: a first-time viewer can say aloud what the screen is for and what its
    main button does, within five seconds.

## 3. Decisions

### 3.1 Navigation — job-shaped workspaces
14 module groups collapse to 6 workspaces named after the work: البيع والتحصيل،
الشراء والتوريد، المخزون والتصنيع، المالية والإقفال، الأشخاص والأصول، الإعداد والصلاحيات.
Each workspace opens its hub; the hub owns its documents, its master data and its
reports. Nothing is removed — every one of the 117 destinations stays reachable
through search, the command palette, and its workspace hub.

### 3.2 Dashboard — a worklist
The page answers «ماذا أفعل الآن؟». Rows are units of work with the button that does
them: overdue invoices to collect, approvals waiting, cheques maturing, stock at
reorder, unposted documents, period-close blockers. Financial totals compress to one
strip; charts move to a تحليلات tab.

### 3.3 Reports and configuration
Reports attach to their subject's hub; a single كل التقارير index remains for browsing
by name. `ميزان المراجعة` and `القوائم المالية` each get one home and are cross-linked,
not duplicated. Set-once configuration (price lists, promotions, product templates,
item specifications, pipeline stages, leave policies, payroll components, asset
categories, sequences) moves behind each hub's إعدادات shelf.

### 3.4 Visual language
Refined treatment: tighter type scale, depth from hairline borders rather than drop
shadows, accent used only where it means something, tabular figures throughout.
**Light stays the default theme** per the standing working agreement; dark is a
first-class, equally designed theme rather than an inversion.

### 3.5 Depth
Structure, shell, shared primitives and a content sweep first; then hand-tune the
eight highest-traffic screens. The remaining ~80 inherit the gain through the
primitives.

### 3.6 Sidebar
The rail opens on this person's own work: pinned screens, recently opened records, and
a search box filtering all 117 destinations. The full tree moves behind كل الشاشات.
Identical for every user — personalised by use, not by role, so support and training
stay uniform.

### 3.7 Actions
Each screen declares exactly one primary action — a required field of the page header,
so no screen can ship without the decision being made. One or two frequent secondaries
render as outlined buttons; everything else moves into an overflow menu.

### 3.8 Where work happens
Anything with line items, a status lifecycle or a financial consequence becomes a
routed page with a URL. Drawers remain for short master data only. Every document
status must have a visible control that advances it.

### 3.9 Feedback and states
One shared system replaces 54 hand-rolled status messages: toast for success (with
undo where genuinely reversible), a confirm dialog that names the consequence,
skeletons for loading, and empty states that name the missing thing and offer its
create button.

### 3.10 Page frame
Content sits in a max-width column with real gutters. Comfortable row density is the
default; a مضغوط setting provides the dense variant. Motion stays as on the dashboard:
one quiet entrance, nothing looping, nothing delaying a keystroke.

### 3.11 Learnability
The five daily tasks — sell, collect, receive goods, pay a supplier, adjust stock —
get short guided flows that ask one thing at a time in task language, each with an
escape link to the full form. Search and the command palette accept colloquial phrasing
(«أستلم فلوس من عميل» → سند قبض) and show the formal term alongside, so the vocabulary
is taught rather than assumed.

### 3.12 Filtering
Status chips are replaced by named views phrased as the question the user asks
(«اللي عليّ أحصّله»). Views with no rows hide themselves. Search is one always-visible
box. Additional filters are chosen from a menu and then displayed as removable tags, so
what is applied is written on screen rather than remembered. Where chips survive, they
become an honest single-select segmented control with correct ARIA and 44px targets.

### 3.13 Distinctiveness — the balance made real
`ميزان` is the product's name and double-entry is two sides that must agree. One
component expresses that and is reused wherever the same truth applies: the daily cash
close, the trial balance, bank reconciliation, stock counts, and any sub-ledger against
its control account. It shows both sides, a plain verdict (balanced, or short by this
much), and where to look for the difference. This is the single place originality is
spent, and it doubles as teaching double-entry to someone never taught it.

## 4. Build order

1. **Foundation** — tokens, layout frame, i18n keys, shared feedback primitives.
2. **Shell** — workspace IA, rail with pins/recents/search, page header with a required
   primary action.
3. **List and document primitives** — named views, filter tags, honest segmented
   control, zero-count suppression, skeletons and empty states, dev-copy removal.
4. **Dashboard** — the worklist, plus the balance component's first use.
5. **Documents as pages** — routed detail pages, status controls, drawers reduced to
   short master data.
6. **Guided flows** — the five daily tasks.
7. **Flagship screens** — the eight highest-traffic, hand-tuned.

Each phase ends on a running app that can be opened and judged, and on the always-on
gates: `pnpm typecheck && pnpm lint && pnpm build`, then `pnpm smoke`, `pnpm check:seed`,
`pnpm scenarios`.

## 5. Explicitly out of scope

Ruled out by the ground rules: a dense default layout, hover-flyout navigation, and any
required control that starts collapsed. Role-differentiated navigation is rejected
because it makes training and phone support harder; the rail personalises by use
instead. No business logic, ledger arithmetic or posting behaviour changes in this work.
