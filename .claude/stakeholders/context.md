# Mezan stakeholder review — shared context

Every stakeholder agent reads this file first. It is the ground truth for what
Mezan is, what is actually built today, and what a review is allowed to assume.

## What Mezan is

An Arabic-first, RTL, Egypt-focused ERP for SMB trading, retail, restaurant and
light-manufacturing businesses. It is an authorized rebuild of a captured
system: the target is **parity with the feature catalog in `docs/archive/catalog/`**,
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
phase that is already claimed done. Check `docs/archive/plan.md` §4 before calling
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
| Build plan, phasing, risks, open decisions | `docs/archive/plan.md` |
| Per-domain feature catalog (parity target) | `docs/archive/catalog/*.md` |
| Backlog | `docs/ROADMAP.md` |
| Approved visual direction | `docs/archive/mezan-ui-mockups.html` |
| Shared UI primitives | `packages/ui/src/` |
| Screens under review | `apps/web/src/` |

## How to run it

```
pnpm --filter web dev
```

Run the app and read the screens directly. Reviews are done against the running
app, not against captures — a screenshot goes stale the day after it is taken.

## What this review must decide

> Working bar set by the reviewer running this session, not yet confirmed by the
> owner. If it is wrong, correct it here and re-run the panel.

**The question:** is Mezan's Phase-1 desktop slice simpler to work in — fewer
steps, fewer decisions, less to learn — than what an Egyptian SMB uses today? Not "is it complete" — it is not, and
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

## Observed in the app (verified, use freely)

- Clicking an invoice row opens nothing — the list has no detail view.
- Nav items مراكز التكلفة / القيود المحاسبية / الفترات المالية are clickable,
  carry no قريباً tag, and do nothing when clicked.
- The app rendered in **dark** theme by default because the OS preferred dark,
  although the approved direction is light-first.
- Login PIN entry ignores a pasted/typed 4-digit string; digits must be entered
  as individual key events.
