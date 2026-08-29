# Mezan (ميزان)

**AR:** ميزان هو نظام تخطيط موارد مؤسسات (ERP) عربي أولاً بالكامل (RTL)، مبني من الصفر لقطاع التجارة والتجزئة والتصنيع الخفيف في مصر، ويعمل كتطبيق سطح مكتب (Electron) يعمل بالكامل بدون إنترنت — من قاعدة كود واحدة بلغة TypeScript، مع دعم عدة نقاط بيع على نفس الشبكة المحلية.

**EN:** Mezan is an Arabic-first, RTL ERP for Egyptian SMB trading, retail and light-manufacturing businesses — a fully-offline Electron desktop app built from one TypeScript codebase, with LAN multi-till support for shops running several registers off one install.

## Architecture

One transport-agnostic, database-agnostic TypeScript domain core is mounted behind a [Hono](https://hono.dev) app and called **in-process** by the desktop shell — no HTTP port, no socket, on a single machine:

```
packages/
  domain/        pure TS. Entities, invariants, services, GL engine, costing engine,
                 workflow engine, numbering, permissions, entitlements. Zero SQL,
                 zero HTTP, zero fs — depends on ports only.
  contracts/     Zod schemas + generated DTO types shared by api, domain and web.
  persistence/   Drizzle ORM over SQLite (better-sqlite3, WAL mode), repository +
                 Unit-of-Work implementations of the domain's ports.
  api/           Hono app: routes → command/query objects → domain services.
                 No business logic lives here.
  backend/       createBackend({ dbPath }) — opens SQLite, lets every repository
                 bootstrap its own tables, seeds an empty DB (chart of accounts,
                 tax rates, fiscal year, main branch/warehouse, tenant settings,
                 first admin), and mounts the full API + real /auth, /bootstrap
                 and /dashboard routes. The one seeded app both apps/server and
                 apps/desktop boot.
apps/
  web/           React 18 + Vite + Tailwind + shadcn/ui SPA, RTL-first (logical
                 CSS properties only, no hardcoded left/right), IBM Plex Sans
                 Arabic, with an ar/en i18n layer covering the shell (see
                 "Internationalisation"). Talks to the API over TanStack Query.
  desktop/       Electron. Main process hosts the backend in-process; the
                 preload bridge exposes window.mezan.fetch, which marshals a
                 Request over IPC to app.fetch() and returns the Response —
                 byte-identical semantics to a real HTTP call, no localhost
                 server. Also owns: backup/restore, license verification,
                 auto-update, and the LAN host for multi-till.
  server/        Thin Node entry that serves the same backend over real HTTP,
                 used for local dev (apps/web talks to it via the Vite proxy)
                 and for Playwright e2e — not a hosted cloud product.
```

The rule that keeps this honest: **`packages/domain` may not import from `api`, `persistence`, `web`, `electron`, `node:fs`, `node:http`, or any driver.** If a feature can't be expressed against the domain's ports, the ports are wrong — not the rule.

Key building blocks:

- **Persistence** — [Drizzle ORM](https://orm.drizzle.team) over SQLite (`better-sqlite3`, WAL mode). Every entity's repository owns its own table bootstrap; one database file per install.
- **Money & quantities** — scaled int64 (10⁻⁶) values, never floats. Domain arithmetic goes through `Money`/`Qty` value objects backed by `decimal.js`, with rounding only at documented boundaries (largest-remainder allocation) so totals always reconcile.
- **Frontend** — React + Vite + Tailwind + shadcn/ui, RTL-first by construction, IBM Plex Sans Arabic, with an in-house ar/en i18n layer whose locale drives the document direction. Shared primitives (`<DocumentList>`, `<DocumentDetail>`, filter panels, KPI strips, side-panel drill-downs) are built once and reused across every module screen.
- **Desktop shell** — Electron, with `electron-updater` auto-update and first-class backup/restore (automatic pre-migration backups, GFS retention, guided/verified restore) as a shipped feature, not an afterthought.
- **Licensing** — Ed25519-signed offline license files (module/feature entitlements, seat counts, machine-fingerprint binding, 14-day grace period before read-only mode). No customer data is ever deleted, encrypted or withheld over a licensing state.
- **LAN multi-till** — the same in-process Hono app can bind to a LAN port so a single shop can run several registers against one desktop instance, gated by a license flag.

## Modules implemented

Everything below has a real domain package under `packages/domain/src`, a persistence + API layer, and a backend-mounted route — not a mockup. Modules are grouped by the business area they serve:

- **Sales** — customers, sales quotes, sales invoices (draft → confirmed → partially paid → paid lifecycle, stock deduction + AR posting), sales returns, price lists, promotions (percentage / fixed / BXGY / bundle / coupon), credit control.
- **Purchases** — suppliers, purchasing (RFQ → PO → GRN → purchase invoice chain), purchase returns, landed costs, historical purchase-document import, procurement strictness gates.
- **Inventory** — items, stock balance/transfers/adjustments (8 reasons incl. opening balance), physical counts, valuation + drift detection, configurable products (formula-driven, sandboxed evaluator).
- **Accounting & Treasury** — chart of accounts, journal entries (append-only, balanced-or-rejected, period-gated), cost centers + cost-center P&L, fiscal periods, tax rates, exchange rates, FX revaluation, balance reconciliation, ETA e-invoicing queue, treasury accounts, unified vouchers (10 types), bank reconciliation, cheque register (7-state), installments (plans + overdue processing + collection follow-ups).
- **Manufacturing** — bills of materials (versioned, waste %), work orders (4-stage execution with material issue/return/waste), configurable-product order instances.
- **CRM, Projects, Assets, Field Sales** — leads/opportunities/pipeline, projects (auto cost-center creation), fixed-asset register + categories + depreciation runs, field/van sales trips (load → sell/collect → settle).
- **Reports** — the `ReportDefinition` abstraction plus 18 report definitions (sales, purchases, inventory, aging, installments) and the financial-statement set (trial balance, income statement, balance sheet, cash flow, VAT return, general ledger, account ledger).
- **Platform** — permissions engine (dependency graph, sensitive flags, three-tier visibility, branch/warehouse scoping), workflow/approvals gate (26 gateable action types), domain event bus + notification-rules engine (39-event catalog, optional condition, recipient by permission/role/user, priority, in-app/email/push channels, Arabic templating), numbering engine (25 sequence types), audit trail, users/roles, entitlements/licensing, LAN host. These are engines with API surface; several of their admin UIs are not built yet — see "What is not built" below.

**Deferred, by product decision, not by gap:** HR & Payroll, POS (including the point-of-sale selling screen), and a cloud/multi-tenant website edition. The architecture (ports-first persistence, a transport-agnostic Hono app layer) keeps a future Postgres + multi-tenant edition additive rather than a rewrite, but none of that is built now.

## Real-data approach — no mockups

Every screen is wired to the real seeded backend, not static sample arrays. The pattern (documented in detail in [`docs/archive/web-data-wiring.md`](docs/archive/web-data-wiring.md)):

1. A screen's data comes from a typed TanStack Query hook (`data/hooks.ts`) calling the API through the one platform-swapped transport (`data/transport.ts` — real `fetch` on web, `window.mezan.fetch` on desktop).
2. Loading / error / empty states are real states (zero counts, empty lists) — never a fabricated placeholder number.
3. Filters, sorts and date ranges change the query, not a local slice of a static array.
4. Component tests use a stub transport against the same contracts the real API returns; e2e specs run against the actual seeded backend.

Both exceptions this section used to list are now closed: no `*-sample-data.ts`
file remains under `apps/web/src`, and no screen runs `@mezan/domain` in the
browser against in-memory repositories. Current state is tracked in
[`docs/ROADMAP.md` §1](docs/ROADMAP.md).

## Internationalisation

Arabic-first with a working English locale, built in-house (~200 lines, no i18n dependency).

- **Locale → direction, always.** `Locale` is `"ar" | "en"`; `directionOf(locale)` gives `rtl`/`ltr`. `I18nProvider` (`packages/ui/src/i18n`) stamps both `lang` and `dir` on `<html>` from the locale alone — direction is never stored, never configurable, never hardcoded. `index.html`'s `lang="ar" dir="rtl"` is only the pre-mount default.
- **Switching is live.** The topbar's language toggle (next to the theme toggle) flips locale and direction with no reload; the choice persists in `localStorage` under `mezan.locale` and is restored on load, guarded the same way `data/session.ts` guards storage access.
- **`t(key, params?)`** does `{placeholder}` interpolation. A key missing in the active locale falls back to the Arabic string and is reported to a dev-only `console.error`; a key missing everywhere renders humanised words, never the raw dotted key. Each catalog's English half is typed against its Arabic half, so an untranslated key is a compile error.
- **Translated so far (245 keys × 2 locales):** the shell (`AppShell`, `Sidebar`, `Topbar`, `CommandPalette`), the whole navigation tree and command palette, the login screen, the dashboard, and the shared primitives' chrome (search placeholders, empty states, pagination, date-range presets, report runner buttons, account-tree headers).
- **Not translated:** the module screens' own strings (~5,800 inline Arabic literals across `apps/web` and `packages/ui`) and `packages/domain`'s Arabic error messages — the latter needs the API to return error *codes* instead of prose, which is an architectural change, not a string extraction.

## Current state (verified 2026-08-23)

Measured on `main`, not estimated:

| Signal | Value |
|---|---|
| Unit + component tests | **318 files / 2149 tests, all passing** (`pnpm test`) |
| Typecheck / lint | **passing** (`pnpm typecheck`, `pnpm lint` incl. the RTL logical-CSS rule) |
| Playwright e2e specs | 28 spec files under `e2e/` |
| Domain modules | 50 under `packages/domain/src` |
| Mounted API route prefixes | 33 in `packages/api/src/app.ts` |
| Web screens / components | 76 non-test `.tsx` files; ~71 reachable nav entries |

### What is not built

Beyond the deferred modules below, these are named in the docs' phase lists but have **no implementation** — they are gaps, not decisions:

- **Engines with no runtime caller** — the audit trail and the credit-control check are implemented and tested but never supplied to `createApp` by `createBackend`, so neither runs in the app. LAN multi-till mounts nothing (`/lan/*` 404) and its admin panel is not imported by any screen. `verifyLicense` has no runtime caller; the desktop entitlements resolver is an explicit stub.
- **i18n beyond the shell** — the i18n layer exists and the shell is translated (see "Internationalisation"), but the ~5,800 remaining strings across the module screens are still inline Arabic literals, and `packages/domain` still returns Arabic error prose rather than error codes. The Settings language selector writes to state nothing reads — the topbar switcher is the real control. The tenant-settings screen itself is local state and never calls its mounted `/settings` route.
- **Desktop shell halves** — auto-update is config-only, and backup/restore ships scheduled backups with no restore entry point (the preload bridge exposes only fetch and print).
- **Platform admin UIs** — approvals inbox, numbering-sequences admin screen, barcode-config screen, data-migration wizard, audit-log viewer. The engines behind approvals, numbering and audit exist in `packages/domain`. (The notification-rules engine + builder + top-bar panel now exist — `packages/domain/src/notifications`, `apps/web/src/settings/NotificationRulesPage.tsx`, wired end-to-end through `createBackend`'s shared `EventBus`.)
- **Print templates** — `settings/PrintTemplatesPage.tsx` is a live preview of the default template through the shared `PrintView` renderer, not the 9-tab designer.
- **Inventory extras** — label printing, product templates / variant generation, and the aging-based write-down batch.
- **Navigation extras** — per-domain hub landing pages, branch 360 view, profile screen, production dashboard.
- **Reports** — sales-by-salesperson, van-sales and POS report packs (the last depends on POS).
- **Delivery notes** — open product decision (`docs/ROADMAP.md` §6.2).

## How to run

```bash
pnpm install

# Web + API server for local dev (apps/web proxies /api to apps/server)
pnpm server            # starts the Node/Hono backend on a local SQLite file
pnpm --filter web dev  # starts the Vite dev server

# Desktop (Electron), backend hosted in-process via window.mezan.fetch
pnpm --filter desktop demo

# Typecheck / lint (incl. RTL logical-CSS lint rule)
pnpm typecheck
pnpm lint

# Unit + component tests (Vitest)
pnpm test

# End-to-end (Playwright — browser project; starts web + server for you)
pnpm test:e2e:install   # once, to fetch the Chromium binary
pnpm test:e2e

# Production build (typecheck + web bundle)
pnpm build
```

## Branch strategy

- **`main`** — tracks parity with the reference application's captured catalog (`docs/archive/catalog/`). This is the v1 desktop scope: every module listed above, built to functional completeness against the catalog, in Mezan's own UI — not a pixel clone.
- **Beyond-parity work** lives on its own branch off `main`, never on `main` itself — anything that improves on the reference system rather than just matching it. Parity work always lands on `main` first; enhancement branches rebase onto it, not the other way around.

See [`docs/README.md`](docs/README.md) for the documentation map, [`docs/archive/plan.md`](docs/archive/plan.md) for the full architecture rationale and module build order, [`docs/ROADMAP.md`](docs/ROADMAP.md) for what is done, what is open and the whole task list, [`docs/TESTING.md`](docs/TESTING.md) for the testing policy and every scenario, and [`docs/archive/catalog/`](docs/catalog) for the per-domain functional specification everything above is grounded in.
