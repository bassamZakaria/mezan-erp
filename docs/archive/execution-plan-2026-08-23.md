# Mezan — Parallel Execution Plan

> **Archived — point-in-time.** This was the parallel build plan and its W1–W9 wave schedule. Retired 2026-08-25: W1–W7 shipped. Current state is `../STATUS.md`. Kept for its evidence — several source comments cite its wave numbers for why a module is shaped the way it is.

> Orchestration plan for building v1 (Electron desktop, SQLite) with **maximum parallelism**. Strategy: build the shared **base engines** first — even when they live in later phases — so that feature work afterward has no cross-feature dependencies and can run in many concurrent PRs. Every unit = its own branch + squash-merged PR (revertable). Agents rebase on the shared barrels (`packages/*/src/index.ts`) when concurrent.

## The principle
The backlog is phase-ordered by domain. That is NOT the fastest build order. The fastest order is **dependency-ordered by shared infrastructure**: a handful of engines (GL posting, costing/stock ledger, a generic document framework, the report engine, the print pipeline) are depended on by dozens of features. Build those as a deliberate BASE LAYER; then every document screen, report, and master record becomes an independent leaf that parallelizes cleanly.

## Dependency tiers (what unblocks what)
- **Tier 0 — Foundations** (DONE, PRs #1–#5): monorepo+CI, Money/Qty, numbering, audit, event bus, permissions, workflow gate, entitlements/licensing, Electron shell+backup, `@mezan/ui` design system + primitives.
- **Tier 1 — Org + master data + access UI** (DONE): settings foundation, LAN multi-till, chart of accounts, users&roles → then items, customers, suppliers, tax rates, cost centers, treasury accounts, fiscal periods. These are referenced by every document.
- **Tier 2 — Shared engines** (DONE — the parallelism unlock; pulled forward from Phases 2/5/8):
  - **GL posting engine** (double-entry, balanced-or-rejected, period gate) — needs COA + numbering + audit.
  - **Costing + stock-ledger engine** (WAC, immutable cost layers, stock movements) — needs items + Money.
  - **Document framework** (generic draft→confirm→post lifecycle + numbering + GL-posting hook + stock hook + workflow gate + audit + "document effects" panel) — needs GL + costing + workflow. Every document module reuses this.
  - **Report engine** (`ReportDefinition`: params → query → table/chart) — near-standalone; start early.
  - **Print pipeline** (typed `PrintTemplateConfig` + renderer + printToPDF/ESC-POS) — needs `@mezan/ui`.
- **Tier 3 — Feature fan-out** (DONE for every module except the deferred ones; 18 of the 33 catalog reports built): every document module (journal entries UI, sales invoice, purchase invoice/PO/GRN, treasury vouchers, stock adjustments/transfers/counts, returns, landed costs, installments, manufacturing work orders, van trips, etc.) and every one of the 33 reports and each master/config screen — all leaves on the shared engines, so they run concurrently.
- **Tier 4 — Platform/config UIs + polish** (NOT STARTED, except the dashboard, users/roles and the settings tabs): workflow builder, notification-rules builder, numbering/print/barcode admin, data-migration wizard, audit-log UI. This tier is now the single largest block of unbuilt v1 scope — see `tasks-2026-08-23.md` §Phase 10.
- **Cross-cutting, continuous**: after each phase/tier, a dedicated **UI/E2E test agent** (Playwright, web + Electron) runs in parallel with the next tier.

## Wave schedule (each row = a batch of concurrent PRs)
| Wave | Concurrent PRs (disjoint areas to avoid conflicts) | Depends on |
|---|---|---|
| **W1** ✅ done | settings-foundation · LAN-multitill · chart-of-accounts · users-&-roles | Tier 0 |
| **W2 — master data** ✅ done | items · customers · suppliers · tax-rates · cost-centers · treasury-accounts+fiscal-periods · dashboard+login/first-run · **[test] Phase-0 UI/E2E** | W1 (COA, settings) |
| **W3 — shared engines** ✅ done | GL-posting-engine · costing+stock-ledger · report-engine · print-pipeline · **[test] Phase-1 UI/E2E** | W2 (items, COA) |
| **W4 — document framework** ✅ done | document-framework abstraction · journal-entries UI (first consumer, proves the framework) · **[test] W2/W3** | W3 |
| **W5 — documents fan-out (big parallel)** ✅ done | sales-invoice · purchase-invoice+PO+GRN · treasury-vouchers · stock-adjustments+transfers+counts · sales-returns · landed-costs · installments · **[test] W4** | W4 |
| **W6 — reports fan-out (big parallel)** 🟡 18/33 reports | financial-statements(7) · sales-reports · purchases-reports · inventory-reports · aging · POS/installment-reports · cost-center-P&L · **[test] W5** | W3 report-engine + relevant document data |
| **W7 — remaining modules (parallel)** ✅ done | full-inventory-ops · full-sales(quotes/price-lists/promotions/credit-control) · full-purchases(RFQ/returns/strictness-gates) · treasury-completion(cheques/bank-rec) · manufacturing · CRM · projects · assets · van-sales · **[test] W6** | W4/W5 |
| **W8 — platform/config + polish** ⬜ not started (FX/exchange-rates + ETA landed; the admin UIs did not) | workflow-builder · notification-rules-builder · numbering/print/barcode admin · data-migration-wizard · audit-log UI · FX/exchange-rates+revaluation · ETA e-invoicing · **[test] W7** | W2/W4 |
| **W9 — packaging** ⬜ not started | signing/notarization · electron-updater feed · release pipeline · full E2E suite | all |

Deferred (not in v1): Phase 13 HR/Payroll, Phase 14 POS (incl. selling screen), Phase 15 Cloud/SaaS website — planned, built later.

## Conflict-avoidance rules for concurrent agents
- One branch + one squash-merged PR per unit; delete branch on merge.
- Each unit owns its OWN module folder in each package; **append-only** edits to shared barrels (`packages/domain/src/index.ts`, `contracts`, `persistence`, `@mezan/ui`), and **rebase on origin/main + re-append** if the barrel conflicts on merge.
- Split concurrent batches across DISJOINT areas where possible (domain vs web vs desktop vs persistence) to minimize barrel contention.
- Every PR: `pnpm typecheck && pnpm lint && pnpm test` (and `pnpm --filter web build` for UI) green before merge. CI re-verifies.
- Money is scaled int64 always; domain stays pure (layer-boundary lint); RTL logical-properties only.

## Status (2026-08-23, `main` @ `7b65887`)

W1–W5 and W7 are merged; W6 shipped 18 of the catalog's 33 reports plus the financial-statement
family; W8 shipped only its FX/exchange-rates and ETA rows (and those two screens still run
in-browser rather than through their mounted API routes); W9 has not started — no signing,
notarization, updater feed or release pipeline exists. Playwright has 28 specs, and
`pnpm test` covers 2078 unit/component tests.

## Checkpoints
- Report token actuals at each wave boundary (commitment tracking). Phase 0 actual ≈ 1.1M tokens → v1 tracking ~15–30M, well under the original 75–95M estimate.
- User tests each phase in the running app; merges do not block on approval, but PRs remain for rollback.
