# Web data wiring — migrating screens off sample data

This note is the pattern for turning a `*-sample-data.ts`-driven web screen into
one backed by REAL persisted data. Phase 1 wired login → the dashboard (لوحة
التحكم) → the shell this way; the remaining screens follow the same steps.

## The pieces

- **Backend** — `@mezan/backend`'s `createBackend({ dbPath })` builds the ONE
  seeded Hono app: opens SQLite, lets each repository bootstrap its tables,
  seeds an EMPTY DB (COA, VAT, fiscal year, main branch + warehouse, tenant
  settings, admin user), and mounts the full `@mezan/api` surface plus the real
  `/auth`, `/bootstrap` and `/dashboard` routes. Seed values (Cyag / محمد
  الشهابي) apply to an empty DB only — never to drive a screen.
  - `apps/server` serves it over HTTP (`MEZAN_DB` → a real file).
  - `apps/web` (dev/e2e) reaches it at `/api`, proxied to `apps/server`
    (`vite.config.ts`; Playwright starts both). Electron reaches the same app
    over `window.mezan.fetch` → `app.fetch`.

- **Transport** (`apps/web/src/data/transport.ts`) — the single platform switch:
  HTTP `/api` on web, `window.mezan.fetch` in Electron. Nothing above it
  branches on platform; tests inject a fake transport.

- **Session + auth headers** (`data/session.ts`, `data/ApiContext.tsx`) — a real
  login (`POST /auth/login`, username + PIN) yields a `SessionDTO`; `authHeaders`
  turns it into the `x-user-id` / `x-permissions` / `x-branch-scope` /
  `x-warehouse-scope` headers the API permission gate reads. `ApiProvider.request`
  merges them into every call.

- **TanStack Query** (`data/queryClient.ts`, `data/AppProviders.tsx`,
  `data/hooks.ts`) — `QueryClientProvider` + `ApiProvider` wrap the app in
  `main.tsx`. Typed hooks (`useLogin`, `useDashboardSummary`, `useBootstrapSeed`,
  `useCreateFirstAdmin`) use `@mezan/contracts` DTOs.

## Steps to migrate a screen (e.g. Customers)

1. **Contract**: reuse the existing `@mezan/contracts` DTO for the resource
   (e.g. `CustomerDTO`); add a new one only for aggregates (see `dashboard.ts`).
2. **Hook**: add a `useXxx` query/mutation in `data/hooks.ts` that calls
   `request("/customers")` and parses via the DTO type. Mutations invalidate the
   relevant `queryKey`.
3. **Screen**: delete the `*-sample-data.ts` import; drive the screen from the
   hook's `data`, with real loading / error / EMPTY states (zeros and empty
   lists — never fabricated numbers). Controls (filters, sorts, ranges) must
   change the query (params / `queryKey`), not flip local state over a static
   array — see the dashboard period control (`fromDate`/`toDate`).
4. **Tests**: wrap component tests in `renderWithProviders` with a
   `stubTransport({ "GET /customers": ... })` (`data/test-support.tsx`); update
   e2e specs that assumed sample data to assert against the seeded backend.
5. **Remove** the now-unused `*-sample-data.ts` file.

## Status (verified 2026-08-23, `main` @ `7b65887`)

**Real backend data.** Login/session (now persisted across reload), the dashboard, the
shell's tenant + user, the first-run wizard, and the large majority of screens: items,
customers, suppliers, chart of accounts, journals, trial balance + financial reports,
sales invoices/quotes/returns, price lists, promotions, the full purchase chain
(RFQ → PO → GRN → invoice → returns → landed costs), treasury accounts/vouchers,
cheques, bank reconciliation, installments + follow-ups, cost centers, fiscal periods,
taxes, CRM (leads/opportunities/pipeline/activities), projects, fixed assets +
depreciation, van trips, manufacturing (BOMs, work orders, configurable products),
users, roles, settings, branches, warehouses.

**Domain-in-browser (the remaining gap).** Nine screens import `@mezan/domain` directly
through `apps/web/src/store/*` and run it against in-memory repositories:

| Screen | Store | API route that already exists |
|---|---|---|
| `StockBalanceScreen` | `store/inventory-ops-store.ts` | inventory routes in `@mezan/api` |
| `StockTransfersScreen` | `store/inventory-ops-store.ts` | inventory routes |
| `StockAdjustmentsScreen` | `store/inventory-ops-store.ts` | inventory routes |
| `PhysicalCountsScreen` | `store/inventory-ops-store.ts` | inventory routes |
| `ExchangeRatesScreen` | `store/accounting-depth-store.ts` | `/exchange-rates` |
| `FxRevaluationScreen` | `store/accounting-depth-store.ts` | `/revaluation` |
| `CostCenterPnLScreen` | `store/accounting-depth-store.ts` | `/cost-center-pl` |
| `ReconciliationScreen` | `store/accounting-depth-store.ts` | `/reconciliation` |
| `EtaScreen` | `store/accounting-depth-store.ts` | `/eta` |

The business rules these screens exercise are the real domain services, so their tests
are meaningful — but no write survives a reload, and two users on a LAN multi-till
install would not see each other's data. Converting them is steps 2–5 above; no
backend work is required.

**Sample-data files still present** (7, ~20 importers): `sample-data.ts`,
`accounts-sample-data.ts`, `items-sample-data.ts`, `accounting-treasury-sample-data.ts`,
`inventory-ops-sample-data.ts`, `settings/sample-data.ts`, `login/login-sample-data.ts`.
Note that `sample-data.ts` also holds the nav registry (`navGroups`), the command-palette
items and the demo entitlements — those need a real home before the file can be deleted,
so "delete the sample-data files" is not purely a cleanup task.
