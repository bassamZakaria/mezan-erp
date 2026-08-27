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

This section is maintained as the plan executes; §4 below stays the unmodified original phase design. Every claim here was re-verified against the code in this pass; `docs/STATUS.md` carries the current per-capability state.

**Done.** Every v1 domain named in §4 has landed: Foundations (persistence-behind-ports, Money/Qty, auth, permissions, entitlements/licensing skeleton, numbering, audit trail, workflow-engine core, notification bus core, RTL app shell, Electron shell + backup/restore) through Phase 12 (CRM + Projects + Fixed Assets + Field/Van Sales). Concretely, `packages/domain/src` holds 49 domain modules covering accounts, GL/journal posting, cost centers + cost-center P&L, fiscal periods, tax rates, exchange rates + FX revaluation, reconciliation, items, customers/suppliers/partners, sales quotes/invoices/returns, price lists, promotions, credit control, purchasing (RFQ→PO→GRN→invoice), purchase returns, landed costs, inventory, treasury accounts, vouchers, cheques, bank reconciliation, installments, manufacturing, CRM, projects, fixed assets, field sales, permissions, roles, users, workflow, entitlements, licensing, numbering, audit, events, ETA, settings and the LAN host. Each has a persistence + API layer and is mounted in `packages/backend`. The engines called out as the hardest parts of the plan — double-entry posting with balance/period enforcement, WAC costing with immutable cost layers, the 26-action-type workflow gate, the 25-sequence numbering engine, the 268-permission catalog with dependency resolution — are all implemented and covered by unit tests, plus a recent backfill pass added component/unit coverage for previously-thin modules. The real-data control panel described in `docs/web-data-wiring.md` (typed hooks over one platform-swapped transport, real loading/empty/error states, no static arrays driving a screen) is in place and is now the pattern nearly every screen follows; the most recent merges to `main` mounted the manufacturing/RFQ/historical-import/returns/landed-costs/installments backends, converted the remaining sample-data screens, and fixed a real SQLite write-concurrency bug: `createBackend` opened ~35 separate `better-sqlite3` connections onto the same file, and a confirm flow that both issued stock and posted a GL entry inside one store's `BEGIN IMMEDIATE` deadlocked against itself across those separate connections (`SQLITE_BUSY`, not waitable by `busy_timeout` alone). That's fixed — every store-owned connection now goes through `packages/persistence/src/sqlite-connection.ts`'s `openSqliteConnection` (WAL + shared `busy_timeout`) and `withSqliteTransaction` (savepoint-based re-entrancy) — landed directly on `main`.

**Gates.** `pnpm test` → 306 test files / 2078 tests passing; `pnpm typecheck` and `pnpm lint` (incl. the RTL logical-CSS rule) pass; 28 Playwright specs live under `e2e/`; 33 API route prefixes are mounted; the web app ships 74 non-test components across ~70 nav entries.

**Landed since the previous revision of this section.** The financial-statement report family (income statement, balance sheet, cash flow, VAT return, general/account ledger) and the inventory-operations merge (stock adjustments, transfers, physical counts, stock balance) are both on `main`.

**Not built (gaps, not deferrals).** Verified absent across all layers: the platform admin UIs (approvals inbox, notification-rules builder — no rules engine exists either, only the event bus; numbering-sequences admin, barcode config, data-migration wizard, audit-log viewer), the 9-tab print-template designer (the page is a live `PrintView` preview instead), label printing, product templates / variant generation, the aging-based inventory write-down batch, every per-domain hub landing page, the branch 360 view, the profile screen, the production dashboard, and the sales-by-salesperson / van-sales / POS report packs.

**In progress.**
- **Real-data sweep, finishing touches** — 7 `*-sample-data.ts` files still exist under `apps/web/src` (the six previously listed plus `inventory-ops-sample-data.ts`) with roughly twenty importers. `sample-data.ts` is not just demo rows: it still owns the nav registry, the command-palette items and the demo entitlements, so retiring it needs those moved somewhere real first.
- **Domain-in-browser screens** — 9 screens (`StockBalance`, `StockTransfers`, `StockAdjustments`, `PhysicalCounts`, `ExchangeRates`, `FxRevaluation`, `CostCenterPnL`, `Reconciliation`, `Eta`) import `@mezan/domain` directly through `apps/web/src/store/*` and run it against in-memory repositories. The rules are the real ones and the tests are meaningful, but nothing these screens do reaches SQLite, and their API routes are already mounted — so this is web wiring, not new backend work.
- **Manufacturing/RFQ mount** — domain + persistence + API layers exist for Manufacturing (BOMs, work orders, configurable-product instances) and RFQs; the backend-mount and web-screen wiring landed in the most recent merge and needs a stabilization pass (edge cases, e2e coverage) before being considered fully hardened.
- **Bug-hunt** — an active sweep across the app looking for functional defects (the kind called out in `docs/tasks.md` §8 as worth deliberately avoiding, e.g. RTL direction handling, i18n fallback gaps, navigation-target mismatches) before the next stabilization checkpoint. The SQLite cross-connection deadlock above was one concrete find from this sweep.
- Several phase branches (`phase1/users-roles`, `phase4/inventory-ops`, `phase56/returns-landed-installments`, `phase9/accounting-depth`, `phase9/financial-statements`, `sweep/real-data-screens`) and Playwright e2e-stabilization worktrees remain open alongside already-merged work, reconciling incremental hardening and test coverage against what's landed on `main`.

**Deferred (by product decision, not by gap — see §1 "v1 Scope" and `docs/tasks.md` §1).**
- **HR & Payroll** (backlog Phase 13) — all 13 screens (employees, departments, job titles, attendance, holidays, contracts, leave requests/policies, leave accrual batches, payroll runs, advances, my-leave, shift settings). The payroll calculation-engine internals are flagged in `docs/tasks.md` as the single largest specification hole in the whole catalog and need a standalone design pass before implementation starts.
- **POS** (backlog Phase 14) — terminals, sessions/shifts, sales/refunds ledgers, discount approvals, restaurant mode (tables/kitchen/reservations/deliveries), loyalty, and the net-new POS selling screen (no reference implementation exists anywhere — needs its own design spike with a real cashier before being built).
- **Cloud/SaaS website edition** (backlog Phase 15) — Postgres dialect + dual-engine conformance suite, cloud JWT + Row-Level Security, `apps/server` as a real hosted multi-tenant server, SSE + Redis realtime fan-out, S3 storage, subscription→entitlements, tenant onboarding, API keys/webhooks/WhatsApp integration. The architecture (ports-first persistence, transport-agnostic Hono app layer) is deliberately built to make this additive later, not a rewrite — nothing here is started.

**Remaining hardening (before v1 can be called release-ready).**
- Finish the real-data sweep (above) and delete every dead `*-sample-data.ts` file once its last consumer is converted.
- Extend the SQLite concurrency fix with a regression test that exercises concurrent numbering-sequence allocation and LAN multi-till writers, so this class of cross-connection deadlock can't reappear silently.
- Stabilize e2e coverage — several `test/e2e-*` worktrees are mid-flight; consolidate into a green, deterministic Playwright suite (browser project) run on every change, per the CI plan in §2.7.
- Complete the bug-hunt sweep and fold findings into either immediate fixes or tracked backlog items, cross-checked against the known-defects list already called out in `docs/tasks.md` §8 (so known source-app bugs aren't silently reintroduced).
- Merge the outstanding phase branches into `main` (or confirm their content already landed via a later merge) so the branch list reflects actual `main` state, not stale in-flight work.
- Re-run the golden-ledger fixture suite and the permission/workflow/numbering invariant tests as a release gate once the above lands, per the testing strategy in §2.7.
- Decide and record the open product decisions in §6.3 that are still genuinely open (licensing mechanism finalization, installment late-fee rule, FIFO-in-v1, delivery notes, branch-scoped numbering) — none block current development but several block calling specific v1 issues "done" rather than "buildable."

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

---


## Reference parity — supersedes the earlier phasing for UI/feature scope

**Added 2026-08-26.** A three-round live audit of the reference product replaced the
prose catalog as the source of truth for what a screen must do. The requirements
register is `docs/reference-parity/audit/REQUIREMENTS.md` (~90 numbered
requirements, R1.1 … R12.2, each observed in a running screen); the ordered work
list is `docs/tasks.md` §1; the scenarios that verify it are
`docs/scenarios/10-reference-parity.md`.

Where this plan and the requirements register disagree about the scope of a screen,
**the register wins** — it was read from the running product, this plan was written
from prose.

Four things change the shape of the remaining work:

1. **List endpoints are a triple, not a single.** Rows, `…/counts` and `…/stats`.
   Chip counts and KPI money must be server-computed over the whole filtered set.
   This touches every list in the product and is P0 (R1.1).
2. **Settings is where behaviour is configured, not just recorded.** Ten policy tabs,
   each toggle changing what a document may do — credit-control mode, backorders,
   negative stock, require-PO-before-GRN, require-GRN-before-invoice, negative-cash
   block, tax-inclusive pricing, missing-exchange-rate policy (R11.1–R11.8).
3. **Account routing is a screen, not a constant.** Every posting's GL account is
   configured: tax, leave (IAS-19), contracting (retention, advances, late
   penalties), sales-discount contra, per-reason inventory adjustments, payroll
   earning and deduction components, per-item-type revenue/COGS/inventory (R6.1).
4. **ETA is five surfaces, not one queue** — readiness meter, general settings,
   credentials with test-connection, item mapping, unit mapping, submissions
   (R7.1–R7.6).

Scope explicitly unchanged: POS stays descoped, statutory payroll stays descoped and
visibly flagged, and Mezan keeps its own visual design. Functional completeness is
the target; visual fidelity is not.

---

## Operational depth beyond finance and HR — candidate scope

**Added 2026-08-27.** Measured against `packages/domain/src`, not against the catalog.
Full rationale, per-domain evidence and competitor context are in
`plan.md` §8.4.6 (CRM depth) and §8.4.7 (operational breadth);
this section records what that means for phasing. **Nothing here is committed scope** —
these are candidates that sit beyond parity, and each needs the same treatment every
other module got: a catalog or requirements entry before a line of code.

### Why this section exists

The v1 phasing above builds finance, HR and the documents that feed them, plus one
production module. Mid-market ERPs — Odoo, SAP Business One, ERPNext — run a second tier
of operational domains alongside manufacturing. Mezan has none of them, and two of the
gaps (subcontracting, quality on receipt) are ordinary practice for the light-manufacturing
and pharma buyers already named in the target segments.

### CRM — built, but without the substrate its reports need

Phase 7 delivered CRM as scoped: leads, conversion, opportunities over configurable stages,
a pipeline board, activities. Four gaps make every downstream CRM report impossible, and all
four are cheap to store now and impossible to reconstruct later:

| Gap | Change | Unblocks |
|---|---|---|
| No owner anywhere in CRM | `ownerId` on `Opportunity`, assignee on `Activity` | "My pipeline", my-tasks, rep leaderboard, commission linkage |
| Funnel breaks at the opportunity | `opportunityId` on sales quote, carried into the invoice on conversion | Win rate by value, pipeline-to-invoice conversion, open quotes on live deals |
| Stage moves erase their own history | Append-only stage transitions (from, to, at, by) | Deal velocity, time-in-stage, stalled-deal detection, forecast trend |
| No loss reasons | `LOSS_REASON_DEFINITIONS` (code + `labelAr`), required on a loss transition | Why-we-lose analysis, the first question a sales manager asks |

Two more are free from data already stored: a weighted forecast
(`expectedValue × probability` by stage/period/owner) and a next-action hygiene surface
(an opportunity with no pending activity is a deal nobody is working).

The same failure shape the ledger rules already name applies here: the screen looks
complete because the *current* state is right, while the fact tomorrow's report needs was
never recorded.

### Operational domains not in any phase

| Domain | Mezan today | Shape of the work |
|---|---|---|
| Production planning / MRP | `reorderLevel` + a stock-levels report; no `safetyStock`, no `leadTime`, no planning run | New domain, needs a planning engine |
| Routings and capacity | `work-station.ts` is a master record only — no operations, times, capacity or scheduling | New domain; also the honest fix for typed-in labor cost |
| Subcontracting (التصنيع لدى الغير) | Nothing | Extends the existing stock ledger + work order |
| Quality management | Nothing — no inspection, NCR or quarantine | Extends goods receipt and production receipt |
| Traceability depth | `batchNo` + expiry + FEFO; no genealogy, recall report or serial numbers | Mostly reporting over data already stored |
| Maintenance (CMMS/EAM) | `maintenance` is a GL account name and a voucher type; assets are a register, not equipment | New documents on the existing asset master |
| Warehouse execution (WMS) | Warehouses and physical counts; no bins, put-away, picking or waves | New domain below the warehouse |
| Delivery and dispatch | `field-sales/van-trip.ts` only; no delivery note, driver, POD or freight allocation | New document, extends field sales |
| Service and after-sales | Nothing — collides with the installment-retail segment already targeted | New domain |
| Project delivery | `projects/` is a header only — no WBS, timesheets, progress % or BOQ / مستخلصات / retention | Extends projects; the contracting gap already named |

### The sequencing rule for all of the above

Prefer the items that are **new fields on documents that already post correctly** over the
items that are **new domains with their own documents and GL consequences**. Subcontracting,
quality-on-receipt and batch genealogy attach to the existing stock ledger and cost engine.
MRP, WMS bins and service management do not.

### The scope decision this forces

**Light manufacturing or manufacturing?** Subcontracting, quality and genealogy make a
credible workshop system on the engine already built. Routings, capacity scheduling and MRP
are a different product — they need a planning engine that does not exist and they push
Mezan into deals where the buyer expects a partner-led implementation. That answer decides
whether items 22–24 in `plan.md` §8.5 are ever scheduled, and it belongs in
`docs/decisions.md` once taken.

---

# 8. Market position, competitors and gaps

> Merged 2026-08-27 from `plan.md` §8 (research pass 2026-08,
> public web sources) and the two earlier "for review" sections this plan used to carry.
> Pricing and ETA-compliance status change frequently — treat figures as directional and
> verify before quoting externally. Nothing in this chapter is committed scope.

## 8.0 Why this chapter exists

Mezan is an Arabic-first, RTL, **offline-first** Electron desktop ERP for the Egyptian market —
single-tenant SQLite storage, Ed25519-signed offline license files (module/feature entitlements,
seat counts, machine-fingerprint binding, 14-day grace period), LAN multi-till, with a cloud
edition planned as an additive layer later (see `docs/plan.md`, `README.md`). Its catalog-derived
v1 scope covers Sales, Purchases, Inventory, Accounting, Treasury, Installments, Manufacturing,
Projects, Fixed Assets, Field/Van Sales, CRM, and (deferred) HR/Payroll and POS.

This document surveys the competitive landscape Mezan sells into — Egyptian/MENA-native
accounting SaaS, global ERP platforms operating in Egypt, and SMB accounting tools — to find
where Mezan's architecture (offline-first, module-licensed, desktop-native) creates real,
defensible differentiation versus where it's simply late to a solved problem. It closes with a
prioritized list of new features to feed the `enhancements` backlog.

---

## 8.1 The reference product's own pricing and licensing

Inputs from a review of a competing Egyptian ERP's public marketing site, gathered to sanity-check our approach and surface possible catalog gaps. These are **discussion inputs for a "what do we actually need for v1" review, not decisions or committed scope** — each item needs a team call before it changes a plan or a backlog issue.

**Pricing & licensing model — validates our approach.** A competing Egyptian ERP sells a **Core** bundle (Accounting + Sales + Purchases + Inventory) plus **priced add-on modules**: POS (+500), Manufacturing (+500), HR & Payroll (+400), Installments & Cheques (+250), Multi-currency (+200), Fixed Assets (+200), Loyalty (+150), AI Assistant (+500) — all EGP/month. **Capacity axes** (seats, branches, warehouses, POS terminals) are priced separately, and curated **persona bundles** (Wholesale & Distribution / Retail & F&B / Manufacturing) sit on top of the à la carte modules. Commercial terms: two-month-free annual discount, 14-day trial.
→ This is a clean external validation of our module-entitlement design (§2.5, §6.3.1). Recommended action: fold the **4 capacity dimensions** (seats / branches / warehouses / POS terminals) into our licensing model, and consider offering **persona bundles** on top of raw per-module pricing.

**Deployment differentiator.** The reference product is cloud SaaS; **only its POS module is offline-capable** (with sync back to the cloud). Our **fully-offline desktop edition is a genuine differentiator**, not just feature parity — worth leaning on in positioning.


## 8.2 Competitor matrix

| Product | Origin / HQ | Segment | Arabic/RTL | Egypt ETA | Deployment | Pricing model | Manufacturing depth |
|---|---|---|---|---|---|---|---|
| **Daftra** | Egypt | SMB, 50+ verticals | Native | Deep, native (e-signature, hardware token) | Cloud SaaS; POS-hardware offline only on top tier | Tiered SaaS, EGP 489–1,960/mo | Real BOM/production orders |
| **Odoo** | Belgium (global OSS) | SMB–mid-market | Bolted-on, mature but rough edges | Official module (CE/EE), reliability questioned | Cloud/on-prem hybrid; not offline-first (POS caches only) | Free core + per-app Enterprise; EGP 125K–350K implementations | Full MRP module |
| **SAP Business One** | Germany (SAP) | Upper-SMB–mid-market | Historically hard localization, matured since 2021 MENA pack | Official, enterprise-grade (SAP DRC) | **True on-prem/offline option** — only global player with this | $95–250/user/mo cloud or $1,350–5,500/user perpetual + 18–20%/yr maintenance; $12K–120K implementation | Deep, enterprise-grade |
| **ERPNext (Frappe)** | India (OSS) | Price-sensitive SMB, technical teams | Weakest — open RTL bugs, incomplete translation | **No official module** — community/marketplace only | Self-hosted "can" run offline but not offline-by-design; cloud hosting common | Free software, compute-based hosting ($5–25/site/mo Frappe Cloud) or self-host | Present, less polished than Odoo |
| **Microsoft Dynamics 365 BC** | USA (Microsoft) | Mid-market | Add-on language packs, no official Egypt pack | No native BC module (F&O has it, BC doesn't) | Cloud-first SaaS; legacy on-prem SKU still offline-capable but de-emphasized | $80–110/user/mo (Essentials/Premium) + $8 team member; $15K–150K+ implementation | Premium tier only |
| **QuickBooks (Online/Desktop)** | USA (Intuit) | Micro–small business | **None** — no Arabic UI at all | None native — third-party connector only (avtax.net) | QBO pure cloud; Desktop being sunset globally | $38–275/mo (US list) | None |
| **Zoho (Books/Inventory/One)** | India | SMB, self-serve | Mature regional editions, RTL reasonable | Semi-native + marketplace connectors (QuiXcel, Wanas) — best of the global SaaS tier | Pure cloud, **zero offline option** | Zoho One $37/user/mo; Books $15–50/mo | Light inventory-level BOM only |
| **Qoyod** | Saudi Arabia | Saudi/GCC SME, accounting-first | Native | **Not available — Egypt listed "coming soon"** | Cloud SaaS only | SAR 138–380/mo tiered | Manufacturing-adjacent (raw materials, mfg orders) at top tier |
| **Wafeq** | Saudi/UAE (Gulf-focused) | Startups → multi-entity Gulf businesses | Native bilingual | In rollout — Egypt pages exist, ETA certification not confirmed complete | Cloud SaaS only | Free tier + SAR ~119/mo Starter → custom Enterprise; unlimited users per plan | None found |
| **Dafater** | Saudi Arabia (Egypt-registered entity) | Multi-tier by company size (Eirady/Power/Flowhub) | Native | **None found for Egypt** — ZATCA (Saudi) only | Cloud SaaS only | Not publicly published | Unclear — not documented |
| **SMACC** | Egypt (MNT-Halan) | SME, broadest install base claimed | Native bilingual | Deep, specific (UUID retrieval, QR/long-ID printing, bulk issuance) | Cloud SaaS only, no offline | Tiered SaaS, $125–185/mo (2–4 users) | Present at Enterprise tier |
| **Qeemah** | Saudi Arabia | SME, KSA-first | Native bilingual | **Unverified/unlikely** — all messaging is ZATCA-specific | Cloud SaaS only | SAR 199/mo+ (opaque beyond entry tier) | Claimed (unconfirmed depth) |
| **AccFlex** | Egypt | SMB–mid-market, vertical-specific (construction, F&B, real estate) | Native, long-established | Confirmed ETA-approved | Ambiguous/legacy hybrid, no confirmed offline-first client | Quote-based, unpublished | Precast-concrete vertical only |
| **Mezan** | Egypt | SMB–mid-market trading, distribution, light manufacturing | Native, RTL-first by construction | Native ETA screen (VAT sub-type codes V001–V009, e-seal signing, submission queue) — in progress | **Offline-first desktop** (Electron/SQLite) + LAN multi-till; cloud edition additive/planned | **Per-module perpetual/offline license** (Ed25519-signed, seat + machine-bound) | Full v1 module: BOMs, 4-stage work orders, configurable products |

---

## 8.3 Per-competitor detail

### 8.3.1 Daftra

- **Positioning**: Egypt-born, comprehensive cloud ERP for SMEs across 50+ verticals; markets
  itself as the lowest-priced full-featured regional SaaS suite.
- **Target segment**: SMBs, both B2B and B2C, strong retail/POS and services focus.
- **Arabic/RTL + ETA fit**: Native bilingual product built in Egypt. Deepest Egypt ETA integration
  of any SaaS competitor surveyed — e-signature/digital stamp, automatic VAT calculation,
  documented Client ID/secret-key ETA-portal setup, hardware token support. Also covers KSA
  (ZATCA) and Jordan e-invoicing.
- **Deployment**: Cloud SaaS + mobile app. "Offline POS Terminals" exists only on the Premium
  tier for in-store hardware POS — not a true offline-first back office/accounting system.
- **Pricing**: Basic 489.50 EGP/mo, Advanced 977.58 EGP/mo, Premium 1,960 EGP/mo (annual billing
  ~30% cheaper); tiered invoice/client caps, warehouse limits (1/3/5); extra user ~392 EGP/mo,
  extra branch ~1,293.6 EGP/mo.
- **Module coverage**: Accounting (cost centers gated to Advanced+), Sales/POS, Inventory, real
  Manufacturing (BOM, production/manufacturing orders, routing, scrap tracking), HR/Payroll/
  Attendance, basic CRM, Rental management, booking/work orders.
- **Strengths**: Native Arabic + Egypt-born; deepest ETA compliance surveyed; genuine
  manufacturing/BOM module; broad module breadth; low entry price.
- **Weaknesses**: Offline is POS-hardware-only, not architectural; pure recurring SaaS pricing —
  no perpetual/offline license; cost-center accounting gated behind a paid tier; cloud-only
  creates a connectivity dependency Egyptian retail/trading businesses in low-connectivity areas
  actively want to avoid.

### 8.3.2 Odoo

- **Positioning**: Open-source, modular "suite of business apps" — pay only for the apps used.
- **Target segment**: SMB to mid-market, with Enterprise edition scaling further up.
- **Arabic/RTL + ETA fit**: RTL ships via `rtlcss`, mature but community-reported as inconsistent
  across dashboards/reports; extra modules often needed to fully fix layout/translation gaps. An
  official Egyptian E-Invoice localization module exists since Odoo 15.0 (documented at
  odoo.com/documentation), but paid third-party alternatives (e.g., ECOSIRE, $349 one-time +
  $499 GCC dependency) exist — a signal the official module needs supplementing in practice.
- **Deployment**: Cloud/on-prem hybrid, but connectivity-first by design. POS has a limited
  offline cache (view/reopen previously loaded records), not full offline write/sync. On-prem
  installs still typically need internet for integrations/support.
- **Pricing**: Core Community is free; Enterprise is per-user/per-app subscription. Egypt partner
  implementations run roughly EGP 125,000–350,000 depending on scope.
- **Module coverage**: Very broad — Sales, Purchase, Inventory, Accounting, MRP, POS, CRM,
  Project, HR — solid SMB depth, not enterprise-grade in accounting/manufacturing rigor.
- **Strengths**: Huge module breadth at low entry cost; large Egypt/MENA partner ecosystem;
  official ETA module exists; fast to deploy; strong community.
- **Weaknesses**: Not offline-first by design; RTL/Arabic has rough edges requiring extra
  modules; official ETA module reliability questioned; customization-heavy projects can balloon
  in cost and create ongoing partner dependency.

### 8.3.3 SAP Business One

- **Positioning**: Enterprise-grade ERP purpose-built for SMEs, backed by SAP's global brand and
  structured implementation methodology.
- **Target segment**: Upper-SMB to mid-market — most expensive/formal option surveyed.
- **Arabic/RTL + ETA fit**: Historically the hardest localization for SAP to build (ran a
  dedicated "Arabisation" program); a specific MENA localization pack only arrived in 2021 —
  before that, resellers used the UK localization as a workaround. Egypt ETA compliance is
  official and enterprise-grade via SAP Document and Reporting Compliance (SAP DRC, XML
  submission via eDocument Cockpit), plus certified partner connectors (BSC Global, OrchidaTax).
- **Deployment**: The only competitor surveyed offering **true on-premise deployment that
  eliminates internet dependency entirely** as a first-class, documented option (vs. cloud
  requiring stable connectivity).
- **Pricing**: Cloud $95–250/user/mo (sources vary, some cite $110–219); on-prem perpetual
  license $1,350–5,500/user + 18–20%/yr maintenance. Implementation typically $30K–120K; one
  Egypt-based partner quoted a minimum of $12,000+VAT for non-manufacturing standard scope.
- **Module coverage**: Deepest and most mature surveyed — full financials, manufacturing (MRP),
  inventory, CRM, service, project management, strong SAP HANA reporting.
- **Strengths**: Only true offline/on-prem option among global players; official, robust ETA
  compliance; deep enterprise-grade module maturity; global brand trust; structured local
  partner ecosystem.
- **Weaknesses**: Significantly higher TCO — out of reach for small Egyptian traders/retailers;
  RTL/Arabic support arrived late, implying residual UX rough edges; mandates ongoing
  consultant/partner relationship, not self-serve; heavier implementation timeline unsuited to a
  small shop wanting to go live fast.

### 8.3.4 ERPNext (Frappe)

- **Positioning**: Open-source, 100%-self-hostable ERP with compute-based pricing instead of
  per-seat licensing.
- **Target segment**: Price-sensitive SMB and technically capable teams willing to self-host;
  Frappe Cloud lowers the bar somewhat.
- **Arabic/RTL + ETA fit**: Weakest RTL support surveyed — active, unresolved GitHub issues on
  RTL layout breaking, text boxes defaulting to LTR under Arabic locale, an incomplete ~20,000-
  line community translation effort. **No official Egypt ETA module** — only community/
  marketplace third-party apps requiring a certified-partner HSM and an always-online Windows/
  .NET machine; the feature request for official support is still open.
- **Deployment**: Self-hosted install can in principle run without internet after setup, but
  Docker/cloud deployments commonly hard-fail on connectivity checks; true offline operation has
  required custom engineering (e.g., WSL-based local instances syncing daily backups from cloud)
  — not offline-by-design.
- **Pricing**: No per-user licensing. Frappe Cloud $5–25/site/mo; dedicated servers from
  $200/mo; self-hosted is free software but needs ongoing DevOps investment.
- **Module coverage**: Broad (Accounting, Manufacturing, CRM, HR, Projects, Assets, POS) but
  generally less polished per-module than Odoo, especially manufacturing/POS.
- **Strengths**: Zero licensing cost; no per-user fee scales cheaply with headcount; fully open
  source, no vendor lock-in; growing Frappe partner presence in Egypt.
- **Weaknesses**: No official ETA compliance module — real compliance risk on fragile community
  code; open, unresolved RTL/Arabic bugs; offline operation not native; low sticker price hides
  real TCO in DevOps effort — poor fit for a non-technical Egyptian retailer wanting to install
  and use.

### 8.3.5 Microsoft Dynamics 365 Business Central

- **Positioning**: Mid-market cloud ERP unifying finance, sales, service, and operations —
  Microsoft's step-up tier above QuickBooks-class tools.
- **Target segment**: Mid-market (~10–250 employees), priced above SMB tools.
- **Arabic/RTL + ETA fit**: Arabic is not a standard shipped language — bolted on via third-party
  language packs/extensions; UAE gets built-in bilingual localization, Egypt does not. No native
  Egypt ETA localization inside Business Central itself (the ETA integration exists at the
  separate Dynamics 365 Finance & Operations layer, not confirmed for BC); marketplace shows
  only a UAE e-invoicing connector.
- **Deployment**: Primarily SaaS/cloud, requires internet for day-to-day operation. A legacy
  on-premises SKU exists and can run offline but lacks feature parity/latest updates and is
  being de-emphasized by Microsoft.
- **Pricing** (US list, late 2025): Essentials $80/user/mo, Premium (adds manufacturing/service
  order mgmt) $110/user/mo, Team Member $8/user/mo, Device license $45/device/mo. No published
  Egypt-specific pricing; sold through local/regional partners. Implementation typically
  $15K–150K+.
- **Module coverage**: Deep finance/GL, sales, purchasing, inventory/warehousing, project
  management, service; manufacturing only in Premium tier; CRM via separate Dynamics 365 Sales;
  HR thin, usually needs a third-party app.
- **Strengths**: Deep, mature finance core; strong Power Platform/Office 365 integration; large
  partner ecosystem; scalable to true mid-market complexity.
- **Weaknesses**: Arabic is add-on quality, inconsistent across partners; Egypt ETA compliance
  not out-of-box for BC; fundamentally cloud-dependent for the mainstream SKU; per-user pricing
  and implementation cost are far beyond typical Egyptian SMB budgets.

### 8.3.6 QuickBooks (Online / Desktop)

- **Positioning**: "Smart tools for smart business owners" — small-business bookkeeping
  simplicity.
- **Target segment**: Micro to small business; not designed for complex multi-entity/
  manufacturing needs.
- **Arabic/RTL + ETA fit**: **No native Arabic UI at all**, confirmed unavailable by Intuit —
  the only hard Arabic blocker among the global players surveyed. Egypt ETA handled only via a
  third-party connector (avtax.net "ETA Connector") syncing invoices to the tax authority with
  validation and digital signature.
- **Deployment**: QuickBooks Online is pure cloud SaaS, requires internet. QuickBooks Desktop
  still exists but Intuit stopped selling new Desktop subscriptions to new US customers after
  Sept 2024 (Enterprise tier still sold) — a clear global signal the desktop/offline line is
  being sunset, even though Egyptian resellers may still sell it.
- **Pricing** (US list, 2026): Simple Start $38/mo, Essentials $75/mo, Plus $140/mo, Advanced
  $275/mo. No Egypt-specific pricing found; likely sold via local resellers.
- **Module coverage**: Core accounting/bookkeeping, invoicing, expenses, basic inventory (Plus
  tier), simple project tracking. No manufacturing, no real CRM, no native POS, no multi-till/
  multi-location depth.
- **Strengths**: Extremely simple onboarding; large ecosystem of bookkeepers familiar with it;
  low entry cost; broad third-party app marketplace.
- **Weaknesses**: No Arabic/RTL at all; ETA compliance entirely bolted-on; zero offline
  capability for QBO; Desktop line being sunset globally; shallow on inventory/manufacturing/
  multi-entity — not built for Mezan's module breadth.

### 8.3.7 Zoho (Books / Inventory / Zoho One)

- **Positioning**: "Operating System for Business" — broad, affordable, integrated SMB suite of
  40+ apps.
- **Target segment**: SMB, strong self-serve/price-sensitive segment, scaling into lower-mid-
  market via the Zoho One bundle.
- **Arabic/RTL + ETA fit**: Region-specific editions (e.g., zoho.com/sa) with reasonably mature
  Arabic/RTL support, actively marketed to Egypt/Gulf by local partners. Zoho Books ships
  pre-configured for Egypt with local tax rates/currency and an official e-invoicing help page,
  plus dedicated marketplace extensions (QuiXcel, Wanas Apps) offering RSA-token digital
  signatures and real-time ETA sync — the most Egypt-ready global SaaS option surveyed.
- **Deployment**: Pure cloud SaaS across Books/Inventory/One — **no offline or on-premises
  option at all**.
- **Pricing**: Zoho Books $15–50/mo (SMB sweet spot; UAE Professional ≈ AED 110/mo annual); Zoho
  One (full bundle: CRM, Inventory, Books, Projects, Desk, etc.) $37/user/mo.
- **Module coverage**: Broadest of the global SaaS players — Books, Inventory (multi-warehouse,
  transfer orders, light BOM), CRM (strong, dedicated product), Projects, a separate POS
  product, Desk. No dedicated fixed-assets or installments module found; manufacturing is
  inventory-level only, not shop-floor/costing depth. HR via Zoho People in Zoho One.
- **Strengths**: Best-in-class SMB pricing/value; broadest app suite under one vendor; most
  mature Egypt ETA ecosystem among global SaaS players; reasonable Arabic/RTL; fast self-serve
  onboarding.
- **Weaknesses**: 100% cloud-dependent, zero offline capability — a hard disqualifier for
  connectivity-unreliable shops; shallow manufacturing/cost-center depth; no native fixed-assets
  or installment-sales; per-app product sprawl can fragment data/workflow.

### 8.3.8 Qoyod

- **Positioning**: Saudi-first, ZATCA-compliant accounting SaaS for SMEs — accounting-centered
  rather than full ERP (self-acknowledged).
- **Target segment**: Saudi/GCC SMEs, with manufacturing/factories named as a vertical but the
  vendor itself points customers needing deep ERP elsewhere.
- **Arabic/RTL + ETA fit**: Native Arabic (Saudi product). **Egypt not supported — listed as
  "coming soon"**; currently live only in Saudi Arabia and Jordan.
- **Deployment**: Cloud SaaS only; only the separate POS product mentions any offline mode.
- **Pricing** (SAR, tax incl.): Basic 138/mo, Pro 207/mo, Advanced 379.50/mo, tiered by
  users/locations; add-ons for extra user, extra location, payroll, POS.
- **Module coverage**: Accounting/GL, invoicing, ZATCA e-invoicing (Phase 1 on Basic, Phase 2 on
  Pro+), inventory (richer at Advanced with raw materials/manufacturing orders), fixed assets &
  depreciation (Advanced), dimensions/budgets (Advanced), POS/HR as paid add-ons. No standalone
  CRM.
- **Strengths**: Clean ZATCA compliance depth; accounting dimensions/cost-center features at top
  tier; transparent published pricing; fixed assets/depreciation built in.
- **Weaknesses**: No Egypt/ETA support at all today; not a full ERP; no offline capability; no
  flexible/offline licensing model; no CRM.

### 8.3.9 Wafeq

- **Positioning**: Multi-language, multi-entity/multi-currency accounting system built for Gulf
  expansion — "keep track of debits and credits, manage inventory, payroll, and more."
- **Target segment**: Startups through larger multi-branch/multi-entity businesses.
- **Arabic/RTL + ETA fit**: Native bilingual English/Arabic. Actively expanding into Egypt with
  dedicated Egypt pages covering e-invoice/e-receipt compliance, but sources indicate Wafeq is
  still in the process of seeking formal ETA approval — Egypt support exists in product/
  marketing, formal certification not confirmed complete.
- **Deployment**: Cloud SaaS only, no offline capability found anywhere.
- **Pricing**: Free Basic tier; Starter ~SAR 119/mo (sources conflict on exact figure); Plus/
  Premium scale with quotes/PO/payroll; custom Enterprise pricing. Reportedly unlimited users on
  all paid plans.
- **Module coverage**: Invoicing, quotes, purchase orders, bank reconciliation, 40+ financial
  reports, payroll, expense claims, fixed assets, automated VAT/ZATCA/FTA returns, AI receipt/
  invoice scanning ("Inbox"), multi-branch/cost-center/project revenue analysis. No manufacturing
  module, no POS module.
- **Strengths**: Strong multi-country/multi-entity/multi-currency design; unlimited users even
  on paid tiers; automated VAT filing; polished expense-capture automation.
- **Weaknesses**: No manufacturing, no POS; no offline capability; Egypt ETA compliance appears
  still mid-rollout rather than proven live; pure SaaS licensing only.

### 8.3.10 Dafater

- **Positioning**: "منصة الإدارة المتكاملة دفاتر" — integrated cloud management platform, Saudi-
  headquartered with an Egypt-registered entity ("Dafater Electronic Services"). **Distinct
  product from Daftra** — do not conflate the two.
- **Target segment**: Multi-tier product family (Eirady for small business, Power for mid/large
  service & commercial, Flowhub for multi-department institutions), plus public/private sector.
- **Arabic/RTL + ETA fit**: Fully native Arabic, RTL throughout. **No evidence of Egypt ETA
  support** despite the Egypt-registered entity — e-invoicing support confirmed only for Saudi
  ZATCA ("Fatora" platform, approved 2022). Marketing/product focus is Saudi/Gulf-centric.
- **Deployment**: Cloud SaaS only (standard or "Managed Cloud SaaS" for Flowhub); no offline
  capability found.
- **Pricing**: Not publicly published; per-user/per-unit subscription mentioned for the Power
  tier without figures; a 5-day free trial is referenced.
- **Module coverage**: Financial/accounting, inventory, POS, HR/employee management, project
  tracking, Saudi VAT/Zakat compliance, e-invoicing (Fatora/ZATCA).
- **Strengths**: Native Arabic-first design; multi-product tiering matched to company size;
  established certified ZATCA e-invoicing provider since 2022.
- **Weaknesses / verification gaps**: No Egypt ETA integration evidence; no public pricing; no
  offline capability; thin English documentation makes deep verification difficult; functionally
  closer to a Saudi ZATCA-compliance ERP than a genuine Egypt-market competitor — flagged here
  as a weak/unconfirmed rival rather than a real Egypt threat.

### 8.3.11 SMACC, Qeemah, AccFlex, and other Egypt-niche players

**SMACC (smacc.com, part of the MNT-Halan ecosystem)**
- **Positioning**: Markets itself directly as "best accounting software in Egypt" — cloud
  ERP/accounting for SMEs, with a regional engine also covering ZATCA (KSA) and FTA (UAE).
- **Target segment**: SMEs; claims a large installed base (99,000+ clients, 715,000+ users
  across MENA) — the broadest scale claim of any Egypt-native competitor surveyed.
- **Arabic/RTL + ETA fit**: Bilingual UI. The deepest, most explicit Egypt ETA integration found
  in this survey — submits invoices for ETA approval, retrieves UUID, prints long-ID/QR code,
  supports tax invoices, simplified tax invoices, credit/debit notes, and bulk issuance, wired
  directly into accounting/inventory/POS flows.
- **Deployment**: Cloud-only — browser plus iOS/Android apps. No offline capability found
  anywhere, explicitly absent from its own e-invoicing documentation.
- **Pricing** (USD/month, shown in EGP among 30+ currencies): Basic $125 (1 of 4 modules —
  Accounting/Inventory/Fixed Assets/HR, 2 users) → Advanced $159 (2 of 6 modules incl. POS/
  Manufacturing, 3 users) → Enterprise $185 (all 7 modules incl. Projects, 4 users). Yearly
  discount ~10%, 2-year ~25%.
- **Module coverage**: Accounting, Inventory, Fixed Assets, HR/Payroll, POS, Manufacturing,
  Projects — full spread but gated by tier/module count, not available at entry price.
- **Strengths**: Deepest Egypt ETA integration surveyed; full module breadth at Enterprise tier;
  large installed base/credibility (MNT-Halan backing); mobile apps; multi-currency/multi-branch
  on one database.
- **Weaknesses**: Cloud-only — no offline or desktop mode, a direct architectural gap versus
  Mezan; per-tier module gating feels like feature-limited SaaS rather than flexible licensing;
  user counts stay low even at top tier (4 users for $185/mo — expensive to scale headcount); no
  CRM found; no evidence of deep cost-center accounting.

**Qeemah (qeemahcloud.com)**
- **Positioning**: "Regional-first" cloud accounting/ERP for KSA and wider MENA, targeting
  finance teams moving off spreadsheets.
- **Target segment**: Small/mid-sized businesses, primarily Saudi.
- **Arabic/RTL + ETA fit**: Native, parallel AR/EN sites. **Egypt ETA support is unverified and
  unlikely** — all compliance messaging found is ZATCA (Saudi) Phase 2-specific; treat as a
  KSA-first product with no confirmed Egypt play.
- **Deployment**: Cloud SaaS only, browser-based; no on-prem/offline mentioned anywhere.
- **Pricing**: Starts at SAR 199/month (one source cites unlimited users at entry); broader plans
  are "custom pricing after a scoping call" — no fixed public list beyond entry tier.
- **Module coverage**: Accounting, inventory/warehouse, HR/payroll, manufacturing (BOM/
  production planning claimed but unconfirmed depth). No POS or CRM evidenced.
- **Strengths**: Strong bilingual UX; ZATCA Phase 2 depth; modern cloud UI.
- **Weaknesses**: Egypt/ETA support unproven; cloud-only; pricing opacity beyond entry tier;
  unclear cost-center/multi-branch depth; smaller Egypt footprint than SMACC.

**AccFlex (accflex.com)**
- **Positioning**: Long-standing Egyptian ERP/accounting vendor with vertical modules for
  restaurants, construction/precast concrete, real estate marketing, and internet cafes.
- **Target segment**: SMB to mid-market, notably vertical-specific — broader industry spread
  than Qeemah or SMACC.
- **Arabic/RTL + ETA fit**: Native, long-established Arabic-market product. Confirmed
  ETA-approved for handling electronic invoices.
- **Deployment**: Ambiguous/hybrid — a "deskcloud.accflex.com" portal suggests a legacy
  desktop-to-cloud transition typical of older Egyptian ERP vendors; a pure offline desktop
  client or true offline-first architecture could not be confirmed from available material (site
  content was largely thin/inaccessible).
- **Pricing**: Not published — quote-based only.
- **Module coverage**: 10 integrated modules — general accounting, inventory/store management,
  treasury & banking, HR, plus vertical add-ons (construction, manufacturing, precast concrete,
  real estate marketing, restaurants).
- **Strengths**: Broadest vertical-industry coverage found among any competitor surveyed
  (construction, real estate, F&B); ETA-approved; treasury/banking module explicitly named
  (rarer in this competitor set); long regional track record.
- **Weaknesses**: No public pricing, worse opacity than SMACC; deployment model unclear and
  likely legacy hybrid rather than modern offline-first; thin/inconsistent documentation lowers
  confidence in feature claims (vendor-asserted, not independently verified); no confirmed
  manufacturing depth beyond the precast-concrete vertical; no CRM evidenced.

**Other names checked, not included**: Matiyas (matiyas.com) is an India-headquartered
ERPNext-implementation consultancy with an Egypt localization landing page (ETA API integration,
Fawry/Paymob payment-gateway ties) rather than a genuinely Egypt-native product — excluded as not
distinctly notable. Searches for "Raseed," "Bee Order," "Elmnhg," and "Fatoorah" as named
Egyptian ERP products returned no credible, verifiable matches — skipped rather than padded with
unverified names.

---

## 8.4 Market gaps and opportunities — the gap analysis

Reading across all twelve competitors, five structural gaps recur — each one a place Mezan's
architecture can win on merit rather than on marketing:

### 8.4.1 Nobody is genuinely offline-first except SAP B1 (and it prices itself out of reach)

Every Egypt-native SaaS competitor (Daftra, SMACC, Qoyod, Wafeq, Qeemah, Dafater) is cloud-only,
with "offline" at best meaning a POS terminal that can cache a sale locally (Daftra, top tier
only) — never a full offline back office with accounting, inventory, and reporting. Every global
platform is connectivity-first by default; only SAP Business One offers genuine on-prem/offline
operation, at $1,350–5,500/user plus 18–20%/year maintenance and $12K–120K implementation — three
orders of magnitude above what an Egyptian trading SMB or retail chain will pay. ERPNext and Odoo
can be forced offline with custom engineering, but neither ships it as a supported mode.

**Opportunity**: Mezan is the only surveyed product built offline-first from the domain core
outward (SQLite WAL, in-process IPC instead of sockets, OS-keychain-sealed local sessions) at an
SMB price point. This is a defensible, hard-to-copy architectural moat — a cloud-first SaaS
vendor cannot retrofit this without a rewrite, exactly the reasoning `README.md` already encodes
in "Path A" (cloud is additive to the desktop core, not the other way around).

### 8.4.2 Egypt connectivity reality is underserved

Outside Cairo/Alexandria/major hubs, Egyptian retail and light-industrial businesses routinely
deal with unreliable or expensive connectivity, and a cloud SaaS outage or ISP drop means the
till stops ringing. None of the competitors surveyed message directly to this pain point as a
primary sales argument — they treat offline as a POS edge case, not a business continuity
requirement. This is a market message Mezan can own outright given its architecture already
solves it end-to-end (not just at the till).

### 8.4.3 Licensing model mismatch: perpetual/module vs. recurring-forever SaaS

Every competitor surveyed — Egypt-native and global alike — sells recurring subscriptions (often
gated by user count, branch count, or module tier at increasingly expensive brackets: e.g.,
SMACC's Enterprise tier caps at 4 users for $185/mo). For a small trading business, this is a
permanent, compounding cost with no ownership. Mezan's Ed25519-signed offline license
(module/feature entitlements, seat counts, machine-fingerprint binding, 14-day grace period) is
structurally different — it supports a perpetual or term-license commercial model that Egyptian
SMB owners culturally prefer (buy the software, not rent it forever) and that none of the
surveyed competitors can match without changing their entire business model.

### 8.4.4 Manufacturing + treasury + installments depth is rare and fragmented

Real BOM/production-order manufacturing exists in only three competitors surveyed (Daftra,
SMACC-Enterprise, and claimed-but-thin at Qoyod/Qeemah); nobody surveyed has Mezan's specific
combination of a 4-stage work-order execution model, versioned BOMs with waste%, and a unified
10-type treasury voucher plus 7-state cheque register plus installment plans with overdue-batch
follow-ups in one product. Businesses needing this today stitch together an accounting SaaS plus
a separate manufacturing tool plus manual treasury tracking, or pay SAP B1/Dynamics BC enterprise
prices for depth they don't otherwise need. Installment-based retail (a very common Egyptian SMB
sales motion — furniture, appliances, electronics) has essentially no first-class support in any
surveyed competitor except SMACC/Daftra-adjacent loyalty features; nobody has Mezan's dedicated
installment-plan + collection-follow-up module.

### 8.4.5 ETA e-invoicing maturity is inconsistent across the field — a bar Mezan can clear cleanly

Egypt ETA support ranges from genuinely deep (Daftra, SMACC, AccFlex, SAP B1) through
in-progress/unconfirmed (Wafeq) to entirely absent (Qoyod, Dafater, Qeemah, QuickBooks-native,
Dynamics BC-native). Mezan's catalog already specs a dedicated ETA screen (VAT sub-type
V001–V009 mapping at the tax level, e-seal signing for production, encrypted client
credentials, submission queue with per-document lifecycle) — matching or exceeding the
mid-tier of the field. The gap to close is less "build ETA support" and more "reach and
message the same maturity level as Daftra/SMACC," since those are the two most credible
Egypt-native rivals a prospect will actually compare Mezan against.

### 8.4.6 Where Mezan is currently behind and should not pretend otherwise

- **CRM depth**: Zoho and Odoo have dedicated, mature CRM products; Wafeq, Qoyod, Dafater have
  none. Mezan's CRM has since been **built** — leads (6 states), lead→customer/opportunity
  conversion, opportunities over configurable pipeline stages with probability and expected
  value, a pipeline board, and activities (call/meeting/todo/email) — all gated and reachable.
  What is missing is depth rather than presence. Measured against `packages/domain/src/crm/`
  on 2026-08-27:

  | Gap | Evidence | Why it matters |
  |---|---|---|
  | **Nothing in CRM has an owner** | `Opportunity` carries `customerId`, `branchId`, `stageId` — no `ownerId`; `Activity` has no assignee. Meanwhile `contracts/src/sales-invoice.ts` carries `salespersonId` and `reports/sales-by-salesperson.ts` reports on it | The funnel has a rep at the bottom and nobody at the top. No "my pipeline", no "my tasks", no leaderboard, no link from a closed deal to the person who worked it. Every other CRM item depends on this |
  | **The funnel breaks at the opportunity** | No `opportunityId` on a sales quote or invoice; only `convert-lead.ts` links lead→opportunity | A won deal never points at the quote that won it or the revenue it produced. Win rate by value, pipeline-to-invoice conversion and open-quotes-on-live-deals are all unanswerable |
  | **A stage move erases its own history** | `move-opportunity-stage.ts` overwrites `stageId` and returns the new object; nothing records the transition | Kills time-in-stage, deal velocity, stalled-deal detection and forecast trend. Same shape as the ledger rule this repo already enforces: a report that needs a fact the store never recorded |
  | **No loss reasons** | `LeadStatus` has `lost`/`unqualified`, `Opportunity.status` has `lost`; neither carries a reason code | "Why are we losing?" is the first question a sales manager asks and the cheapest to answer |
  | **Activities do not survive conversion** | `Activity` links to `relatedLeadId` and `relatedOpportunityId` — never to a customer | Call and meeting history disappears from the customer view the moment a lead converts. A customer 360 is what CRM depth means to an SMB |
  | **No contact persons** | A customer is one flat record (`domain/src/customers/customer.ts`) | A distribution deal involves a purchasing manager, an owner and an accountant, each with their own phone. The one item here needing a new entity rather than a field |

  Two further items are cheap because the data already exists: a **weighted forecast**
  (`expectedValue × probability` by stage/period/owner — both fields are stored, only the
  report is missing) and **next-action hygiene** (an opportunity with no pending activity is a
  deal nobody is working; `dueDate` and `pending` exist, the surface does not).
- **Mobile/field access**: SMACC ships iOS/Android apps; Daftra has a mobile app; Mezan is
  desktop-only by design (LAN multi-till substitutes for some of this at the till level, but not
  for a traveling sales rep needing a phone). Van/rep trips are scoped in Mezan's catalog
  (`01-sales.md` §"رحلات المندوبين") but a phone companion app is not.
  - Note: this is a real trade-off, not an oversight — a "desktop-only + LAN" design is exactly
    what makes true offline-first tenable; a mobile app reintroduces a sync/connectivity
    dependency that would need to be solved deliberately (see §4.6).
- **Cloud/multi-tenant maturity**: SMACC, Daftra, Zoho, Odoo Enterprise, Dynamics BC are
  cloud-native today; Mezan's cloud edition (Phase 15) is deferred by design. This is fine for a
  desktop-first go-to-market but means Mezan cannot yet compete for a prospect who explicitly
  wants zero local infrastructure.

### 8.4.7 Operational breadth beyond finance and HR is where mid-market ERPs actually live

Measured against `packages/domain/src` on 2026-08-27. Mezan's manufacturing is genuinely
respectable for its class — versioned BOMs with waste %, 4-stage work orders, material
issue/return/waste/receive, shop-floor entries stamped with station and operator, a
labor/overhead/other cost log, configurable products with formulas, and work stations as
master data. The gap is not manufacturing depth in isolation; it is the operational domains
Odoo, SAP Business One and ERPNext run *alongside* manufacturing, none of which Mezan has.

| Domain | What competitors ship | Mezan today |
|---|---|---|
| **Production planning / MRP** | Demand (open orders + forecast) netted against stock and open POs, respecting lead time and safety stock, emitting suggested work and purchase orders (Odoo MRP, SAP B1 MRP wizard, ERPNext production plan) | `reorderLevel` on the item plus an `inventory-stock-levels` report — a threshold, not planning. No `safetyStock`, no `leadTime`, no planning run |
| **Routings and capacity** | Operations with standard times, machine/shift capacity, finite scheduling, WIP by operation | `work-station.ts` is a master record only (code, name, status). A work order knows what materials but never how long or on which machine when |
| **Subcontracting (التصنيع لدى الغير)** | Send material out, receive a semi-finished good back, absorb the subcontractor's cost onto the order | Zero. Can only be faked as a stock issue plus an unrelated purchase invoice, and the cost never lands on the work order |
| **Quality management** | Inspection points on goods receipt and production receipt, quarantine location, pass/fail routing to return or rework, NCR | Zero — no inspection, no NCR, no quarantine |
| **Traceability depth** | Batch genealogy (which raw batches went into which finished batch), bidirectional recall report, serial numbers | `batchNo` and expiry exist and FEFO is on a branch. No genealogy, no recall report, no serial numbers |
| **Maintenance (CMMS/EAM)** | Preventive schedules on machines and vehicles, meter readings, work requests, spare-part consumption against equipment | `maintenance` appears only as a GL account name and a voucher type. Fixed assets are a register, not equipment |
| **Warehouse execution (WMS)** | Bin locations inside a warehouse, put-away rules, pick lists and waves, packing, ABC cycle counting | Warehouses and physical counts with variance and blind counting — "how much do I have", not "where in the building" |
| **Delivery and dispatch** | Shipments, delivery notes as their own document, drivers, proof of delivery, freight cost allocation | `field-sales/van-trip.ts` covers a rep's van route; ordinary order fulfillment has none of it |
| **Service and after-sales** | Service orders, warranty registration, installed base at the customer, repair orders, SLA | Zero — and it collides with a segment already targeted: installment retail is furniture, appliances and electronics, exactly the goods that come back for warranty service |
| **Project delivery** | WBS/tasks, timesheets, progress %, BOQ / progress certificates (مستخلصات) / retention billing | `projects/` is a header only — code, customer, manager, budget, dates, site address |

Also absent and lower priority for the current buyer set: rental/leasing (Daftra has it),
e-commerce channel sync, engineering change orders on top of the already-versioned BOM, and
demand forecasting / S&OP.

**The distinction that matters for sequencing** is not the feature count but which of these
are *new fields on documents that already post correctly* versus *new domains with their own
documents and GL consequences*. Batch genealogy, quality-on-receipt and subcontracting attach
to the existing stock ledger. MRP, WMS bins and service management are genuinely new domains.

**A costing argument for routings, separate from planning:** `WorkOrderCostLogEntry` takes
labor and overhead as amounts somebody types in — every one of them a number the caller
supplied, the exact shape this codebase's own rules warn about. Standard times × a station
rate would let the system compute what is currently asserted.


## 8.5 Recommended differentiating features

Prioritized by how directly each feature converts an architectural advantage (§3.1–3.3) into a
feature a prospect can see and compare against a specific competitor, or closes a real gap
(§3.6) before it costs a sale. "P0" = should lead the `enhancements` backlog; "P1" = strong
follow-on; "P2" = differentiator once the core is proven.

### P0 — Lead with the offline-first + licensing moat

1. **Cloud-fallback sync mode ("hybrid" license tier)** — an opt-in, still-offline-first mode
   where a desktop instance can push/pull a background sync to a lightweight relay when
   connectivity is present, without ever requiring it. Directly neutralizes the "but I want a
   dashboard from my phone" objection that every cloud-only competitor (§3.1, §3.6) wins on
   today, while keeping the offline core intact — the opposite of Odoo/ERPNext's
   connectivity-first-with-a-bolted-on-offline-cache model.
2. **Multi-branch consolidated reporting over disconnected desktop instances** — a
   periodic/manual export-import or sync mechanism that rolls up several independently-running
   branch desktop instances (each fully offline-capable) into one consolidated P&L/balance
   sheet/inventory view, without requiring a live multi-tenant cloud backend. No cloud-only
   competitor can offer this as a "buy once per branch, still see one number" story; it is
   uniquely enabled by Mezan's single-tenant-per-install architecture.
3. **Perpetual + subscription hybrid pricing packaging with a public price sheet** — publish a
   transparent module-by-module perpetual-license price list (mirroring Daftra's and SMACC's
   transparent tiered pricing pages, which build buyer trust) so "own it, don't rent it" is a
   marketable claim, not just an architectural fact. Not a code feature, but should be tracked in
   the same backlog since it depends on the licensing/entitlements engine already built.
4. **License self-service portal (offline-license reissue/transfer flow)** — a lightweight
   web/desktop flow letting a customer re-host a license to new hardware, add seats, or add a
   module without support intervention, addressing the one real friction point of perpetual
   offline licensing versus "log in from anywhere" SaaS.

### P1 — Close specific competitive gaps before they cost a sale

5. **Installment-sales module polish + collection-risk scoring** — Mezan already scopes
   installment plans + overdue batch + follow-ups (`docs/tasks.md` Phase 7); this is a genuine
   whitespace versus nearly every competitor surveyed. Adding light collection-risk
   scoring/aging buckets on top would make it a headline feature for furniture/appliance/
   electronics retailers, a segment none of the twelve competitors targets explicitly.
6. **Manufacturing cost-drilldown parity with Daftra/SMACC-Enterprise** — ensure BOM +
   work-order costing rolls up cleanly into cost-center P&L (already scoped in Phase 8/11) and is
   demoable end-to-end; this is the module where Mezan can credibly claim to out-depth every
   Egypt-native SaaS rival except Daftra.
7. **ETA readiness dashboard + guided setup wizard** — the catalog's ETA screen already tracks a
   "readiness %" completion metric; turning that into a guided, checklist-driven onboarding flow
   (mirroring Daftra's documented step-by-step ETA setup) closes the perception gap against
   Daftra/SMACC, which currently look more "done" on ETA than an unconfigured Mezan demo does.
8. **Arabic-first accountant/bookkeeper collaboration mode** — a constrained, read-mostly or
   scoped-write remote role for an external accountant (many Egyptian SMBs outsource bookkeeping)
   to review/adjust books without needing a full seat or full LAN access — addresses a workflow
   every cloud SaaS competitor solves trivially (just log in) that a pure offline desktop app
   does not solve by default.
9. **Lightweight CRM pipeline view** — not a full CRM build-out (already scoped later in
   `docs/tasks.md` Phase 12), but pulling the existing Leads/Opportunities scope earlier or
   shipping a minimal pipeline board sooner narrows the gap to Zoho/Odoo for
   distribution-with-a-sales-team customers without committing to full CRM parity.

### P2 — Differentiators once the core v1 is proven

10. **Companion mobile app for field/van sales reps (sync-on-connect only)** — a phone app for
    the already-scoped Van/Rep Trips module that syncs opportunistically when connectivity
    appears, never requiring it — extending the offline-first philosophy to the one place
    (traveling reps) where a pure desktop app structurally can't reach, without compromising the
    core desktop product's zero-dependency design.
11. **Multi-till LAN mode as a marketed retail-chain feature, not just a technical capability** —
    Mezan already has LAN multi-till gated by license flag; packaging and marketing this
    explicitly against Daftra's Premium-only "offline POS terminals" tier turns an existing
    capability into a head-to-head competitive callout (works at every tier that includes it, no
    internet dependency at all, versus Daftra's internet-dependent-except-at-the-till model).
12. **Data portability / import tooling from named competitors** — guided import wizards
    specifically from Daftra, QuickBooks, and Excel-based bookkeeping (the three most common
    "what a prospect is currently using" answers in Egypt), lowering switching cost and directly
    targeting Mezan's most likely displacement targets.
13. **Vertical starter packs (retail, furniture/installment-heavy, light manufacturing,
    distribution)** — pre-configured chart of accounts, tax mappings, and item templates per
    vertical, competing with AccFlex's vertical-specific positioning (construction, F&B, real
    estate) without needing AccFlex's per-vertical module sprawl — Mezan's single coherent core
    can offer starter configuration instead of separate products.
14. **Offline-capable audit/compliance export bundle** — a one-click "everything ETA/tax auditor
    might need" export (journals, ETA submission log, tax reports) that works even if the machine
    has never been online that day, a scenario every cloud-only competitor cannot serve at all
    during an outage or in a low-connectivity branch.

### Added 2026-08-27 · P1 — CRM depth substrate

Ordered so each item unblocks the next; the first two are the substrate every CRM report needs.
Rationale and evidence in §3.6.

15. **Ownership on the pipeline** — `ownerId` on `Opportunity` and an assignee on `Activity`.
    Revenue already knows its salesperson; the pipeline knows nobody, so the leaderboard would
    report on invoices while the forecast reports on no one. Small change, and items 16–18 and
    the forecast/leaderboard reports all depend on it.
16. **Close the funnel** — carry `opportunityId` onto the sales quote and through conversion
    into the invoice, making quote→order→invoice traceable end to end (this is ENH-042's
    missing prerequisite).
17. **Record stage transitions** — append-only stage history (from, to, at, by) so deal
    velocity, time-in-stage and stalled-deal detection become reportable. Cheap to store now
    and impossible to reconstruct later.
18. **Loss reasons and customer-linked activities** — a `LOSS_REASON_DEFINITIONS` taxonomy
    following the existing `LEAD_STATUS_DEFINITIONS` pattern (code + `labelAr`), plus a
    customer link on activities so history survives conversion into a customer 360.

### Added 2026-08-27 · P2 — Operational breadth beyond finance and HR

Rationale and evidence in §3.7. Sequenced by fit with the current buyer set — wholesale /
distribution, retail, restaurant, light manufacturing, pharma — not by market size.

19. **Subcontracting (التصنيع لدى الغير)** — send material to a contractor, receive the
    semi-finished good, absorb the cost onto the work order. This is the Egyptian workshop
    reality (cutting, plating, printing, stitching) and nothing in the field models it well at
    SMB price points.
20. **Quality on receipt with a quarantine location** — an inspection status on goods receipt
    and production receipt, failures routed to return or rework. Small on top of the existing
    stock ledger, and it is the pharma/food gatekeeper question.
21. **Batch genealogy and the recall report** — raw batch → finished batch links walked in
    both directions. Mostly reporting over data already stored, and the claim that wins a
    pharma or food account.
22. **Routings with standard times** — operations, station rates, and computed labor cost;
    turns work orders into real costing and is the prerequisite for any capacity story.
23. **Maintenance-lite on the asset register** — preventive schedules, meter readings and work
    requests against machines and vehicles, reusing the fixed-assets register as the equipment
    master.
24. **Delivery and dispatch for distribution** — a delivery note as its own document, driver,
    proof of delivery and freight allocation, extending the van-trip model to ordinary order
    fulfillment.

**The scope question these raise, which needs a human answer:** do we sell *light
manufacturing* or *manufacturing*? Items 19–21 make a credible workshop system on the engine
already built. Items 22 and beyond — routings, capacity scheduling, MRP — are a different
product: they need a planning engine that does not exist, and they push Mezan into deals where
the buyer expects a partner-led implementation, which is where Odoo and SAP B1 live.

---

## 8.6 Catalog gaps to verify, and module boundaries

**Possible catalog gaps to verify.** Features the reference product markets that our catalog may cover thinly or not at all:

- BOQ / progress-certificate / retention billing for Contracting & Real-Estate — our Projects domain looked thin (see §6.3.7, Projects row in Phase 7).
- FEFO (first-expiry-first-out) for pharma.
- Cheque **endorsement / replacement** states (beyond the 7-state lifecycle already captured, §2.3, §4).
- Restaurant **own-fleet delivery tracking**.
- IAS-21 **FX gain/loss** depth in multi-currency.

→ Action: check each against docs/catalog before finalizing those modules' issues.

**Module-boundary notes.** The reference product markets **multi-currency** and **ETA e-invoicing** almost as standalone modules. → Consider treating **multi-currency as its own licensable module** in our entitlement model, rather than an always-on accounting feature.


## 8.7 Where Mezan differentiates — and the honesty caveat

1. A true offline-first Arabic **desktop** ERP — no competitor in this field offers it (Daftra's offline capability is POS-only).
2. Module-based licensing vs. Daftra's cap-based tiers.
3. Egypt/ETA-first positioning.

> **Honesty caveat.** Independent research shows the reference system's own compare page **overstates** Daftra's weaknesses — Daftra actually has manufacturing, cheques, installments, and offline-capable POS. Mezan's real edge is deployment model + execution quality, not "features they lack." Don't reuse the reference system's overstated competitive claims in our own materials.

---


## 8.8 Summary

Twelve competitors were surveyed: **Daftra, Odoo, SAP Business One, ERPNext, Microsoft Dynamics
365 Business Central, QuickBooks, Zoho, Qoyod, Wafeq, Qeemah, Dafater, SMACC**, plus one
additional notable Egyptian vendor surfaced during research, **AccFlex**. None combine
Mezan's specific architecture — Arabic-first RTL, genuinely offline-first desktop core, and
perpetual/module-based licensing — at an SMB-accessible price point. SAP Business One is the only
competitor with true offline capability, at enterprise pricing; every SaaS competitor (Egyptian-
native or global) is cloud-only with at best a POS-level offline cache. This is Mezan's clearest,
most defensible market gap, and the fourteen recommended features above are prioritized to make
that gap visible and comparable to a prospect evaluating Mezan against Daftra or SMACC — the two
most credible Egypt-native rivals — rather than against the field in the abstract.

---

# 9. Deferred roadmap — HR/Payroll, POS, Cloud/SaaS

> Scope: the three areas explicitly descoped at v1 kickoff (`docs/plan.md` §"v1 Scope"): **HR/Payroll**, **POS (including the net-new selling screen)**, and the **Cloud/SaaS website edition**. `docs/tasks.md` already reserves these as Phase 13/14/15 stubs (13/16/15 issues respectively); this document expands each into a dependency-ordered, issue-level plan and is the thing to work from once v1 (Phases 0–12, SQLite-only Electron desktop) ships. Nothing here invents scope beyond `docs/catalog/06-crm-hr.md`, `docs/catalog/05-pos-installments.md` and `docs/plan.md`'s architecture sections — deviations and open decisions are flagged inline, not silently resolved.

**Why these three, together, now:** all three were deferred by the same Path-A decision — build the SQLite-only desktop core first, but keep the domain core behind repository ports and the transport behind a Hono app so nothing here requires re-architecting anything already shipped. HR/Payroll and POS are pure domain-service additions on top of the finished GL/treasury/cost-center/sales-invoice/inventory engines. Cloud/SaaS is almost entirely *infrastructure* — a Postgres dialect, a real HTTP host, multi-tenant auth — sitting underneath the same `packages/api` Hono app and `packages/domain` core that already exist and already run over HTTP today (`apps/server` currently serves the shared app against SQLite as a Postgres stand-in — see Cloud §0).

**Sequencing between the three areas:** independent tracks, no cross-blocking. HR and POS both depend only on v1-core engines (GL, treasury, cost centers, sales-invoices, inventory, stock, permissions, numbering, workflow, event bus, print/report engine — note there is no notification *rules* engine yet, only the event bus, so any notification-driven scope below has to build it) — pick either first based on business priority. Cloud/SaaS can start in parallel with either, since its Phase 0 (Postgres dialect + conformance suite) only needs the schema-spec DSL that already exists; it does *not* need HR or POS domain code to exist first, though shipping it after both gives the conformance suite more domain surface to prove out.

## Legend

| Size | Meaning (same scale as `docs/tasks.md` §2) |
|---|---|
| **S** | < 1 day — CRUD screen, config toggle, single report, small fix |
| **M** | 2–4 days — a screen with real workflow/state machine, or a medium engine slice |
| **L** | ~1–2 weeks — a screen family or a substantial engine component |
| **XL** | 2+ weeks — phase-defining engine work; usually warrants its own sub-breakdown (Payroll's calc kernel and the POS selling screen both get one below) |

Each task row carries a **Reuse** column naming the actual existing package/module it builds on — verified against the current `packages/domain/src`, `packages/persistence/src`, `packages/api/src` and `apps/server` trees, not inferred from the architecture doc alone.

**Confirmed already in the repo and reusable by every task below:**
- `packages/domain/src/gl`, `journal.ts`, `post-journal-entry.ts` — the balanced-entry posting engine (Article-47/payroll/accrual/advance postings all route through this, not a new engine).
- `packages/domain/src/treasury-accounts`, `vouchers` — cash accounts, the 10-type voucher document, allocation/cash-application.
- `packages/domain/src/cost-centers`, `cost-center-pl` — for departmental/branch cost allocation.
- `packages/domain/src/sales-invoices`, `sales-returns` — the document engines the POS selling screen and refunds specialize, not reimplement.
- `packages/domain/src/permissions`, `numbering`, `workflow`, `events` (typed event bus/catalog), `entitlements`, `licensing`, `lan` (LAN multi-till session registry + feature flags), `reports/engine.ts` (`ReportDefinition` abstraction).
- `apps/server` — already mounts the shared `packages/api` Hono app over HTTP with SQLite standing in for Postgres (Path A proof point); Cloud's job is to swap the dialect and add real multi-tenancy underneath this, not stand up a server from zero.
- **Not yet built anywhere** (confirmed by search — flag honestly rather than claim false reuse): a `FileStore`/attachments port and implementation. HR (employee photos, contract attachments), POS (item images already exist via Items) and Cloud (S3 adapter) all need this; it does not exist today and is called out as new work where it first becomes a hard dependency (HR §1, Cloud §2).

---

## 9.1 Part 1 — HR/Payroll (27 tasks)

Ordered by the dependency chain the catalog itself implies: Employees is the hub record every other HR screen scopes against (`06-crm-hr.md`: "most other HR screens ... are really employee-scoped sub-resources"); Payroll is deliberately last because it consumes Contracts + Attendance + Advances and is the single largest unknown in the whole catalog (§0.6 below).

### HR-0 — Foundation & master data

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 1 | HR numbering: `EMP-####` employee-code sequence registered in the numbering engine | S | v1 numbering engine | `packages/domain/src/numbering` — add one more of the 25 sequence types, same atomic-counter mechanism already used for invoices/POs |
| 2 | HR permission set: register `hr.*` dot-notation perms (employees/contracts/attendance/leave/payroll/advances, `⚠ sensitive` on salary/personal-data reads) into the permission catalog + dependency graph | S | v1 permissions engine | `packages/domain/src/permissions` (data-driven manifest), `packages/api/src/permission-gate.ts`, `module-gate.ts` |
| 3 | Departments: CRUD, self-referencing parent hierarchy, manager picker | S | #2 | `packages/domain/src/users` (manager select), branches |
| 4 | Job Titles: dept-scoped CRUD (title disabled until department chosen) | S | #3 | same list/CRUD primitives as Departments |
| 5 | Shift Settings: named time-window templates, optional branch scope | S | branches | none new — same pattern as v1's branch-scoped master data |

### HR-1 — Employee & Contract core

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 6 | Employee domain model + repository: identity, employment info (worker category, overtime-eligibility inheritance chain dept→company, `priorServiceYears` for Article 47), address, emergency contact | L | HR-0 | branches (assignment), users (account-link for self-service, HR-3 #16) |
| 7 | Employee attachments/photo — **new**: minimal content-addressed `FileStore` port + desktop impl (mirrors the file-storage design already specified for Cloud, built once and shared) | M | #6 | none existing — first hard need for the FileStore port; build the port here so Cloud §2 only swaps the adapter |
| 8 | Employee create/edit full-page form (all sections incl. clock-in biometric/selfie switches, probation end date) | L | #6 | `<DocumentDetail>`/form primitives, `<EntityPicker>` (v1 design system) |
| 9 | Employee list + detail page (8 tabs, side-panel quick-view variant) + status machine (active/on-leave/suspended/terminated) + terminate action | L | #6, #8 | `<DocumentList>` primitive |
| 10 | Contracts domain model: type/pay-basis/frequency, currency (reuse the 11-currency list), leave-entitlement overrides, allowance/deduction line items | L | #6, Leave Policies (HR-3 #14 — can stub entitlement defaults until then) | multi-currency (`packages/domain` money/qty), same currency picker as Sales Customers |
| 11 | Contracts list + detail page (پay-terms tab, audit tab) + terminate-contract action | M | #10 | `<DocumentDetail>` tabs pattern |

### HR-2 — Attendance & Holidays

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 12 | Attendance domain model: daily status codes (P/A/H/L/HO/weekly-off), manual entry path (device/biometric ingestion is a stub hook, not built — no hardware integration evidenced in the catalog) | L | #6, #5 | none new |
| 13 | Attendance calendar-grid screen (month navigator, per-employee row × day-of-month columns) + monthly-summary dialog | L | #12 | **new component** — the one HR screen that isn't the standard list+filter+table pattern; nothing to reuse from v1's `<DocumentList>` |
| 14 | Official/Public Holidays: year-tabbed CRUD, recurring-vs-one-time flag | S | none | none new |

### HR-3 — Leave

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 15 | Leave Policies: type matrix (entitlement/accrual-frequency/carryover/termination-payout/legal-mandate flag) + two dated presets (Egypt Labour Law 12/2003, 14/2025) modeled as **versioned dated data**, never hardcoded | M | none | follows `plan.md` §6.2's explicit mitigation for "Egyptian regulatory change" risk — legal constants as data, not logic |
| 16 | Leave Requests: domain + workflow (half-day = 0.5-day calc, leave-type resolution from policy + contract override) | L | #10, #15 | `packages/domain/src/workflow` (26 action types) — **[decision]** confirm whether the 9 granular per-leave-type gates the task brief names are real distinct action types or one gate applied per leave-type instance; not directly evidenced in `06-crm-hr.md` itself, cross-check `09-settings-dashboard-ux.md`'s 26-type catalog before finalizing |
| 17 | Leave Requests screens: admin list + full-page new-request form | M | #16 | `<DocumentList>`, standard form primitives |
| 18 | My Leave (employee self-service, gated on account-linked-to-employee-record) | S | #9, #16 | same list/form components as #17, scoped to `me` |
| 19 | Leave Accrual Batches: manual ("run now") + scheduled runs, **posts a journal entry** and updates balances immediately | M | #16, GL | **`packages/domain/src/gl`, `journal.ts` directly** — this is a JE-posting consumer of the existing engine, not a new one; scheduler pattern per `plan.md` §3.5 (desktop in-process scheduler with catch-up semantics) |

### HR-4 — Advances

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 20 | Employee Advances domain: 4-state workflow (pending→approved→disbursed→repaid), explicitly a **balance-sheet asset/debt**, expensed only on write-off | M | #6, GL/accounts | **`packages/domain/src/gl`, `accounts`, `treasury-accounts`/`vouchers`** for the disbursement cash-out leg |
| 21 | Advances screens: list + request dialog + approve/disburse/repay row actions | S | #20 | same list/dialog primitives |

### HR-5 — Payroll engine (deliberately its own sub-phase — largest specification hole in the whole catalog)

The create-run dialog itself is two fields (year, month); everything else — the actual calculation — was never observed running against real data in the source (one seeded employee, no executed run). Per `docs/tasks.md` §7.4's finding, this needs a standalone design deliverable before it can be split into safely-sized build tickets; the breakdown below is the *shape* of that split, not a claim the internals are already known.

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 22 | **Payroll calc-engine design spike** — resolve the day-divisor basis (tenant setting observed as `payrollDayDivisorBasis: "FIXED_30"` with zero UI surface), the Article-47 seniority-bonus formula, the overtime multiplier, and how allowances/deductions/leave-entitlement contract overrides combine into gross pay. Output: a written calc spec, not code. | M | none (research/product decision) | **[decision]** — needs either a populated reference tenant with an executed payroll run, or a from-first-principles design against Egyptian payroll law; do not start #23 until this lands |
| 23 | Payroll calc kernel: base-salary proration (day-divisor), Article-47 seniority bonus, overtime multiplier, allowance/deduction application | XL | #22, #10 | `Money`/`Qty` scaled-int value objects + `decimal.js` rounding policy (v1 Phase 0) — same largest-remainder allocation discipline used for invoice discount/tax rounding |
| 24 | Payroll ↔ Attendance integration (pull absence/overtime hours into the calc kernel) | M | #23, #12 | none new |
| 25 | Payroll ↔ Advances integration (pull installment deductions into the calc kernel) | M | #23, #20 | none new |
| 26 | Payroll run lifecycle (draft→calculated→approved→disbursed, +cancelled) + GL posting + payslip generation/print | L | #23–#25, GL, print engine | **`packages/domain/src/gl`/`journal.ts`** for posting; **`packages/domain/src/reports/engine.ts`** (`ReportDefinition`)+ v1's print pipeline and Arabic amount-in-words for payslips — no new print mechanism |
| 27 | Payroll screens: run list, new-run dialog, run detail (recalc/approve/disburse actions); HR Dashboard (KPI tiles, 3 charts, leave-consumption table, alert chips) | L | #26 | `<DocumentList>`/`<DocumentDetail>`, Recharts (already wired for the main Dashboard) |

*(27 numbered tasks above — HR-0 through HR-5.)*

---

## 9.2 Part 2 — POS (26 tasks)

Highest design risk in the whole deferred scope: back-office parity (terminals/sessions/sales/refunds/discount-approvals/restaurant mode) is a straightforward build against v1 engines; the selling screen has **no reference implementation anywhere** — the source app's `/pos/sell` renders "نقطة البيع انتقلت إلى تطبيقات الجوال وسطح المكتب" (moved to mobile/desktop apps) and 404s the moment you try to reach it on web. It is broken out as its own sub-phase (POS-3) with a mandatory design spike ahead of any code, per `plan.md` §7.4.

### POS-0 — Foundation

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 1 | POS permission set: register the 38 POS permissions (largest single module in the catalog) into the catalog + dependency graph | S | v1 permissions engine | `packages/domain/src/permissions`, `packages/api/src/module-gate.ts` |
| 2 | Payment-method catalog: company-wide list, 2 non-deletable built-ins (Cash `CASH`, Card `CARD`), per-method account-type + default-account mapping | S | treasury-accounts | `packages/domain/src/treasury-accounts`, `accounts` |
| 3 | Terminals: CRUD (branch/warehouse/cash-drawer-account/enabled-payment-methods/thermal-printer-address) | M | #1, #2, branches/warehouses | branches, warehouses, treasury-accounts |

### POS-1 — Sessions/shifts & back-office ledgers

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 4 | Sessions/Shifts domain: open→running→close lifecycle, cash-drawer manual movements (float top-up/withdrawal/payout, distinct from customer cash sales), close-out variance calc | L | #3 | `packages/domain/src/treasury-accounts`/`vouchers` pattern for cash-movement entries |
| 5 | Session settlement UI: 6 sub-tabs (settlement, payment breakdown, AR/credit collections, cash movements, sales summary, salesperson breakdown) + close-shift dialog (expected vs. actual cash, closing notes) | L | #4 | `<DocumentDetail>` tabs pattern |
| 6 | POS Sales domain: immutable sale record created by the selling screen, GL + stock posting on confirm | M | #4, GL, Inventory | **specializes `packages/domain/src/sales-invoices` directly** — a POS sale is a constrained sales-invoice confirm path (walk-in default customer, immediate full payment), not a parallel document engine |
| 7 | POS Sales list + detail screens (items/payments/accounting-entries/attachments/audit tabs) | M | #6 | `<DocumentDetail>` "effects of this transaction" explainer pattern already built for Sales Invoices |
| 8 | POS Refunds domain: per-line qty-capped returns against an original sale, tied to an active shift | M | #6 | **specializes `packages/domain/src/sales-returns`** |
| 9 | POS Refunds screens (list + new-refund form, pre-scoped from a sale or opened blank) | S | #8 | same list/form primitives |
| 10 | Discount Approvals: manager queue, cashier/manager % + amount thresholds, 5-minute request expiry | M | #1 | **deliberately not the general workflow engine** — a separate, threshold-driven mechanism per `plan.md` §5.6; wired via `packages/domain/src/events` (notification-style, not the 26-action-type workflow gate) |
| 11 | POS Hub (domain landing page) | S | #3–#10 | same hub pattern already built for the other 8 domains |

### POS-2 — Restaurant mode

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 12 | Table Management: floor designer (drag-drop layout editor, staging area for unplaced tables, section/zone grouping) | L | #3 | none new — bespoke drag-drop, no v1 equivalent |
| 13 | Table Management: live occupancy view + per-table stats tab | M | #12, #6 | POS sales for revenue-by-table stats |
| 14 | Reservations: **consolidate** the embedded tables-tab reservation flow and the standalone `/pos/reservations` screen into one data model with two entry points (per `docs/tasks.md` §5, decision 10 — the source shows the same data behind two disconnected surfaces; pick one to avoid inheriting the ambiguity) | M | #12 | shared form/list |
| 15 | Kitchen Display System: order-card queue, stage transitions (queued→preparing→urgent→ready→picked-up), meal/course-section routing config | L | #6, dedicated realtime channel | **`packages/domain/src/events`** (typed event bus) — needs a dedicated, well-tested channel with polling fallback per `plan.md` §2.6, since this is the one screen with hard latency requirements; **[spec-risk]**: empty queue in the source, order-card layout/bump controls inferred, not observed |
| 16 | Deliveries: 6-state pipeline (pending→prepared→dispatched→delivered, +failed/returned), driver assignment, live-map placeholder | L | #6 | none new; **[spec-risk]**: 0 records in source, driver-assign/live-map mechanics unconfirmed |
| 17 | Loyalty points config (source shows this as platform-managed-only; **[decision]** whether Mezan makes it tenant-editable) | S | none | none new |

### POS-3 — The net-new selling screen

The single deliberate net-new UI surface in the entire Mezan rebuild. Every sub-task below reuses an existing engine for its *logic*; only the screen itself is new.

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 18 | **Selling-screen design spike** — interview a real cashier, storyboard scan→cart→discount-request→split-payment→receipt→drawer, hold/resume, AR collection at the till, offline queue + force-close; prototype in the design system; test on real hardware (barcode scanner, 80mm thermal printer, cash drawer, touch screen) | L | POS-1/POS-2 domain models | mandatory per `plan.md` §7.4 — do not start #19 until this produces an agreed screen spec |
| 19 | Product grid + search + barcode scan (incl. embedded price/weight barcodes: prefix + item-code digits + price digits + decimals + EAN-13 check) | L | #18, Items, v1 barcode-parsing rules | **v1's embedded-barcode parsing rules (Phase 9/10) + item search**, reused verbatim |
| 20 | Cart engine: line discounts, held/suspended sales, customer attach + walk-in default (`زبون عابر`) | L | #19 | **`packages/domain/src/sales-invoices` line/discount/tax computation directly** |
| 21 | Split & multi-method payment, AR/credit collection from the till (gated by the `السماح بتحصيل الآجل من الكاشير` setting) | L | #20, #2, treasury | **treasury cash-application/allocation engine (`packages/domain/src/treasury-accounts`, `vouchers`)** |
| 22 | Discount-over-limit request flow: cashier-side trigger feeding the manager approval queue | M | #10, #20 | POS-1 #10's Discount Approvals domain |
| 23 | Table assignment + course/meal routing to the kitchen | M | #12, #15, #20 | POS-2's table + kitchen domains |
| 24 | Cash-drawer movements + receipt print + drawer kick | M | #4 | **v1's client-rendered print pipeline + ESC/POS `tcp://ip:9100` raster/text path** (`plan.md` §2.4) for auto-cut/drawer-kick — not a new printing mechanism |
| 25 | Hard offline behaviour: offline sale queue + `force_close` permission ("close with pending offline sales") | L | #20, #21 | **`packages/domain/src/lan`** (session registry + feature flags already built for LAN multi-till) — a till losing its LAN connection to the shop's SQLite host is the actual offline scenario in Mezan's architecture (the desktop app itself is already offline-first by construction; this is specifically the *multi-till* disconnection case) |
| 26 | Selling-screen hardware E2E suite (scanner, thermal printer, drawer, touch) | M | #19–#25 | v1's Playwright **Electron** project (already in CI per `plan.md` §2.7) |

*(26 numbered tasks above — POS-0 through POS-3.)*

---

## 9.3 Part 3 — Cloud/SaaS website edition (20 tasks)

Everything the Path-A decision was made to defer, not to avoid: `apps/server` already exists today and mounts the shared `packages/api` Hono app over real HTTP with SQLite standing in for Postgres (`apps/server/src/index.ts`). This part is genuinely additive infrastructure work underneath code that already runs the same way in production form on desktop — no domain rewrite anywhere in this section.

### Cloud-0 — Postgres dialect & conformance (the deferred core of Path A)

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 1 | Postgres schema-spec DSL codegen: emit `schema.pg.ts` + `drizzle-kit generate` migrations from the same spec that already emits SQLite | L | none | **`packages/persistence/src/schema.ts`** — the spec DSL is already authored once for SQLite per `plan.md` §2.2; this is the second codegen target it was built for |
| 2 | `SqlDialect` capability shim, Postgres implementation: upsert syntax, `RETURNING`, window functions, `ILIKE`, JSON functions, `pg_advisory_xact_lock` | M | #1 | shim interface scoped in `plan.md` §2.2 for exactly this swap-in |
| 3 | Dual-engine conformance test suite in CI: the full existing Vitest domain/repository corpus run against both a fresh Postgres (Testcontainers) and SQLite on every run | L | #1, #2 | **the entire existing test suite** across `packages/domain`, `packages/persistence`, `packages/api` — this task runs it twice, doesn't rewrite it |
| 4 | Golden-ledger fixture assertion on both engines (invoice→stock+COGS+AR+VAT, FX revaluation, payroll run, depreciation run — asserted to the minor unit) | M | #3 | existing golden-ledger/`post-journal-entry` test fixtures |
| 5 | Arabic search on Postgres: `pg_trgm` GIN index + `tsvector`(`simple`) over the shared `search_norm` column that SQLite's FTS5 already indexes | M | #1 | `normalizeArabic()` + `search_norm` column (already written by the domain on save for SQLite/FTS5 per `plan.md` §2.3) — same normalized text, new index type only |

### Cloud-1 — Auth & multi-tenancy

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 6 | Cloud JWT auth + refresh-token flow (`HttpOnly` cookie, in-memory access token — the two deliberate improvements over the source app's `localStorage` tokens), Argon2id password hashing | M | #1 | `packages/domain/src/users`, `roles`, `permissions` — same `AuthContext` shape the desktop local-user-store already produces (`plan.md` §3.3) |
| 7 | Postgres Row-Level Security: per-request `SET LOCAL app.tenant_id`, defence-in-depth under the repository's own tenant scoping | M | #6 | `tenant_id` already present on every desktop table (kept deliberately for this — `plan.md` §2.3) |
| 8 | Multi-tenant admin/platform-admin permission tier (the 2 platform-only permissions: `admin.tenant.settings.edit`, `admin.modules.manage`) | S | #6 | permissions engine's dependency-graph mechanism |

### Cloud-2 — Server, realtime & storage

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 9 | Node server hardening: real tenant resolution by company code (today's `apps/server` is single-tenant/dev-only), request-scoped `UnitOfWork`, structured error handling | M | #6, #7 | **`apps/server`, `packages/api`** — extends the existing mount, doesn't replace it |
| 10 | SSE + Redis pub/sub realtime fan-out, scoped per tenant/user | M | #9 | **`packages/domain/src/events`** — the typed event bus/catalog already used for desktop's in-process `webContents.send` delivery; same events, new transport |
| 11 | `FileStore` port, S3-compatible implementation (private buckets, short-lived signed URLs, server-side MIME scanning) | M | #9 | port interface built in HR §1 #7 for the desktop content-addressed store — this task adds the second adapter, not the port |
| 12 | Kitchen Display's dedicated low-latency realtime path over SSE (the one screen with hard latency needs, per `plan.md` §2.6) | M | #10, POS-2 #15 | same event bus/catalog |

### Cloud-3 — Entitlements, billing, onboarding

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 13 | Subscription/plan → entitlements mapping (`{plan, activeModules[], features{}, seats, expiresAt}`) | M | #6 | **`packages/domain/src/entitlements`** — same shape the desktop Ed25519 license file already encodes (`plan.md` §2.5); cloud just derives it from a subscription record instead of a signed file |
| 14 | Tenant onboarding: company-code registration + seed wizard (COA, tax profile, numbering sequences, branch, warehouse) | M | #13 | mirrors the desktop first-run wizard already specified in `plan.md` §3.3 |
| 15 | Billing integration (provider **[decision]** — Stripe vs. a regional processor for EGP) | L | #13 | new work — no existing analog |

### Cloud-4 — Deferred platform surfaces that only make sense once multi-tenant

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 16 | API Keys + Connected Apps screen (real feature in the source, just unlinked from its nav) | M | #8 | v1's permission-gated settings-screen pattern |
| 17 | Webhooks: outbound HMAC-signed event delivery + event-type picker | M | #10 | same typed event catalog doubles as the webhook trigger source per `plan.md` §5.6 |
| 18 | Email delivery (SMTP/Resend) + headless-Chromium server-side PDF generation | M | #9, v1 print engine | **v1's client-rendered print DOM** — server renders the identical components via headless Chromium instead of `webContents.printToPDF`; offline (desktop) never depends on this path |
| 19 | Cloud backup: PITR, cross-region snapshots, per-tenant export (doubles as the cloud→desktop migration path) | M | #9 | desktop's backup/restore manifest + integrity-check design (`plan.md` §3.7) — same shape, platform-operated instead of scheduled-in-app |

### Cloud-5 — Packaging & deploy (local build/deploy steps only — no CI wiring as part of this plan)

| # | Task | Size | Depends on | Reuse |
|---|---|---|---|---|
| 20 | Production server deployment shape: container image, environment/secrets config, migration-on-deploy step, basic monitoring/logging | M | #9 | existing GitHub Actions pipeline structure (extended, not replaced) |

*(20 numbered tasks above — Cloud-0 through Cloud-5.)*

---

## Cross-cutting notes carried over from `docs/plan.md` and `docs/tasks.md`

- **WhatsApp integration settings** and the **third locale (German)** are named in the source catalog but flagged `[spec-risk]`/`[decision]` in `docs/tasks.md` §5 — neither is scoped as a numbered task above; resolve the product question first, then it's a small addition to Cloud-4 or the app-shell respectively.
- **ETA e-invoicing on the cloud edition** is already in v1 scope (online-only, per `plan.md` §3.6) and does not repeat here; Cloud's job is only to make sure the multi-tenant transport doesn't change its online-only constraint.
- **Payroll (HR-5) and the POS selling screen (POS-3)** are the two genuine unknowns in this entire deferred scope — both carry a mandatory design spike as their first task (#22 and #18 respectively) precisely so the size estimates on the tasks that follow them are honest rather than optimistic placeholders.
