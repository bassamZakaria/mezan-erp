# Mezan (ميزان) — Master Build Plan (DRAFT)

> Authorized rebuild of the reference system's ERP. One codebase → two products: a multi-tenant cloud web app and a fully-offline, license-gated Electron desktop app.
>
> **Every scope claim in this document traces to `recon/source-recon.md` or `recon/catalog/01..09-*.md`.** Where the catalog says a screen was empty/unreachable in the demo tenant, this plan says so rather than inventing behaviour. Status: DRAFT for review — stack, phasing and sizing are recommendations, not commitments.

---

## v1 Scope (2026-08-22)

**v1 = Electron desktop app only (SQLite).** Descoped for now: the HR module, the POS module (including the net-new POS selling screen), and the entire cloud/SaaS website edition. Path chosen = **Path A**: SQLite-only for now, but the repository ports + Drizzle abstraction and the Hono app layer are kept so the website + Postgres can be added later additively. The Postgres dialect, the dual-engine conformance suite, and Postgres CI are deferred, not built now. **LAN multi-till stays** — it's desktop/offline and satisfies the one-license-multiple-devices requirement. The core business loop is unchanged: journal entries, sales & purchase invoices, treasury vouchers, print.

**Design status:** UI visual direction is in team review — a light-first RTL desktop design (deep-teal + gold finance identity, Cairo/IBM Plex Sans Arabic, balance-beam brand motif), with base pages and the full accounting section mocked; viewable in a separate design artifact.

---

## Build status (as of 2026-08-23, `main` @ `7b65887`)

This section is maintained as the plan executes; §4 below stays the unmodified original phase design. Every claim here was re-verified against the code in this pass; `docs/tasks.md` carries the per-item breakdown and `docs/coverage-audit.md` the parity math.

**Done.** Every v1 domain named in §4 has landed: Foundations (persistence-behind-ports, Money/Qty, auth, permissions, entitlements/licensing skeleton, numbering, audit trail, workflow-engine core, notification bus core, RTL app shell, Electron shell + backup/restore) through Phase 12 (CRM + Projects + Fixed Assets + Field/Van Sales). Concretely, `packages/domain/src` holds 49 domain modules covering accounts, GL/journal posting, cost centers + cost-center P&L, fiscal periods, tax rates, exchange rates + FX revaluation, reconciliation, items, customers/suppliers/partners, sales quotes/invoices/returns, price lists, promotions, credit control, purchasing (RFQ→PO→GRN→invoice), purchase returns, landed costs, inventory, treasury accounts, vouchers, cheques, bank reconciliation, installments, manufacturing, CRM, projects, fixed assets, field sales, permissions, roles, users, workflow, entitlements, licensing, numbering, audit, events, ETA, settings and the LAN host. Each has a persistence + API layer and is mounted in `packages/backend`. The engines called out as the hardest parts of the plan — double-entry posting with balance/period enforcement, WAC costing with immutable cost layers, the 26-action-type workflow gate, the 25-sequence numbering engine, the 268-permission catalog with dependency resolution — are all implemented and covered by unit tests, plus a recent backfill pass added component/unit coverage for previously-thin modules. The real-data control panel described in `docs/web-data-wiring.md` (typed hooks over one platform-swapped transport, real loading/empty/error states, no static arrays driving a screen) is in place and is now the pattern nearly every screen follows; the most recent merges to `main` mounted the manufacturing/RFQ/historical-import/returns/landed-costs/installments backends, converted the remaining sample-data screens, and fixed a real SQLite write-concurrency bug: `createBackend` opened ~35 separate `better-sqlite3` connections onto the same file, and a confirm flow that both issued stock and posted a GL entry inside one store's `BEGIN IMMEDIATE` deadlocked against itself across those separate connections (`SQLITE_BUSY`, not waitable by `busy_timeout` alone). That's fixed — every store-owned connection now goes through `packages/persistence/src/sqlite-connection.ts`'s `openSqliteConnection` (WAL + shared `busy_timeout`) and `withSqliteTransaction` (savepoint-based re-entrancy) — landed directly on `main`.

**Gates.** `pnpm test` → 306 test files / 2078 tests passing; `pnpm typecheck` and `pnpm lint` (incl. the RTL logical-CSS rule) pass; 28 Playwright specs live under `e2e/`; 33 API route prefixes are mounted; the web app ships 74 non-test components across ~70 nav entries.

**Landed since the previous revision of this section.** The financial-statement report family (income statement, balance sheet, cash flow, VAT return, general/account ledger) and the inventory-operations merge (stock adjustments, transfers, physical counts, stock balance) are both on `main` — `docs/coverage-audit.md` was written just before these merges and still counts them as gaps.

**Not built (gaps, not deferrals).** Verified absent across all layers: the platform admin UIs (approvals inbox, notification-rules builder — no rules engine exists either, only the event bus; numbering-sequences admin, barcode config, data-migration wizard, audit-log viewer), the 9-tab print-template designer (the page is a live `PrintView` preview instead), label printing, product templates / variant generation, the aging-based inventory write-down batch, every per-domain hub landing page, the branch 360 view, the profile screen, the production dashboard, and the sales-by-salesperson / van-sales / POS report packs.

**In progress.**
- **Real-data sweep, finishing touches** — 7 `*-sample-data.ts` files still exist under `apps/web/src` (the six previously listed plus `inventory-ops-sample-data.ts`) with roughly twenty importers. `sample-data.ts` is not just demo rows: it still owns the nav registry, the command-palette items and the demo entitlements, so retiring it needs those moved somewhere real first.
- **Domain-in-browser screens** — 9 screens (`StockBalance`, `StockTransfers`, `StockAdjustments`, `PhysicalCounts`, `ExchangeRates`, `FxRevaluation`, `CostCenterPnL`, `Reconciliation`, `Eta`) import `@mezan/domain` directly through `apps/web/src/store/*` and run it against in-memory repositories. The rules are the real ones and the tests are meaningful, but nothing these screens do reaches SQLite, and their API routes are already mounted — so this is web wiring, not new backend work.
- **Manufacturing/RFQ mount** — domain + persistence + API layers exist for Manufacturing (BOMs, work orders, configurable-product instances) and RFQs; the backend-mount and web-screen wiring landed in the most recent merge and needs a stabilization pass (edge cases, e2e coverage) before being considered fully hardened.
- **Bug-hunt** — an active sweep across the app looking for functional defects (the kind called out in `docs/backlog.md` §8 as worth deliberately avoiding, e.g. RTL direction handling, i18n fallback gaps, navigation-target mismatches) before the next stabilization checkpoint. The SQLite cross-connection deadlock above was one concrete find from this sweep.
- Several phase branches (`phase1/users-roles`, `phase4/inventory-ops`, `phase56/returns-landed-installments`, `phase9/accounting-depth`, `phase9/financial-statements`, `sweep/real-data-screens`) and Playwright e2e-stabilization worktrees remain open alongside already-merged work, reconciling incremental hardening and test coverage against what's landed on `main`.

**Deferred (by product decision, not by gap — see §1 "v1 Scope" and `docs/backlog.md` §1).**
- **HR & Payroll** (backlog Phase 13) — all 13 screens (employees, departments, job titles, attendance, holidays, contracts, leave requests/policies, leave accrual batches, payroll runs, advances, my-leave, shift settings). The payroll calculation-engine internals are flagged in `docs/backlog.md` as the single largest specification hole in the whole catalog and need a standalone design pass before implementation starts.
- **POS** (backlog Phase 14) — terminals, sessions/shifts, sales/refunds ledgers, discount approvals, restaurant mode (tables/kitchen/reservations/deliveries), loyalty, and the net-new POS selling screen (no reference implementation exists anywhere — needs its own design spike with a real cashier before being built).
- **Cloud/SaaS website edition** (backlog Phase 15) — Postgres dialect + dual-engine conformance suite, cloud JWT + Row-Level Security, `apps/server` as a real hosted multi-tenant server, SSE + Redis realtime fan-out, S3 storage, subscription→entitlements, tenant onboarding, API keys/webhooks/WhatsApp integration. The architecture (ports-first persistence, transport-agnostic Hono app layer) is deliberately built to make this additive later, not a rewrite — nothing here is started.

**Remaining hardening (before v1 can be called release-ready).**
- Finish the real-data sweep (above) and delete every dead `*-sample-data.ts` file once its last consumer is converted.
- Extend the SQLite concurrency fix with a regression test that exercises concurrent numbering-sequence allocation and LAN multi-till writers, so this class of cross-connection deadlock can't reappear silently.
- Stabilize e2e coverage — several `test/e2e-*` worktrees are mid-flight; consolidate into a green, deterministic Playwright suite (browser project) run on every change, per the CI plan in §2.7.
- Complete the bug-hunt sweep and fold findings into either immediate fixes or tracked backlog items, cross-checked against the known-defects list already called out in `docs/backlog.md` §8 (so known source-app bugs aren't silently reintroduced).
- Merge the outstanding phase branches into `main` (or confirm their content already landed via a later merge) so the branch list reflects actual `main` state, not stale in-flight work.
- Re-run the golden-ledger fixture suite and the permission/workflow/numbering invariant tests as a release gate once the above lands, per the testing strategy in §2.7.
- Decide and record the open product decisions in §6.3 that are still genuinely open (licensing mechanism finalization, installment late-fee rule, FIFO-in-v1, delivery notes, branch-scoped numbering) — none block current development but several block calling specific v1 issues "done" rather than "buildable."

---

## Market & competitive notes (for review)

Inputs from a review of a competing Egyptian ERP's public marketing site, gathered to sanity-check our approach and surface possible catalog gaps. These are **discussion inputs for a "what do we actually need for v1" review, not decisions or committed scope** — each item needs a team call before it changes a plan or a backlog issue.

**Pricing & licensing model — validates our approach.** A competing Egyptian ERP sells a **Core** bundle (Accounting + Sales + Purchases + Inventory) plus **priced add-on modules**: POS (+500), Manufacturing (+500), HR & Payroll (+400), Installments & Cheques (+250), Multi-currency (+200), Fixed Assets (+200), Loyalty (+150), AI Assistant (+500) — all EGP/month. **Capacity axes** (seats, branches, warehouses, POS terminals) are priced separately, and curated **persona bundles** (Wholesale & Distribution / Retail & F&B / Manufacturing) sit on top of the à la carte modules. Commercial terms: two-month-free annual discount, 14-day trial.
→ This is a clean external validation of our module-entitlement design (§2.5, §6.3.1). Recommended action: fold the **4 capacity dimensions** (seats / branches / warehouses / POS terminals) into our licensing model, and consider offering **persona bundles** on top of raw per-module pricing.

**Deployment differentiator.** The reference product is cloud SaaS; **only its POS module is offline-capable** (with sync back to the cloud). Our **fully-offline desktop edition is a genuine differentiator**, not just feature parity — worth leaning on in positioning.

**Possible catalog gaps to verify.** Features the reference product markets that our catalog may cover thinly or not at all:
- BOQ / progress-certificate / retention billing for Contracting & Real-Estate — our Projects domain looked thin (see §6.3.7, Projects row in Phase 7).
- FEFO (first-expiry-first-out) for pharma.
- Cheque **endorsement / replacement** states (beyond the 7-state lifecycle already captured, §2.3, §4).
- Restaurant **own-fleet delivery tracking**.
- IAS-21 **FX gain/loss** depth in multi-currency.

→ Action: check each against docs/catalog before finalizing those modules' issues.

**Module-boundary notes.** The reference product markets **multi-currency** and **ETA e-invoicing** almost as standalone modules. → Consider treating **multi-currency as its own licensable module** in our entitlement model, rather than an always-on accounting feature.

---

## Competitive landscape (for review)

Broader review intel gathered against the named ERPs an Egyptian SMB buyer would actually compare us to, plus Excel as the do-nothing baseline. As with the section above, this is **review input, not committed positioning**.

| Product | Arabic/RTL | Egypt ETA fit | Deployment | Pricing model | Coverage vs our domains | Primary weakness |
|---|---|---|---|---|---|---|
| Daftra | Native | Real ETA (manual credential/dongle setup; markets Saudi ZATCA first) | Cloud only | Tiered SaaS with usage caps — Basic ~490 / Advanced ~978 / Premium ~1,960 EGP/mo — + per-unit add-ons (users, branches, warehouses, storage) | High | No offline/desktop or self-host |
| Odoo | Partner/add-on | Via localization/partner | Cloud or self-host | Free community + paid apps (Egypt implementations cited ~125,000 EGP+) | High but assembled | Hidden TCO, partner-dependent |
| SAP Business One | Partner | Partner Arabic/ETA | On-prem/partner cloud | Costly, partner-led | High (enterprise) | Cost + long rollout |
| ERPNext | Community-translated | Not native | Self-host or Frappe Cloud | Free license + hosting/partner | Med-High | Needs a technical team; no built-in Egypt compliance |
| Microsoft Dynamics 365 Business Central | Partner/ISV | Partner Arabic/ETA | Cloud/partner | Per-user + implementation | High | Cost, bolted-on localization |
| QuickBooks | Not Egypt-native | Not Egypt-native | Cloud | Subscription | Low (accounting-only) | No real Egypt localization/ERP depth |
| Zoho | Not Egypt-native | Not Egypt-native | Cloud | Subscription | Low (accounting-only) | No real Egypt localization/ERP depth |
| Excel | None | None | Local/offline | Free | Very low | Manual, no GL |

**Note on Daftra specifically:** it is the closest competitor and is actually deep — cheque cycle, installments, BOM/routings/scrap manufacturing, HR/payroll, multi-branch, 7 mobile apps, and an offline-syncing POS.

**Where Mezan differentiates:**
1. A true offline-first Arabic **desktop** ERP — no competitor in this field offers it (Daftra's offline capability is POS-only).
2. Module-based licensing vs. Daftra's cap-based tiers.
3. Egypt/ETA-first positioning.

> **Honesty caveat.** Independent research shows the reference system's own compare page **overstates** Daftra's weaknesses — Daftra actually has manufacturing, cheques, installments, and offline-capable POS. Mezan's real edge is deployment model + execution quality, not "features they lack." Don't reuse the reference system's overstated competitive claims in our own materials.

---

## 1. Executive summary

### What is being built

Mezan is a ground-up rebuild of the source application — an Arabic-first, RTL, Egypt-focused ERP for SMB trading, retail, restaurant and light-manufacturing businesses. The captured system spans **15 functional domains** and **~110+ nav-addressable screens** (recon §2, §8), which expand to roughly 250–330 real views once list / create / edit / detail / print variants are counted.

The rebuild targets **feature parity with the captured catalog**, not feature invention. The single deliberate net-new surface is the **POS selling screen**, which does not exist in the source application's web app at all (`05-pos-installments.md`: `/pos/sell` renders "نقطة البيع انتقلت إلى تطبيقات الجوال وسطح المكتب" — the sell UI lives only in their separate mobile/Electron clients). Mezan must design it from scratch.

### For whom

- **Cloud edition** — multi-tenant SaaS, tenant resolved by company code + credentials (recon §4: `رمز المنشأة` + email/password, e.g. `<redacted>`), module- and feature-flagged per tenant (`activeModules[]` + dotted `features{}` map, `09-settings-dashboard-ux.md` §tenant payload).
- **Desktop edition** — a single-shop or single-office install that works with **no internet at all**: embedded database, local user store, local printing, sold against an offline signed license key. This is the edition that unlocks the Egyptian/regional market segment that cannot rely on connectivity, and it is the reason the architecture below is shaped the way it is.

### Dual-deployment + licensing model

One TypeScript domain core is compiled into both products. The core never talks to HTTP or to a specific database — it talks to a repository port and an entitlements port. Two thin adapters bind it:

| | Cloud edition | Desktop edition |
|---|---|---|
| Transport | HTTPS REST (`/api/...`) | in-process `app.fetch()` over Electron IPC — no socket, no port |
| Database | PostgreSQL (multi-tenant) | SQLite/libSQL file (single tenant) |
| Identity | JWT + refresh, tenant claims (recon §4) | local user store, OS-keychain-sealed |
| Entitlements | subscription record → claims | Ed25519-signed offline license file |
| Realtime | WebSocket/SSE fan-out | in-process event bus |
| Backups | platform-operated | **first-class product feature** (see §3.7) |

Entitlements have the *same shape* in both editions — `{ plan, activeModules[], features{}, seats, expiresAt }` — because the source application already models tenant capability exactly that way. A license file is simply an offline-signed copy of the same object.

### Headline scope numbers (all from the catalog)

| Metric | Count | Source |
|---|---|---|
| Functional domains | 15 | recon §8 |
| Nav-addressable screens | ~110+ | recon §2 |
| Reports | **33** across 8 domains | `08-reports.md` |
| Permissions in the catalog | **~268** across 19 modules, with a dependency graph and a `⚠ sensitive` flag | `09-settings...md` §permission matrix |
| Document numbering sequences | **25** doc types (prefix / pad-length / annual-reset) | `09-settings...md` §sequences |
| Treasury voucher types | **10** (one document, type discriminator) | `04-accounting-treasury.md` |
| Workflow-gateable action types | **26** (multi-step, sequential, role-based chains) | `09-settings...md` §workflow |
| Notification rule events | **39** trigger events × 3 channels (in-app / email / push) | `09-settings...md` §notification rules |
| Cheque lifecycle states | 7 | `04-...md` §cheque register |
| Seeded GL accounts (demo tenant) | 78 accounts, 9 roots | `04-...md` §chart of accounts |
| Currencies | EGP base + 10 secondary (SAR AED QAR KWD BHD OMR JOD USD EUR GBP) | `09-...md` tenant payload |
| Warehouse types | 5 (main / staging / returns / production / **van**) | `03-inventory.md` |
| Print-template config surfaces | 9 tabs + per-document override layer | `09-...md` §print templates |
| Label templates | 3 fixed sizes (40×30, 50×25, 100×50 mm) | `03-...md`, `09-...md` |
| POS module permissions | 38 — the largest single module | `09-...md` |
| Stock-adjustment reasons | 8 (incl. `INITIAL_STOCK` = the opening-balance mechanism) | `03-inventory.md` |

**Honest sizing read:** this is an Odoo/Zoho-class ERP with a genuinely deep engine underneath (weighted-average costing with immutable cost layers, per-item GL mapping, multi-currency with auto-reversing FX revaluation, cost centers, three-state fiscal periods, an approval workflow engine, and a mandatory government e-invoicing integration). It is a multi-quarter, multi-engineer build. The plan below sequences it so that a genuinely usable slice ships early and each later phase is additive rather than a rewrite.

---

## 2. Recommended tech stack

Each layer states **the recommendation**, **why**, and **what was seriously considered and rejected**.

### 2.1 Frontend — React 19 + TypeScript + Vite + Tailwind + shadcn/ui (RTL-first)

**Recommended.** This deliberately mirrors the captured app's own idioms (recon §3: Vite content-hashed bundles, Tailwind + shadcn/ui CSS-variable token classes such as `bg-sidebar-accent` / `text-sidebar-primary-foreground`, React Router client routing, IBM Plex Sans Arabic).

Concrete picks:

| Concern | Pick | Note |
|---|---|---|
| Build | Vite 6 + TS strict | Same bundle feeds the browser and the Electron renderer. |
| Routing | React Router (data router) | Matches captured deep-linkable routes (`/sales/invoices/{id}`, `?tab=` params). |
| Server state | TanStack Query | Every catalog list is `list + /counts + /stats` (e.g. `01-sales.md`, `02-purchases.md`) — three cached queries per screen, invalidated by domain events. |
| Tables | TanStack Table (headless) | Every module repeats the same pattern: KPI strip → status chips with counts → collapsible filter panel → sortable columns → `عرض 1 - N من N` pager with page-size selector. Build this **once** as `<DocumentList>` and configure it ~40 times. |
| Forms | react-hook-form + Zod | Zod schemas are **shared with the domain layer** so client and server validate identically. |
| Charts | Recharts (or ECharts if RTL axis handling proves painful) | Dashboard + ~20 reports need line/bar/donut/Pareto/waterfall (`08-reports.md`). |
| i18n | i18next + ICU plural/number formatting | Locale switcher in the captured top bar offers **العربية / English / Deutsch** (`09-...md`); ship ar + en, keep de as a stub. Tenant settings carry `dateFormat`, `dateNumerals` (western/arabic digits) and `direction`. |
| Barcodes | bwip-js (client-side, canvas/SVG) | Must work offline; also drives the "barcode too long for this label size" validation already present in the source application (`03-inventory.md` §labels). |

**RTL-first rules (non-negotiable, enforced by lint):**
- `dir` is set on `<html>` from the active locale; **never** hardcode `left`/`right`. Use CSS logical properties (`margin-inline-start`, `inset-inline-end`, `text-align: start`) — Tailwind's `ps-*`/`pe-*`/`ms-*`/`me-*` scales only.
- Numbers, currency and dates go through a single `useFormat()` hook honouring `dateNumerals` and `dateFormat` — the captured app renders a correct RTL negative (`‎-18,087.50` with an explicit LRM) which naive `toLocaleString` gets wrong.
- Every component gets an RTL **and** LTR Storybook/Playwright snapshot. RTL bugs are the single most common regression class in this codebase category.
- Note a real bug to avoid inheriting: the captured tenant stores `"direction": "LTR"` while rendering RTL (`09-...md` §general tab) — Mezan derives direction from locale, and treats a stored direction only as an explicit override.

**Alternatives considered.** *Next.js* — SSR buys nothing for an authenticated ERP, and the Electron target wants a pure static SPA bundle; rejected. *Vue/Nuxt or Angular* — no parity advantage, and every captured UI idiom is shadcn/Radix-shaped; rejected. *Tailwind v4 + a hand-rolled component kit* — more control, far more work across ~300 views; rejected in favour of shadcn/ui which we vendor and restyle.

### 2.2 Backend / domain layer — the crux of the dual target

**Recommended: a single TypeScript domain package, transport-agnostic and database-agnostic, mounted behind a Hono HTTP app.**

```
packages/
  domain/        pure TS. Entities, invariants, services, GL engine, costing engine,
                 workflow engine, numbering, permissions, entitlements.
                 Depends on PORTS only. Zero SQL, zero HTTP, zero fs.
  persistence/   Drizzle-based implementations of the ports, dual dialect (pg | sqlite).
  api/           Hono app: routes → command/query objects → domain services.
                 Emits an OpenAPI document. NO business logic.
  contracts/     Zod schemas + generated types shared by api, domain and web.
apps/
  web/           React SPA (browser build)
  server/        Node entry: serves `api` over HTTP, Postgres driver
  desktop/       Electron: main process hosts `api` in-process, SQLite driver;
                 renderer is the same `web` bundle
```

**Why Hono specifically.** A Hono app is a `(Request) => Promise<Response>` function. In the cloud we mount it on a Node HTTP server. In Electron we **do not open a port at all** — the preload bridge marshals a request over IPC and the main process calls `app.fetch(new Request(url, init))` directly, returning the response body. That gives us:

- byte-identical request/response semantics between editions, so the React data layer has one implementation with a swappable `fetch` (real `fetch` online, `window.mezan.fetch` on desktop);
- no localhost server, no port conflicts, no firewall prompts, no "another instance is using 3000" support tickets;
- and, when we later *want* a port (multi-till shops — see §6), we bind the exact same app to a LAN socket with a one-line change.

This "one HTTP app, two mount points" property is the single most valuable architectural decision in the plan.

**Data access: Drizzle ORM.** Drizzle emits SQL for both `pg-core` and `sqlite-core`, has no runtime engine binary, no query engine process, and adds ~kB rather than ~MB to the Electron bundle. The honest catch: **Drizzle schemas are dialect-specific** — you write `pgTable(...)` and `sqliteTable(...)` separately. Mitigation, and it must be built in Phase 0:

1. Author each table **once** in a tiny internal spec DSL (`packages/persistence/spec/*.ts`): columns, types, nullability, defaults, indexes, FKs.
2. Codegen emits `schema.pg.ts` and `schema.sqlite.ts` plus both migration sets (`drizzle-kit generate` per dialect). Both are committed and code-reviewed — generated, but not invisible.
3. A **dual-engine conformance suite** runs the entire domain test corpus against a fresh Postgres and a fresh SQLite on every CI run. If a query behaves differently, CI fails. This suite is the contract; the codegen is just ergonomics.
4. A small `SqlDialect` capability object handles the genuinely divergent bits: upsert syntax, `RETURNING` support, window-function availability, `ILIKE` vs `LIKE ... COLLATE NOCASE`, JSON functions, and advisory locking (Postgres `pg_advisory_xact_lock` vs SQLite `BEGIN IMMEDIATE`). Everything else stays portable by construction.

**Repository + Unit of Work port.** The domain never sees Drizzle. It sees:

```ts
interface UnitOfWork {
  readonly items: ItemRepository;      // ~40 repositories
  readonly journal: JournalRepository;
  // ...
  transaction<T>(fn: (uow: UnitOfWork) => Promise<T>): Promise<T>;
}
```

Every state-changing use case runs inside exactly one `transaction()`. Posting an invoice writes the document, the stock movements, the cost layers **and** the journal entry in one atomic unit or nothing at all. This is not optional in a double-entry system.

**Alternatives considered.**

- **NestJS.** Excellent structure and DI, and a fine cloud choice. Rejected for the dual target: decorator/reflect-metadata bootstrapping adds meaningful cold-start cost inside Electron, the module graph resists being invoked as a plain function, and it pulls a large dependency tree into a desktop bundle. We get the same layering discipline from folder boundaries + `eslint-plugin-boundaries` without the runtime.
- **Fastify.** A close second and a perfectly good pick; Hono wins only on the `app.fetch()` in-process story and on bundle size. If the team already knows Fastify well, this is a low-risk swap.
- **Prisma.** Rejected. It ships a Rust query engine binary (native-module packaging pain in Electron across three OSes), and its migration tooling assumes one provider per schema — exactly the wrong shape for dual-target.
- **A separate Rust or Go core** (shared library called from both a web server and Electron). Genuinely attractive for the money/ledger math and for tamper resistance of the license check. Rejected because: it doubles the language surface for a team already writing a large TS frontend; the schema/validation/type sharing with the frontend (Zod → TS types) evaporates; and native modules must be built and code-signed per platform per architecture. Revisit *only* if profiling shows the costing/report engine cannot meet targets in TS — and even then, extract just the hot kernel.
- **Local-first sync engines (ElectricSQL, PowerSync, Zero, RxDB).** These solve "the same data, live-synced between cloud and device." That is explicitly **out of scope** (§6). Adopting one now would impose CRDT/last-write-wins semantics on a **double-entry ledger with immutable cost layers and sequential document numbers** — where "both sides win" is not a valid merge and a duplicated `INV-000014` is a compliance incident. Rejected for v1; reconsidered only under a designed, document-level, one-way sync model.
- **Tauri instead of Electron.** Tauri would give a ~10× smaller installer and lower memory. **The user has chosen Electron, and this plan respects that.** Recorded trade-off: Electron costs roughly 80–150 MB per installer and ~150–250 MB idle RSS versus Tauri, and ships its own Chromium that must be kept patched. In exchange we get one predictable renderer engine on every OS (no WebView2/WebKitGTK divergence — a real risk for a *print-heavy RTL Arabic* app), mature `printToPDF`/`webContents.print` APIs, `electron-updater`, and Node in the main process for ESC/POS sockets and file backups. Given how much of this product is printing and hardware I/O, Electron is defensible on merit, not just preference. The architecture keeps the Electron dependency confined to `apps/desktop` so a future Tauri port would touch one package.

### 2.3 Database — Postgres (cloud) + SQLite (desktop), one schema

**Recommended: PostgreSQL 16+ online; SQLite (via `better-sqlite3`, WAL mode) embedded on desktop.**

`better-sqlite3` is synchronous and fast, which suits a single-process embedded workload and makes transactions trivially correct. It is a native module → must be rebuilt per Electron ABI per platform (`electron-rebuild` in CI). If prebuilt-binary pain becomes chronic, `node:sqlite` (Node 22+) or libSQL are drop-in-ish escape hatches; keep the driver behind the persistence port.

**Multi-tenancy.** Cloud: single database, `tenant_id` on every row, enforced by **Postgres Row-Level Security** with a per-request `SET LOCAL app.tenant_id`. This is a defence-in-depth layer *underneath* the repository's own tenant scoping — a forgotten `WHERE tenant_id` becomes an empty result set, not a data leak. Desktop: exactly one tenant row exists; the same columns and the same code paths run, so there is no "desktop mode" branch in domain logic. Keeping `tenant_id` on desktop also makes a future cloud→desktop restore a straight import.

**Money and quantities — no floats, ever.**

- Canonical representation: **signed 64-bit integers at a fixed scale of 10⁻⁶** for every monetary amount, unit cost, quantity and FX rate. Stored as `BIGINT` in Postgres and `INTEGER` in SQLite.
- Rationale: identical exact semantics on both engines, exact `SUM()` in SQL on both, correct sorting (reports sort by amount — `08-reports.md`), and no dependence on SQLite's `NUMERIC` affinity, which silently degrades to IEEE-754 double. Storing money as `TEXT` in SQLite avoids the float trap but breaks `SUM`/`ORDER BY`; storing as `REAL` is disqualifying for a GL.
- Scale 6 is required, not cosmetic: weighted-average unit costs and formula-priced configurable products (`03-inventory.md`: `width*height*3.5`) need sub-piastre precision, and the tenant already configures a `wacDriftTolerance` of `0.01`.
- Headroom: at scale 6, int64 holds ±9.2 × 10¹² currency units. A 500,000 EGP opening balance is 5 × 10¹¹ — an aggregate would need ~18 million such rows to overflow. Guard anyway: Postgres aggregates cast to `NUMERIC` before `SUM`; SQLite report queries aggregate per partition. CI carries an overflow test.
- Domain arithmetic uses one `Money`/`Qty` value object over `decimal.js`, with **explicit rounding at documented boundaries only** (line extension, tax computation, allocation of an invoice-level discount across lines, landed-cost distribution by value or by quantity — `02-purchases.md`). Rounding residue is assigned deterministically to the largest line (largest-remainder method) so totals always reconcile to the cent.

**Double-entry ledger integrity.** The catalog shows the GL is the system's source of truth: `04-accounting-treasury.md` records a "متوازن ✓" balance badge on every entry, a balance-reconciliation screen that cross-checks sub-ledgers against control accounts, and an inventory-valuation report that openly surfaces a **−520.00 EGP** GL-vs-computed drift while stating "السجلات المحاسبية هي المرجع" (the accounting records are the reference). Mezan enforces:

1. **Append-only.** Posted journal entries and their lines are never updated or deleted. Corrections are reversing entries (the FX-revaluation screen already does exactly this with its default-on auto-reversal, `04-...md`).
2. **Balanced or rejected.** `Σ debit = Σ credit` per entry, checked in the domain *and* by a DB constraint (`CHECK` on a per-entry aggregate via a deferred trigger in Postgres; enforced in the single write path plus a nightly verifier on SQLite).
3. **Period gate.** No posting into a `مغلقة`/`مقفلة` period (three-state lifecycle: مفتوحة → مغلقة → مقفلة, `04-...md`).
4. **Immutable cost layers.** Layers retain their receipt-time unit cost by design — the captured UI explicitly explains this to users ("الطبقات تحتفظ بسعرها الأصلي وقت الاستلام — هذا تصميم مقصود", `03-inventory.md`). Mezan keeps that model and keeps the drift report (`/reports/inventory/drift`) that compares recomputed average vs cached average vs layers.
5. **Sequential document numbers with no gaps under concurrency.** Numbering is a transactional counter row (`SELECT ... FOR UPDATE` on Postgres, `BEGIN IMMEDIATE` on SQLite) inside the same transaction as the document insert, covering all 25 sequence types with prefix/suffix/pad-length/annual-reset semantics.
6. **Reconciliation as a shipped feature, not a debugging aid.** Port `/accounting/reconciliation` (sub-ledger vs control account, plus "unlinked control-account entries") and the WAC drift scan — these are the tools that keep a long-lived offline install trustworthy when nobody is watching the server logs.

**Arabic search on both engines.** Do the hard part **once, in TypeScript**: a shared `normalizeArabic()` that strips tashkeel and tatweel, folds أ/إ/آ→ا, ة→ه, ى→ي, ؤ/ئ→ء, normalizes Arabic-Indic digits to Western, and lowercases Latin. Every searchable entity carries a persisted `search_norm` column written by the domain on save. Then:

- **Postgres:** GIN trigram index (`pg_trgm`) over `search_norm` for the substring/typeahead behaviour the catalog shows everywhere ("بحث بالاسم أو الكود"), plus `tsvector` with the `simple` config for any long-text search. Ranking via `similarity()`.
- **SQLite:** FTS5 virtual table over `search_norm` with `tokenize = "unicode61 remove_diacritics 2"` for word search, plus a plain index + `LIKE` for prefix typeahead. Custom tokenizers are not reachable from JS, which is exactly why normalization lives in the app layer.

Because both engines only ever see pre-normalized ASCII-ish text, search results are consistent between editions, and a query written once behaves the same in both. Bilingual entities (nearly every master record has `name` + `nameAr` per the catalog) index both fields into one `search_norm`.

**Migrations.** One authored spec → two generated migration sets, both committed. CI applies every migration from empty to head on both engines and then runs the full suite. Desktop upgrades run migrations on launch, **after** an automatic pre-migration backup (§3.7), inside a transaction, with a rollback-to-backup path if anything throws. Migrations must be forward-only and additive wherever possible, because a desktop install may be several versions behind.

### 2.4 Reports and printing — client-rendered, offline-first

**Recommendation: everything printable renders from React + CSS in the client. No server is required to produce any document.**

This is a hard requirement, not a preference: a desktop customer with no internet must be able to print an invoice, a thermal receipt and a sheet of barcode labels.

| Output | Mechanism |
|---|---|
| A4/A5 documents (invoice, quote, PO, GRN, voucher, statement, financial statements) | React components + a print stylesheet. Browser: `window.print()`. Desktop: `webContents.printToPDF()` for silent PDF, `webContents.print()` for direct-to-printer. Identical DOM in both. |
| Thermal POS receipt | Two paths: (a) 80mm CSS render through the same pipeline; (b) **ESC/POS** raster/text emitted from the Electron main process over `tcp://ip:9100` — the captured terminal config already stores exactly this (`عنوان الطابعة الحرارية`, placeholder `tcp://192.168.1.100`, `05-pos-installments.md`). Path (b) is required for cash-drawer kick and auto-cut. |
| Barcode / price labels | bwip-js renders to SVG/canvas client-side; 3 preset sizes (40×30 thermal, 50×25 shelf, 100×50 product) with the barcode-fit validation the source application already performs ("الباركود لا يناسب هذا القالب"). |
| Report export | XLSX via `exceljs` and CSV in the client. Note the captured build only exposes `تصدير` on 5 of 33 reports (`08-reports.md`) — **Mezan should export everywhere**; it is nearly free once one export pipeline exists, and it is the single most-requested ERP feature. |
| Email delivery of a PDF (online only) | Server generates via headless Chromium when SMTP/Resend is configured (`09-...md` §email tab). **Offline must never depend on this path.** |

**Print templates.** The reference system's designer is a no-code toggle/picker surface across 9 tabs — identity (logo position/size, brand colour, tagline), header fields, document content, line-item columns, totals (including amount-in-words), footer with configurable signature slots, watermark with opacity, a POS-thermal-specific tab, and a per-document-type override layer. Model this as a typed, versioned `PrintTemplateConfig` object stored per tenant with an optional override per document type; one renderer consumes it. Amount-in-words needs an Arabic number-to-words implementation (masculine/feminine agreement, currency + subunit naming) — small but fiddly; budget for it explicitly.

**Report engine.** All 33 reports are, structurally, three things: a parameter bar, one or more aggregate queries, and a table + charts. Build a `ReportDefinition` abstraction (params schema → query plan → column/format spec) so reports are declarations rather than 33 bespoke screens. Two report behaviours from the catalog to preserve deliberately: **GL reconciliation banners** (five reports cross-check their own total against the general ledger and say so on screen) and **on-demand execution** for the two expensive ledger reports (`دفتر الأستاذ العام`, `دفتر حساب` require an explicit "عرض التقرير" click rather than auto-running).

### 2.5 Licensing — Ed25519 offline license files

**Recommended shape.**

```
License = base64url( payload_json ) + "." + base64url( ed25519_signature )
payload = {
  v, licenseId, licensee, edition, plan,
  activeModules[], features{},          // same shape as the cloud tenant object
  seats, issuedAt, notBefore, expiresAt,
  graceDays, machineBinding: [ fingerprintHash, ... ],
  supportUntil, updateChannelUntil
}
```

- **Ed25519** (`@noble/ed25519` — pure JS, no native module) with the public key compiled into the app and the private key held in an offline signing service. Small keys, small signatures, fast verify, no key-size footguns.
- **Machine fingerprint** = salted SHA-256 over stable identifiers: Windows `MachineGuid` (registry), macOS `IOPlatformUUID`, Linux `/etc/machine-id`; optionally mixed with the primary NIC MAC and the system-disk serial. Store only the **hash**, never raw identifiers (privacy, and it survives a support screenshot). Tolerate partial drift: bind on the primary identifier, treat secondary mismatches as a soft signal, not a lockout — hardware changes and VM migrations are normal and a false lockout on a shop's only till is a catastrophic support event.
- **Expiry and grace.** After `expiresAt`, a `graceDays` window (recommend 14) with an escalating in-app banner. After grace: the app enters **read-only mode** — every existing record remains readable, printable and exportable; only new postings are blocked. Mezan must **never** delete, encrypt or withhold a customer's accounting data over a licensing state. That rule is both ethical and commercially correct: a locked-out customer who can still export their books renews; one who cannot, litigates.
- **Clock-rollback resistance.** Persist a monotonic `highestSeenUtc` in OS-protected storage (Electron `safeStorage` / keychain). If the wall clock jumps materially backwards, the app keeps using `highestSeenUtc` and shows a "system clock" warning rather than silently granting free time.
- **Activation.** Online: the app posts `{licenseKey, fingerprint}` to the licensing service, which returns a machine-bound license file. Air-gapped: the app displays a short request code; support pastes back a signed response code. Deactivation/transfer is a first-class flow with a server-side seat counter — plan for the "my PC died" path on day one.
- **Honest limits.** Any JS/Electron client-side check is bypassable by a determined attacker; obfuscation buys time, not safety. The real controls are commercial: signed updates, support entitlement, and periodic (optional) online heartbeats for connected installs. Do not spend engineering budget pretending otherwise. Keep the verification surface tiny and centralized (one `Entitlements` port) so it can be hardened later — including, if it ever becomes worth it, moving verification into a small native addon.
- **Coexistence with cloud subscriptions.** Both editions resolve one `Entitlements` object. Cloud derives it from the subscription record and stamps it into the JWT (the source application already carries `plan`, `activeModules`, `features` on the tenant object). Desktop derives it from the license file. Every gate in the codebase — nav visibility, feature flags, seat limits — reads `entitlements.has('pos.restaurant_mode')` and neither knows nor cares which source produced it. A hybrid "cloud subscription that also issues a desktop license" is then a licensing-service concern only, with zero application changes.

### 2.6 Realtime online, and its offline replacement

The captured backend runs Socket.IO (recon §3) for notifications, workflow/approvals badges, dashboard refresh, POS and the kitchen display.

**Recommended:** define a typed application event bus in `packages/domain` (`InvoiceConfirmed`, `WorkOrderCompleted`, `ApprovalRequested`, `PosSaleRecorded`, `KitchenTicketUpdated`, …). Domain services publish to it inside the committing transaction (transactional outbox), and two transports deliver it:

- **Cloud:** **Server-Sent Events** over the existing HTTP app, scoped per tenant/user, with Redis pub/sub fan-out across instances. SSE beats Socket.IO here — one-way server→client is all these events need, it survives proxies and load balancers cleanly, it reconnects natively with `Last-Event-ID`, and it needs no extra protocol or client library. (Socket.IO stays a viable alternative if bidirectional client→server streaming becomes necessary; nothing in the catalog requires it.)
- **Desktop:** the same bus, delivered in-process via `webContents.send`. Zero infrastructure. Because the renderer subscribes through one `useRealtimeEvent()` hook, UI code is identical across editions.

Offline, "realtime" is trivially satisfied because there is exactly one process. The interesting case is a **multi-till shop on a LAN** (§6): the same Hono app binds to a LAN port, and SSE works unchanged over that socket. Design for it now, ship it when the market asks.

Kitchen Display (`/pos/kitchen`) is the one screen with hard latency expectations; it is also the one screen whose captured implementation shows console errors from a polling/WebSocket connection (`05-...md`). Give it a dedicated, well-tested event channel with polling fallback.

### 2.7 Testing and CI

| Layer | Tooling | What it guards |
|---|---|---|
| Domain unit | Vitest | Invariants: balanced entries, WAC recomputation, allocation/rounding residue, permission dependency resolution, numbering under concurrency. |
| **Dual-engine conformance** | Vitest × 2 matrix (in-memory SQLite + ephemeral Postgres via Testcontainers) | **The core safety net.** The entire repository + query suite runs against both engines every CI run. A dialect divergence fails the build. |
| Golden ledger fixtures | Vitest snapshot | A corpus of end-to-end scenarios (invoice → stock + COGS + AR + VAT; landed cost distribution; FX revaluation with auto-reversal; payroll run; depreciation run) asserted to the exact minor unit. These are the regression tests that make an accounting engine safe to refactor. |
| Adapter parity | Vitest | The same command through the HTTP adapter and the IPC adapter must return byte-identical payloads. |
| API contract | OpenAPI generated from Zod; schemathesis-style fuzz | Prevents contract drift between `api` and `web`. |
| Component | Vitest + Testing Library, Storybook | Each shared primitive (`<DocumentList>`, `<MoneyInput>`, `<ItemPicker>`) in **RTL and LTR**. |
| E2E | Playwright — browser project **and** Electron project | Same specs, two targets. Critical paths: login/activation, invoice lifecycle, POS shift open→sell→close, backup/restore, print-to-PDF snapshot. |
| Visual / RTL | Playwright screenshots on print views | Print regressions are invisible until a customer complains. |
| Performance | k6 (API) + a seeded 5-year dataset | Reports and the GL must stay fast on a large SQLite file, not just on demo data. |

**CI (GitHub Actions).** PR: typecheck → lint (incl. layer-boundary and no-hardcoded-`left/right` rules) → unit → dual-engine conformance → build → Playwright (browser). Main: additionally Electron E2E on Windows/macOS/Linux runners, native-module rebuild, code-signing and notarization, `electron-updater` artifacts, and a migration-upgrade test that restores an old SQLite fixture and migrates it to head. Release artifacts: web bundle + server image, and signed installers for win/mac/linux.

---

## 3. Architecture

### 3.1 Component map

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                          apps/web  —  React SPA (one bundle)                   │
│  Routes · <DocumentList> · forms (RHF+Zod) · charts · print views · i18n/RTL   │
│  data layer: TanStack Query over  ┌──────────────────┐                        │
│                                    │  transport port  │ ← swapped at build     │
│                                    └────────┬─────────┘                        │
└─────────────────────────────────────────────┼──────────────────────────────────┘
                     ONLINE  │ HTTPS                    │ OFFLINE  │ Electron IPC
                             ▼                          ▼
              ┌──────────────────────────┐   ┌────────────────────────────────┐
              │ apps/server (Node)       │   │ apps/desktop (Electron main)   │
              │ • Hono over HTTP         │   │ • Hono via app.fetch()         │
              │ • JWT + refresh, tenant  │   │ • local session, OS keychain   │
              │ • RLS session var        │   │ • license verify (Ed25519)     │
              │ • SSE + Redis fan-out    │   │ • in-process event bus         │
              │ • S3 file storage        │   │ • fs file storage + backups    │
              │ • job runner (cron)      │   │ • ESC/POS socket, printToPDF   │
              └────────────┬─────────────┘   └───────────────┬────────────────┘
                           │        packages/api (shared)     │
                           └───────────────┬──────────────────┘
                                           ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│                    packages/domain  —  THE SHARED CORE (pure TS)               │
│                                                                               │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐  │
│  │  GL Engine     │ │ Costing Engine │ │ Workflow Engine│ │ Numbering      │  │
│  │ post/reverse   │ │ WAC + immutable│ │ 26 action types│ │ 25 sequences   │  │
│  │ balance check  │ │ cost layers,   │ │ sequential role│ │ prefix/suffix/ │  │
│  │ period gate    │ │ landed cost,   │ │ steps → pending│ │ pad / annual   │  │
│  │ FX + reval     │ │ drift/rebuild  │ │ approve/reject │ │ reset, atomic  │  │
│  └────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘  │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐ ┌────────────────┐  │
│  │ Permissions    │ │ Entitlements   │ │ Audit Trail    │ │ Tax / ETA map  │  │
│  │ 268 perms, dep │ │ modules +      │ │ security +     │ │ rates, V001-   │  │
│  │ graph, sensitive│ │ features,      │ │ sensitive ops, │ │ V009 subtypes, │  │
│  │ view/own/all,  │ │ seats, expiry  │ │ severity       │ │ item/branch    │  │
│  │ branch+wh scope│ │ (JWT | license)│ │ (append-only)  │ │ codes          │  │
│  └────────────────┘ └────────────────┘ └────────────────┘ └────────────────┘  │
│                                                                               │
│  Domain services: Sales · Purchases · Inventory · Treasury · Accounting ·      │
│  POS · Installments · CRM · HR · Manufacturing · Assets · Projects · Field     │
│                                                                               │
│  PORTS (interfaces only):                                                     │
│  UnitOfWork/Repositories · Clock · IdGen · EventBus · FileStore ·              │
│  Entitlements · Printer · Mailer                                              │
└───────────────────────────────────┬───────────────────────────────────────────┘
                                    ▼
┌───────────────────────────────────────────────────────────────────────────────┐
│               packages/persistence  —  Drizzle, dual dialect                   │
│  spec/*.ts  ──codegen──▶  schema.pg.ts + schema.sqlite.ts                      │
│                           migrations/pg/*  + migrations/sqlite/*               │
│  SqlDialect capability shim: upsert · RETURNING · locking · LIKE/ILIKE · JSON  │
└──────────────┬────────────────────────────────────────┬───────────────────────┘
               ▼                                        ▼
     ┌────────────────────┐                  ┌──────────────────────┐
     │ PostgreSQL 16+     │                  │ SQLite (WAL)         │
     │ RLS by tenant_id   │                  │ single-tenant file   │
     │ pg_trgm + tsvector │                  │ FTS5 unicode61       │
     └────────────────────┘                  └──────────────────────┘
```

### 3.2 The rule that keeps this honest

> `packages/domain` may not import from `api`, `persistence`, `web`, `electron`, `node:fs`, `node:http`, or any driver. Enforced by `eslint-plugin-boundaries` and a CI check.

If a feature cannot be expressed against the ports, the ports are wrong — not the rule. This is what makes "one core, two products" a structural fact rather than an aspiration.

### 3.3 Auth: multi-tenant JWT online vs local user store offline

**Cloud.** Mirrors the captured flow: company code + email + password → access JWT (short-lived) + opaque refresh token. Claims carry `sub`, `tenantId`, `tenantCode`, `roleId`, `permissions[]` (with `"*"` for tenant admin), `branchIds[]`, `warehouseIds[]`, `isTenantAdmin` (recon §4). Two deliberate improvements over the captured build: put the refresh token in an `HttpOnly` cookie rather than `localStorage`, and keep the access token in memory only — the source application stores both in `localStorage`, which makes any XSS a full account takeover. Argon2id for password hashing; account lockout already exists as an audited event (`ACCOUNT_LOCKED`, severity `CRITICAL`, `09-...md`).

**Desktop.** Users live in the local database. The "session" is a signed local token sealed with Electron `safeStorage` (OS keychain / DPAPI). Roles and the full permission matrix work identically — a shop with a manager and three cashiers needs real permission separation with no server involved. Seat limits come from the license. Optional per-user PIN for fast till switching. First-run wizard: activate license → create the first admin → seed chart of accounts, tax profile, numbering sequences, branch and warehouse → optional data import.

**Shared.** One `AuthContext { userId, tenantId, permissions, branchScope, warehouseScope }` is constructed by the adapter and handed to the domain. The domain's permission checks are identical in both editions — including the three-tier visibility model (`view` / `view_own` / `view_all`) and the **two-dimensional scoping** the catalog documents: *which* branches/warehouses a user may operate in, independent of *what* their role permits there (`09-...md` §add-user form).

### 3.4 File storage

The captured app has a generic attachments service (`/api/attachments/{uuid}/download`, recon §4) used for item images, logos and per-document attachment tabs that appear on nearly every entity.

One `FileStore` port, `put/get/delete/signedUrl`. Cloud: S3-compatible object storage, private buckets, short-lived signed URLs, server-side scanning and MIME allow-list. Desktop: content-addressed files under the app data directory (`{userData}/files/{sha256[0..2]}/{sha256}`), deduplicated, referenced by hash in the DB, **included in backups**. Same API, so an attachment uploaded on desktop and one uploaded in cloud are indistinguishable to the domain. Enforce the captured limits (company logo: JPG/PNG ≤ 2 MB).

### 3.5 Jobs and scheduled work

The catalog contains several batch operations that must run somewhere: overdue-installment processing with late penalties (`معالجة المتأخرات`), leave-accrual batches (which **post a journal entry**), payroll runs, depreciation runs, FX revaluation, aging-based inventory provisioning (monthly, posting to 5060/1190), WAC drift scans, and ETA submission.

- **Cloud:** a job runner (BullMQ on Redis, or `pg-boss` to avoid another dependency) with cron schedules per tenant.
- **Desktop:** a lightweight in-process scheduler that runs on launch and on an interval, with **catch-up semantics** — a shop that was closed for a week must, on next launch, process the missed month-end. Every job is idempotent and keyed by period so a double-run is a no-op. Manual triggers stay available (the source application already exposes "تشغيل استحقاق الآن" and "معالجة المتأخرات" as buttons).

### 3.6 ETA (Egyptian Tax Authority) e-invoicing

Structurally: a domain-owned **submission queue** plus an online-only transmitter. Confirmed documents enter the queue on confirmation (the reference system's `الإرسال التلقائي عند التأكيد` toggle is on by default and warns that month-end batching risks breaching the legal deadline). Lifecycle: جاهز → بانتظار التوقيع → مرسل → مقبول, with `أخطاء` and `مستبعد` (exclusion requires a reason) as side states.

The key constraint to write down loudly: **submission requires internet and, for production document version 1.0, an e-seal signature** (the captured build runs unsigned v0.9 test mode and notes local signing-agent/HSM support is "in a coming phase"). Therefore on desktop, ETA is *queue-and-forward*: documents accumulate locally with full ETA payload built offline, and transmit when connectivity appears. See §6 for the compliance risk this creates.

### 3.7 Backups — a first-class feature, not an afterthought

For a desktop ERP this is the highest-consequence feature in the product. A corrupted or lost SQLite file is a business destroyed, and there is no ops team behind it.

- **Automatic:** on every launch, before every migration, and on a configurable schedule (default daily + on app close). Use SQLite's online backup API (`VACUUM INTO` / `better-sqlite3`'s `backup()`), never a raw file copy of a live WAL database.
- **Contents:** database + attachment files + license + settings, packaged as one integrity-checked archive with a manifest (schema version, app version, row counts, checksum).
- **Retention:** GFS-style (7 daily / 4 weekly / 12 monthly), size-capped, stored outside the app directory by default so an uninstall does not destroy them.
- **Off-device:** one-click export to a user-chosen folder/USB, plus optional cloud backup (customer-supplied Google Drive/OneDrive/S3 credentials) — an explicit opt-in, since it moves financial data off-premise.
- **Restore:** a guided, verified flow — validate manifest → checksum → migrate to current schema → mount. Test restore is a menu item, and **restore is covered by an E2E test on every release**. An untested backup is not a backup.
- **Integrity:** periodic `PRAGMA integrity_check` + a ledger self-audit (trial balance nets to zero; sub-ledgers equal control accounts) surfaced in the existing `/accounting/reconciliation` screen.

Cloud edition gets the platform equivalent: PITR, cross-region snapshots, and a per-tenant export ("give me all my data") which doubles as the migration path into the desktop edition.

---

## 4. Module build order

Ordered by dependency, not by visibility. Sizes are **relative** effort (S < M < L < XL), not calendar promises.

### Phase 0 — Foundations · **XL**

Nothing else is safe to build until this exists.

- Monorepo (pnpm + Turborepo), package boundaries + lint enforcement.
- **Dual-engine harness**: schema spec DSL, pg/sqlite codegen, both migration sets, conformance suite in CI. *Do this first; retrofitting is brutal.*
- `Money`/`Qty` value objects, scaled-int codecs, rounding policy + tests.
- Auth (cloud JWT + desktop local store), tenancy + RLS, `AuthContext`.
- **Permissions engine**: 268-permission catalog, dependency resolution, sensitive flags, view/view_own/view_all, branch+warehouse scoping.
- **Entitlements port** + license verification skeleton (Ed25519, fingerprint, grace).
- **Numbering engine** (25 sequences, atomic, both engines).
- **Audit trail** (append-only; security events + sensitive operations, severity taxonomy).
- **Workflow engine core** as a pluggable gate on document confirmation. The captured model is now fully specified (`09-...md` §workflow): **26 gateable action types**, each configured with an ordered list of steps, each step naming an **approver role** (not a user), evaluated **sequentially**, with **no conditional/threshold fields** — a configured gate applies to every instance of that action. Only tenant-defined *custom* roles are selectable as approvers; tenant admins hold `"*"` and bypass gating entirely. Emits `WORKFLOW_APPROVAL_REQUESTED / GRANTED / REJECTED / MODIFICATION_REQUESTED` events. The gate must exist from the start because journals, vouchers, refunds, exchange rates, leave (9 granular per-leave-type gates), payroll, stock transfers/adjustments and work-order start all reference it. *(POS discount approval is a separate mechanism with its own percentage/amount thresholds and a 5-minute expiry — do not conflate the two.)*
- **Notification bus + rules engine** (39 events; recipient by permission-holder; priority; channels in-app / email / push; optional condition field+operator+value; Arabic title/body templates with `{{customerName}}`, `{{amount}}`, `{{documentNumber}}`). The event taxonomy doubles as the domain event bus of §2.6 — define it once.
- App shell: RTL design system, IBM Plex Sans Arabic, i18n scaffolding, `<DocumentList>` / `<DocumentDetail>` / filter-panel / KPI-strip primitives, side-panel drill-down pattern, attachments widget, audit-log tab.
- Settings foundation: tenant settings object, branches, warehouses (5 types), general/company/tax tabs.
- Electron shell: window, IPC bridge, `app.fetch()` mount, auto-update, **backup/restore**.

**Deliverable:** an empty but real app — you can log in on web and on desktop, see the shell in Arabic RTL, manage users/roles/branches/warehouses, and the same code runs on both databases with CI proving it.

### Phase 1 — Master data · **L**

Items (types, UOM + alternate units, barcodes, per-item GL mapping, costing method, batch/expiry flags, reorder policy, ETA codes), item categories/brands/seasons, **product templates + variant generation**, customers (credit terms/limit, category, price list, ETA buyer type, tax exemption), suppliers + categories, price lists, tax rates (+ ETA V001–V009 subtypes, posting accounts 2200/1400), chart of accounts (hierarchy, natural balance, main vs postable), cost centers, treasury accounts, fiscal periods.

**Deliverable:** every master record in the system can be created, edited, searched (Arabic-normalized) and permission-gated.

### Phase 2 — Ledger + costing engine · **XL**

The heart. Double-entry posting with balance enforcement and period gating; journal entries (manual + system-generated, draft → pending → posted → reversed); WAC engine with immutable cost layers; stock movements; stock adjustments (8 reasons, incl. `INITIAL_STOCK` opening balances — with the GL entry the catalog shows: Dr 1200 Inventory / Cr 3100 Owner's Capital); stock transfers (valuation-neutral, one-way confirm); stock balance; inventory valuation + **drift detection/rebuild**; balance reconciliation (sub-ledger vs control accounts, unlinked entries); multi-currency + FX revaluation with auto-reversal.

**Deliverable:** stock can be brought in, moved, adjusted and valued, and every movement produces a correct, reconcilable journal entry — provable by the golden-ledger fixtures on both engines.

### Phase 3 — Sales and Purchases documents · **XL**

- **Sales · L:** quotes (مسودة→مرسل→مقبول→محول), invoices (draft→confirmed→partially paid→paid, + overdue/cancelled), returns against a confirmed invoice, promotions/coupons engine (percentage / fixed / special price / buy-X-get-Y / bundle, with scope, coupon requirement and day-hour restrictions), price-list application, credit control (warn vs block).
- **Purchases · L:** RFQ → PO → GRN → purchase invoice (manual or from receipt) → purchase return, landed costs (distribute by value or by quantity), the three procurement strictness gates (require-PO-for-GRN, require-GRN-for-invoice, sold-item cancellation guard).

**Deliverable:** the full order-to-cash and procure-to-pay chains post correctly to stock and to the GL, including the "effects of this document" explainer panels that are one of the reference system's best UX ideas and should be kept verbatim in spirit.

### Phase 4 — Treasury · **L**

Unified voucher document with **10 types**; invoice allocation / cash application (with reversible allocations, and a "needs allocation" state); inter-treasury transfers; account statements with running balance and opening balances; cheque register (7-state lifecycle, incoming/outgoing, mapping to accounts 1320/1360); bank statement import (CSV with persisted per-account column mapping) and line matching; cash-vs-bank negative-balance policy (cash hard-blocked, bank overdraft allowed).

### Phase 5 — Reports, print and numbering UX · **XL**

All **33 reports** via the `ReportDefinition` abstraction: 7 sales, 3 purchases, 8 inventory, 1 manufacturing, 2 aging, 2 POS, 2 installments, 8 accounting/financial-statement surfaces (trial balance, income statement, balance sheet, cash flow — indirect method, VAT return, general ledger, account ledger, cost-center P&L). Plus GL-reconciliation banners, the on-demand pattern for the two heavy ledger reports, export everywhere, the 9-tab print-template designer with per-document overrides, Arabic amount-in-words, label printing, and the embedded/weight-barcode parsing rules (prefix + item-code digits + price digits + decimals + EAN-13 check).

### Phase 6 — POS · **XL** *(highest design risk)*

Back-office parity is straightforward: terminals, sessions/shifts with close-out variance, sales and refunds ledgers, discount-approval queue with thresholds, payment-method catalog, shift templates, restaurant mode (tables + floor designer, kitchen display, reservations, deliveries), loyalty points.

The **selling screen is net-new design work** — the source application has none on web. Requirements to design against, all inferable from the catalog: product grid + search + barcode scan (including embedded price/weight barcodes), cart with line discounts, held/suspended sales, split and multi-method payments, customer attach + walk-in default (`زبون عابر`), AR collection from the till (gated by the `السماح بتحصيل الآجل من الكاشير` setting), discount-over-limit approval request flow, course/meal sections routing to the kitchen, table assignment, cash-drawer movements, receipt print + drawer kick, and **hard offline behaviour with an offline sale queue** (the `force_close` permission — "close with pending offline sales" — proves the original models this). This screen deserves its own design spike before implementation.

### Phase 7 — Periphery modules *(parallelizable once Phases 0–4 land)*

| Module | Size | Notes |
|---|---|---|
| Installments | **M** | Invoice-driven plans only (schedule generation, 4 frequencies, down payment), overdue batch + late penalties, collection follow-ups. **Late-fee configuration is not exposed anywhere in the captured UI — needs a product decision.** |
| HR | **XL** | 13 screens: employees, departments, job titles, contracts (allowances/deductions/leave overrides), attendance grid, holidays, leave requests + policies (Egyptian Labour Law 12/2003 and 14/2025 presets), leave accrual batches *(posts journal entries)*, payroll runs (5-state), employee advances *(balance-sheet asset, not expense)*, HR dashboard. Deep Egyptian labour-law compliance — Article 47 seniority, overtime multiplier, day-divisor basis. |
| Manufacturing | **L** | BOMs (versioned, waste %), work orders (4-stage execution with material issue/return/waste, WIP costing, finished-goods receipt), configurable products (formula-driven materials/price/labour/overhead) and custom manufacturing orders, production dashboard, make-vs-buy. **Formula evaluation needs a sandboxed expression evaluator — no `eval`.** |
| Fixed Assets | **M** | Register (scope: general/branch/warehouse), categories with depreciation + GL defaults (1500/5400/1590/4500/5450), depreciation runs (draft→posted), daily proration (IFRS), disposal. |
| CRM | **M** | Leads (6 states), opportunities, pipeline kanban, configurable stages with win/loss flags and probabilities, lead→opportunity conversion, activities. |
| Projects | **S** | One screen in the captured app; auto-creates a `PRJ-{code}` cost center. Contracting advances exist as a voucher type — investigate whether progress billing (مستخلصات) is expected. |
| Field / Van sales | **M** | Trip open (crew, van warehouse, opening cash float, per-payment-method treasury routing), van stock load via transfer, in-field sales/collections, cash + stock settlement with variance. Touches Inventory, Treasury and HR. |

### Phase 8 — Compliance, migration and platform

| Workstream | Size | Notes |
|---|---|---|
| ETA e-invoicing | **L** | Config, credentials (AES-encrypted, write-only secret), item/unit/branch code mapping, readiness checklist, submission queue and lifecycle, JSON export, buyer-data threshold (25,000 EGP → national ID required), document version 0.9/1.0, e-seal signing. **Online-only.** |
| Data migration / historical import | **M** | Excel templates for historical purchase invoices and returns (archive fully-paid docs without a journal entry; record remaining balances as payables; **do not touch stock**), opening balances via `INITIAL_STOCK` adjustments and treasury opening balances, the `/settings/data-migration` screen, plus a **source-system→Mezan importer** if customers are being migrated. |
| Workflow configuration UI | **S–M** | The engine ships in Phase 0; this is the chain builder: pick one of 26 action types, add ordered steps, assign a custom role per step. Deliberately simple — the captured screen has no conditions or thresholds. Plus the `/approvals` inbox and its global pending/rejected badge. |
| Notification rules + email templates | **M** | Rule builder over the 39-event catalog (event → optional condition → recipient-by-permission → priority → channels), Arabic message templating, HTML email template editor with `{{logo}}`/`{{companyName}}`/`{{year}}`, SMTP or Resend. **In-app notifications work offline; email and push are online-only** — the rules engine must degrade per channel, not per rule. |
| Licensing service + activation portal | **M** | Signing service, seat management, activation/deactivation/transfer, offline challenge-response. |
| Packaging, signing, auto-update | **M** | Windows code-signing (EV cert), macOS notarization, Linux AppImage/deb, `electron-updater` channels gated by `updateChannelUntil`. |

---

## 5. Cross-cutting workstreams

These run alongside the phases and each needs a named owner.

**5.1 Design system and RTL.** One token set (shadcn CSS variables), light/dark, Arabic-first typography with correct line-height for Arabic ascenders/descenders. Shared primitives that pay for themselves ~40× each: `<DocumentList>` (KPI strip + status chips with counts + filter panel + sortable table + pager), `<DocumentDetail>` (header/status/actions + summary strip + **"تأثيرات هذا المستند" effects explainer** + tabs), `<SidePanel>` drill-down (used everywhere: customer, supplier, item, account, branch, user, journal entry), `<AttachmentsTab>`, `<AuditLogTab>`, `<MoneyInput>`, `<QtyInput>`, `<EntityPicker>`, `<DateRangeFilter>` with the standard period chips (هذا الشهر / الشهر الماضي / هذا الربع / هذه السنة). The reference system's plain-language "effects" panels and inline explainers are a genuine product differentiator — treat them as a design-system component, not per-screen copy.

**5.2 Permission matrix.** 268 permissions, `module.entity.action` dot notation, an enforced dependency graph (granting `.confirm` implies `.view_own`), a `sensitive` flag with distinct UI treatment (cost visibility, salary/personal data, money-reversing actions), three-tier visibility (`view` / `view_own` / `view_all`), and orthogonal branch/warehouse scoping. Two permissions are platform-admin-only (`admin.tenant.settings.edit`, `admin.modules.manage`) — the desktop edition needs an equivalent tier concept, most naturally expressed as license-controlled rather than role-controlled. Build the catalog as **data** (a versioned TS manifest) so the role editor, the API guards and the docs all read one source.

**5.3 Print, numbering and label infrastructure.** Covered in §2.4 / Phase 5. One shared package, three output adapters, zero server dependency. Open question flagged: sequences appear tenant-global in the captured build with no per-branch scoping — multi-branch customers usually want branch-prefixed numbering.

**5.4 Data import.** Two distinct problems that are often conflated: (a) **go-live import** of historical documents and opening balances, where the explicit rule from the catalog is *archive settled documents without journal entries, record only outstanding balances, and never touch stock*; and (b) **source-system→Mezan migration** for existing customers, which is a different, higher-fidelity job. Build (a) as a generic mapped-Excel importer with dry-run + validation report + all-or-nothing commit; scope (b) once a real customer migration is on the table.

**5.5 ETA e-invoicing.** Documented constraint, stated plainly: **ETA submission is online-only.** Offline desktop installs build and queue ETA payloads locally but cannot transmit. Because Egyptian law imposes a submission deadline, a fully-offline install carries real compliance exposure. Product decisions needed (§6): does the desktop edition require *periodic* connectivity for ETA-enabled tenants? Is ETA a cloud-only feature? Or does the desktop app ship with an explicit, acknowledged "you must connect within N days" warning and an escalating banner? Engineering can support any of these; someone must choose.

**5.6 Workflow and notifications as one event taxonomy.** The approvals engine's 26 action types and the notification engine's 39 events overlap heavily and both describe the same underlying domain events. Define **one** versioned event catalog in `packages/domain` and let all three consumers read it: the workflow gate (which action types can be gated), the notification rules engine (which events can trigger a rule), and the realtime transport of §2.6 (what gets pushed to connected clients). Three separate hardcoded lists is the failure mode to avoid. Note the asymmetry to preserve: workflow gates are unconditional, while notification rules carry an optional condition (field / operator / value) — and POS discount approval is a *third*, threshold-driven mechanism that lives entirely in POS settings and must not be folded into the workflow engine.

**5.7 Audit log.** Append-only, two streams (security events, sensitive operations), severity taxonomy (`CRITICAL`, `WARNING`, and presumably `INFO`/`ERROR`), `module` + `entityType` + `action` + actor + timestamp + details. In the captured app this screen exists at `/audit/reports` but is **not linked from the nav** — reachable only via the command palette, gated by the single `audit.logs.view` permission. Mezan should link it properly. On desktop the audit log matters *more*, not less: it is the only forensic record when there is no server.

**5.8 Accessibility and keyboard-first operation.** ERP data entry is keyboard work. Full tab-order discipline, a command palette (`Ctrl+K`, already present in the captured app with ~80 indexed pages plus quick actions), keyboard-navigable typeaheads (the catalog notes one picker whose dropdown had no clickable accessibility target — an actual defect to avoid), and a barcode-scanner-friendly focus model on POS and label screens.

---

## 6. Risks and open decisions

### 6.1 Demo-tenant blind spots (collected from every catalog's gaps section)

The recon was run against a demo tenant where many features have zero records. These are **specification holes**, not implementation risks — each needs either a second capture pass against a richer tenant, or a product decision.

| Area | What could not be observed | Source |
|---|---|---|
| Price lists | No lists existed → the per-item price-override grid (the actual pricing mechanism) was never seen, even though a customer references "قائمة الأسعار الأساسية" | `01-sales.md` |
| Promotions | Zero promotions → no edit view, no evidence of how bundle/BXGY rewards actually compute | `01-sales.md` |
| Sales returns | Confirm/cancel actions and the refund-settlement path not exercised | `01-sales.md` |
| Quote → invoice | No "convert" affordance found on the quote itself; conversion appears only as a mode on the new-invoice screen | `01-sales.md` |
| Delivery notes | **No delivery-note screen exists anywhere** — stock is deducted on invoice confirmation. Is this a gap to fill or a deliberate simplification? | `01-sales.md` |
| Purchases | Zero POs, RFQs, GRNs, returns and landed-cost docs → **every line-item auto-population behaviour is unobserved**: PO→GRN fill, invoice-from-receipt fill, landed-cost invoice picker, RFQ supplier-quote entry and comparison | `02-purchases.md` |
| Physical counts | Zero counts → the count-entry grid, variance column and "generate adjustment" step were never seen (only the start dialog) | `03-inventory.md` |
| Batch/expiry, alternate UOM | Features exist but no populated data → FEFO behaviour and UOM conversion unverified | `03-inventory.md` |
| FIFO costing | Offered in the dropdown; **no FIFO-costed item exists** → FIFO semantics entirely unverified | `03-inventory.md` |
| Cost centers | Zero cost centers → Cost Center P&L never rendered with data; no transaction carries the dimension | `04-...md`, `08-...md` |
| Exchange rates / FX | Zero rates configured; revaluation never run; rate approval + lock workflow unobserved | `04-...md` |
| Bank reconciliation | No bank accounts exist → import, column mapping and line-matching entirely unexercised | `04-...md` |
| Cheques | Zero cheques → the 7-state lifecycle and its GL postings unobserved | `04-...md` |
| Opening balances (non-treasury GL) | No mechanism found for AR/AP/equity opening balances; presumed journal entries or the data-migration tool | `04-...md` |
| Account-linking tab, tax groups | `ربط الحسابات` tab and the tax-groups screen were never opened | `04-...md` |
| **POS selling screen** | **Does not exist on web at all** — the entire cart/payment/scan/hold/discount surface must be designed from scratch | `05-...md` |
| Kitchen display | Empty queue → order-card layout, bump/stage controls never seen | `05-...md` |
| Deliveries, reservations, discount approvals | All zero records → detail/approve/dispatch flows unobserved | `05-...md` |
| Installments | Zero plans → plan detail, per-installment collection, and **late-penalty configuration (not found anywhere in settings)** | `05-...md` |
| CRM | **Entirely empty** — no lead or opportunity detail view, and the lead→customer/opportunity conversion mechanism is unknown | `06-...md` |
| HR | One employee, one contract, everything else empty → payroll run internals, leave-type resolution, leave-policy rows, accrual output all unobserved | `06-...md` |
| Projects | Zero projects → no detail, costing or billing tabs exist to inspect; contracting progress-billing unknown despite an advance voucher type existing | `07-...md` |
| Fixed assets | Zero assets → no detail/edit view, no depreciation schedule, and the **depreciation-run trigger was not reachable at all** | `07-...md` |
| Reports | Two ledger reports never run (on-demand); several reports empty; **27 of 33 have no export** | `08-...md` |
| Settings | **No subscription/plan screen, no integrations hub, no currencies screen**; an "Inbox" page appears in the command palette with an unresolved route; WAC drift settings exist in the tenant payload but are **not tenant-editable anywhere** | `09-...md` |
| Workflow / approvals | **Zero approval chains configured** (`workflowConfig: []`) → no pending approval, no `/approvals` inbox content, and no multi-step chain was ever observed executing. The engine's *shape* is specified (26 action types, sequential role steps); its *runtime behaviour* — what a rejected document does, whether "modification requested" returns it to draft, what happens if an approver role is deleted mid-chain — is not | `09-...md` §workflow |
| Notification rules | **Zero rules configured** → the recipient-type enum beyond "by permission" is unenumerated, the priority scale is unknown, the condition operator set is unknown, and WhatsApp appears in a section label but not in the channel checkboxes | `09-...md` §notification rules |
| Settings (catalog incomplete) | `/settings/data-migration` is marked as captured in the pass inventory but **its content section had not been written to the catalog at the time of this draft** — the go-live import surface is therefore only known indirectly (via the purchase-invoice/return Excel-import modals in `02-purchases.md`) | `09-...md` |

Known defects in the original worth *not* reproducing: an untranslated i18n key on the supplier statement (`customers.openingBalance`), a nav label vs page header mismatch on Goods Receipts, a reservation dialog whose default end time precedes its start time, a work-order list whose row click opens the *product* instead of the work order, a stored `direction: "LTR"` on an RTL tenant, and an HR dashboard showing 1 termination against 1 active employee.

### 6.2 Architectural and delivery risks

| Risk | Impact | Mitigation |
|---|---|---|
| **Dual-dialect drift** — a query works on Postgres, subtly differs on SQLite | Wrong numbers in a customer's books; worst-case class of bug in this product | The conformance suite is non-negotiable and must exist from day one. Golden-ledger fixtures asserted to the minor unit on both engines. |
| **SQLite performance at 5-year scale** — big report queries, no parallelism, no materialized views | Desktop app becomes unusable for established businesses | Seeded 5-year performance fixture in CI from Phase 2. Pre-aggregate hot report inputs into summary tables maintained transactionally. Accept "run report" (on-demand) UX for the heavy ledger reports, as the original already does. |
| **Money precision / rounding** across discount allocation, tax, landed-cost distribution, WAC, FX | Cent-level drift that compounds and destroys trust | One `Money` type, rounding only at documented boundaries, largest-remainder allocation, property-based tests that assert totals always reconcile. |
| **Electron bundle size and native modules** (`better-sqlite3` ABI per platform) | Painful release engineering; broken installers | Rebuild in CI on all three OSes; keep the driver behind the port so `node:sqlite`/libSQL is a swap, not a rewrite. |
| **Scope: 33 reports and ~268 permissions are individually small and collectively enormous** | Endless "90% done" | Abstract early (`ReportDefinition`, permission manifest as data, `<DocumentList>`). If configuration is cheaper than code, the tail is tractable. |
| **POS selling screen has no reference implementation** | The most-used screen in retail is the least specified | Dedicated design spike with a real cashier before Phase 6. Prototype and test on actual hardware (scanner, thermal printer, drawer, touch). |
| **ETA compliance offline** | Legal deadline exposure for offline customers | Decision required (§6.3). At minimum: prominent unsent-queue counter, age-of-oldest-unsent warning, escalating banner. |
| **Licensing is bypassable in JS** | Revenue leakage | Accept it; keep verification centralized and cheap; rely on commercial controls (updates, support, activation seats). Do not gold-plate. |
| **Egyptian regulatory change** (Labour Law 14/2025 presets already appear in the captured app; VAT and ETA schemas evolve) | Recurring compliance work forever | Model legal constants as versioned, dated data (as the reference system does with its two labour-law presets), never as hardcoded logic. |
| **Arabic search quality** — normalization edge cases, mixed AR/EN records | Users cannot find their own data | Shared `normalizeArabic()` with a substantial test corpus; index both `name` and `nameAr` into one normalized column. |
| **Restore path untested** | Total data loss for a desktop customer | Restore is E2E-tested every release. Ship a "verify my backup" button. |

### 6.3 Open decisions (need a human answer)

1. **Licensing mechanism is not finally chosen.** This plan recommends Ed25519 offline license files with machine binding, grace, and read-only-after-grace. Alternatives on the table: a simple perpetual key with no binding (friendlier, leakier); a subscription requiring an online heartbeat every N days (stronger, breaks true-offline); a hardware dongle (strongest, worst UX and logistics); or a third-party service (Keygen/Cryptolens — faster to ship, adds a vendor dependency and a cloud dependency at activation). **Decision needed before Phase 0 closes**, because the `Entitlements` port shape depends on it. Sub-decisions: perpetual-with-maintenance vs annual? Seat counting per device or per named user? Module-level licensing (matching `activeModules`) or edition tiers?
2. **Desktop ↔ cloud sync is explicitly OUT OF SCOPE.** The desktop edition is a standalone product with its own database. Recorded as a **future option**, and the architecture keeps it feasible (stable UUID keys, `tenant_id` present on desktop, append-only ledger, transactional outbox, per-document numbering that could be namespaced). If it is ever requested, the right shape is a **designed, one-way, document-level replication** with explicit conflict rules and namespaced sequences — never a generic CRDT layer over a general ledger. Anyone requesting "just make it sync" should be shown the duplicated-invoice-number and split-cost-layer failure modes first.
3. **Multi-user LAN on desktop.** Does the desktop edition need to serve 2–5 terminals in one shop (a genuine POS need), or is it strictly single-machine? Recommendation: build the capability (bind the same Hono app to a LAN port; SQLite WAL handles a handful of concurrent clients comfortably), gate it behind a license flag, and ship it when demand appears. Affects seat counting and the licensing decision above.
4. **ETA on the desktop edition** — required connectivity window, cloud-only, or acknowledged-risk offline queue? (§5.5)
5. **Installment late fees** — no configuration surface exists in the captured product. Fixed rule, tenant setting, or per-plan? Product must define the calculation.
6. **FIFO costing** — the option exists in the item form but no FIFO item exists in the demo tenant. Is FIFO in scope for v1, or is Mezan weighted-average-only at launch?
7. **Delivery notes** — genuinely absent from the source application. Fill the gap or match the original?
8. **Branch-scoped numbering sequences** — the original appears tenant-global. Multi-branch customers usually expect branch prefixes.
9. **Third locale** — the language switcher offers Deutsch. Real requirement or leftover scaffolding?
10. **Reference tenant for gap-filling.** Can we get access to a *populated* tenant (or a customer's sandbox) to close the §6.1 blind spots? This is the cheapest risk reduction available and should be pursued immediately.

---

## 7. Immediate next steps

The first five concrete tasks, in order.

1. **Lock the three foundational decisions.** (a) the licensing mechanism (§6.3.1), (b) ETA's offline posture (§6.3.4), (c) whether desktop must serve multiple terminals on a LAN (§6.3.3). Each changes Phase-0 interfaces; none can be deferred past it. Output: a one-page decision record per item.

2. **Build the dual-engine spike — one week, throwaway-quality, highest information value.** One vertical slice: a `journal_entry` + `journal_line` table authored once in the schema-spec DSL, codegen to pg + sqlite, both migration sets, a `post()` domain service with balance enforcement and scaled-int money, and the conformance suite running the same tests against Postgres and SQLite in CI. Mount it behind a Hono app and call it **both** over HTTP and via `app.fetch()` from an Electron main process. This spike proves or kills the entire architecture for the price of one week. **Do not start Phase 0 proper until it is green.**

3. **Request a populated reference tenant and run a second recon pass** targeting the §6.1 blind spots, in priority order: purchase-document line auto-population (PO→GRN→PI), price-list per-item grid, physical-count session, payroll run internals, asset depreciation run, an *executing* approval chain (reject / modification-requested behaviour), and `/settings/data-migration` (still unwritten in the catalog). Without this, Phases 3, 5, 7 and 8 will be designed on inference.

4. **Run the POS selling-screen design spike.** Interview a real cashier, storyboard the flows (scan → cart → discount request → split payment → receipt → drawer; hold/resume; AR collection at the till; offline queue and force-close), prototype in the RTL design system, and test with actual hardware: barcode scanner, 80mm thermal printer, cash drawer, touch screen. Output: an agreed screen spec before Phase 6 is planned.

5. **Stand up the monorepo skeleton and CI.** pnpm + Turborepo, the six packages of §2.2, enforced layer boundaries, RTL lint rules, Vitest matrix (sqlite + Postgres via Testcontainers), Playwright with browser **and** Electron projects, and a release pipeline that produces a signed Windows installer from an empty app. Proving the packaging/signing/notarization chain on an empty app is dramatically cheaper than discovering it at the first release.

---

### Appendix A — Traceability

| Section | Grounded in |
|---|---|
| Scope numbers, tenancy, API shape, stack of the original | `recon/source-recon.md` §2–§8 |
| Sales documents, promotions, price lists, van trips | `catalog/01-sales.md` |
| Procurement chain, landed costs, historical import | `catalog/02-purchases.md` |
| Items, variants, configurable products, adjustments, transfers, counts, labels, warehouses, branches, valuation | `catalog/03-inventory.md` |
| Chart of accounts, journals, periods, taxes, FX, ETA, reconciliation, treasury, vouchers, bank rec, cheques, ledger reports | `catalog/04-accounting-treasury.md` |
| POS terminals/sessions/sales/refunds/restaurant/discounts/settings, installments | `catalog/05-pos-installments.md` |
| CRM pipeline, HR employees/contracts/attendance/leave/payroll/advances | `catalog/06-crm-hr.md` |
| Manufacturing, configurable products, projects, assets, field sales | `catalog/07-mfg-projects-assets.md` |
| All 33 reports and financial statements | `catalog/08-reports.md` |
| Tenant settings payload, dashboard, global UX, users/roles/permission matrix, branches, warehouses, numbering, print, barcode, audit, notification rules, workflow/approvals config | `catalog/09-settings-dashboard-ux.md` |

**Nothing in this plan describes a feature that does not appear in those files, except:** the POS selling screen (explicitly absent from the source application's web app and required by Mezan), the desktop backup/restore subsystem, the licensing subsystem, and export-on-all-reports — each called out as a deliberate addition where it appears.
