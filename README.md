# Mezan (ميزان)

**AR:** ميزان هو نظام تخطيط موارد مؤسسات (ERP) عربي أولاً بالكامل (RTL)، منتج مُعاد بناؤه بشكل مصرّح به، ويعمل في نسخة سحابية (ويب) ونسخة سطح مكتب تعمل بدون إنترنت بالكامل — من قاعدة كود واحدة بلغة TypeScript.

**EN:** Mezan is an Arabic-first, RTL ERP — an authorized rebuild — shipping as one TypeScript codebase that compiles into two products: a multi-tenant cloud web app and a fully-offline, license-gated Electron desktop app.

## Architecture summary

One transport-agnostic, database-agnostic TypeScript domain core (`packages/domain`) is mounted behind a [Hono](https://hono.dev) app and bound to two thin adapters:

- **Cloud** — Hono over HTTPS, PostgreSQL (multi-tenant, Row-Level Security by `tenant_id`), JWT + HttpOnly-refresh auth, SSE realtime.
- **Desktop (Electron)** — the same Hono app called in-process via `app.fetch()` over IPC (no socket, no port), SQLite (WAL) as a single-tenant embedded database, local user store with OS-keychain-sealed sessions, in-process event bus.

Key building blocks:

- **Persistence** — [Drizzle ORM](https://orm.drizzle.team), dual dialect: each table is authored once in a spec DSL and codegen'd into `schema.pg.ts` (Postgres) and `schema.sqlite.ts` (SQLite), each with its own migration set. A dual-engine conformance suite runs the full domain test corpus against both engines in CI.
- **Money & quantities** — scaled int64 (10⁻⁶) values, never floats; domain arithmetic goes through `Money`/`Qty` value objects backed by `decimal.js`, with rounding only at documented boundaries (largest-remainder allocation).
- **Frontend** — React + Vite + Tailwind + shadcn/ui, RTL-first by construction (logical CSS properties only, no hardcoded `left`/`right`), IBM Plex Sans Arabic, i18n (ar/en).
- **Desktop shell** — Electron, with `electron-updater` auto-update and first-class backup/restore as a shipped feature, not an afterthought.
- **Licensing** — Ed25519-signed offline license files (module/feature entitlements, seat counts, machine fingerprint binding, 14-day grace period before read-only mode).
- **LAN multi-till** — the same Hono app can bind to a LAN port so a single shop can run several tills against one desktop instance, gated by license flag.

See [`docs/plan.md`](docs/plan.md) for the full build plan (tech stack rationale, module build order, cross-cutting workstreams, risks and open decisions), [`docs/catalog/`](docs/catalog) for the per-domain feature catalog the plan is grounded in, and [`docs/digest.md`](docs/digest.md) for the artifact digest.

## How to pick up a task

Work is tracked entirely on the issue tracker, not in this README:

- **Issues board** — every unit of work is a GitHub issue with a Scope, Acceptance criteria, Depends-on links, and a pointer into `docs/`. Start from the [open issues list](../../issues).
- **Labels** — filter by area: `domain`, `frontend`, `persistence`, `infra`, `design-system`, `licensing`, `page`, `spike`. Filter by how shovel-ready something is: `parallel-ok` (no blocking dependency, start now) vs `blocked-by-dependency` (check its "Depends on" first).
- **Milestones** — issues are grouped into `Spike — dual-engine proof`, `Phase 0 — Foundations`, `Phase 1 — Master data & key pages`, `Phase 2 — Ledger & costing`, `Phase 3 — Sales & Purchases documents`, matching the phasing in `docs/plan.md` §4. The dual-engine spike gates everything else — Phase 0 does not start until it's green.
- Before starting an issue, read its linked doc section and check its dependencies are actually closed, not just filed.

> Note: at the time of writing, only the docs above have been seeded. The milestones, labels and issue board described here are the next step in setting up this repo and may not exist yet — check the [issues](../../issues), [labels](../../labels) and [milestones](../../milestones) pages to see current status.
