# Mezan stakeholder review — shared context

Every stakeholder agent reads this file first. It is the ground truth for what
Mezan is, what is actually built today, and what a review is allowed to assume.

## What Mezan is

An Arabic-first, RTL, Egypt-focused ERP for SMB trading, retail, restaurant and
light-manufacturing businesses. It is an authorized rebuild of a captured
system: the target is **parity with the feature catalog in `docs/catalog/`**,
not feature invention. One TypeScript domain core compiles into a fully-offline
Electron desktop app and (later) a multi-tenant cloud web app.

## v1 scope — do not review against descoped work

- **v1 = Electron desktop only, SQLite.** LAN multi-till stays (one license,
  several tills on a shop's local network).
- **Descoped for now:** the HR module, the POS module including the net-new
  `/pos/sell` selling screen, and the entire cloud/SaaS website edition.
- The `apps/web` Vite dev server renders the *same* React UI the desktop shell
  wraps. Reviewing it in a browser is reviewing the desktop app's UI, not a
  separate website product.

## What is actually built today

Routable screens (`apps/web/src/App.tsx`): login gate, first-run wizard,
dashboard (لوحة التحكم), chart of accounts (دليل الحسابات), customers
(العملاء), suppliers (الموردون), sales invoices, settings → general / branches
(الفروع) / warehouses (المستودعات), and the LAN multi-till surface.

Every other nav item is a placeholder tagged **قريباً** (coming soon). Flagging
"module X is missing" is not a finding unless the catalog says it belongs in a
phase that is already claimed done. Check `docs/plan.md` §4 before calling
something a gap.

## Non-negotiable invariants

- **RTL by construction.** Logical CSS properties only — no hardcoded
  `left`/`right`. Enforced by `pnpm lint:rtl`
  (`scripts/check-logical-css.mjs`).
- **Money and quantities** are scaled int64 (10⁻⁶) via `Money`/`Qty` value
  objects. Never floats. Rounding only at documented boundaries.
- **Arabic is the primary language**, English is secondary (ar/en i18n). Arabic
  copy must read as native accounting Arabic, not as translated English.
- **Offline is the differentiator.** Nothing in the desktop edition may require
  connectivity.
- **Design identity:** light-first, deep teal `#0e5049` + gold `#ae7c24`, Cairo
  for display, IBM Plex Sans Arabic for UI, IBM Plex Mono for figures. Tokens
  live in `packages/ui/src/tokens/tokens.css`; dark mode is supported both via
  `prefers-color-scheme` and an explicit `[data-theme]`.

## Where to look

| Question | File |
|---|---|
| Build plan, phasing, risks, open decisions | `docs/plan.md` |
| Per-domain feature catalog (parity target) | `docs/catalog/*.md` |
| Backlog | `docs/ROADMAP.md` |
| Approved visual direction | `design/mezan-ui-mockups.html` |
| Shared UI primitives | `packages/ui/src/` |
| Screens under review | `apps/web/src/` |

## How to run it

```
pnpm --filter web dev
```

Screenshots captured for a review are written to
`.claude/stakeholders/screenshots/` and can be read directly.

## What this review must decide

> Working bar set by the reviewer running this session, not yet confirmed by the
> owner. If it is wrong, correct it here and re-run the panel.

**The question:** how does Mezan beat Zemam (`getzemam.com` — see
`zemam-reference.md`) on **workflow simplicity and options**, given Mezan's
Phase-1 desktop slice as it exists today? Not "is it complete" — it is not, and
that is known.

**Blocker for this review** = anything that makes a daily task slower, more
confusing or less trustworthy than the same task on a competitor, or that a
buyer would reject in a demo. **Not a blocker** = a module that belongs to a
later phase and is honestly marked قريباً.

**Demo audience:** an Egyptian SMB owner and their accountant, evaluating a
switch. Buyer and user in the same room.

**Known and already reported — do not re-report:**
- Modules outside Phase 1 are unbuilt and marked قريباً.
- POS, HR and the cloud/web edition are descoped from v1.
- Sample data is fixed demo data; there is no backend wired.

**What every finding must carry:** the screen or `file:line`, what it costs the
user, and a concrete simpler alternative. A complaint without a proposed
simplification does not count for this review.

## Screenshots on file

Captured 2026-08-22 at 1366×768, dark theme (the OS was in dark mode), in
`.claude/stakeholders/screenshots/`:

| File | Screen |
|---|---|
| `01-login.jpg` | Desktop login — username + 4-digit PIN, licensed-module chips, first-run link |
| `02-dashboard.jpg` | لوحة التحكم — KPI row, period chart, follow-up list, aging, expenses, top items |
| `03-sales-invoices-list.jpg` | فواتير المبيعات — KPI row, status filter chips, list, pagination |
| `04-customers.jpg` | العملاء — credit limit, opening balance, payment terms, classification |
| `05-suppliers.jpg` | الموردون |
| `06-chart-of-accounts.jpg` | دليل الحسابات — tree with type/nature/status |
| `07-settings-nav-expanded.jpg` | Settings section of the nav expanded |
| `08-settings-general.jpg` | الإعدادات · عام — currency, language, RTL, numerals, date, week |
| `09-branches.jpg` | الفروع |
| `10-warehouses.jpg` | المستودعات — five types incl. van |

**Observed during capture (verified, use freely):**
- Clicking an invoice row in `03` opens nothing — the list has no detail view.
- Nav items مراكز التكلفة / القيود المحاسبية / الفترات المالية are clickable,
  carry no قريباً tag, and do nothing when clicked.
- The app rendered in **dark** theme by default because the OS preferred dark,
  although the approved direction is light-first.
- Login PIN entry ignores a pasted/typed 4-digit string; digits must be entered
  as individual key events.
