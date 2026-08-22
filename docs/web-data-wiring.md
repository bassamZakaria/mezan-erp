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

## Status

- **Real now**: login/session, the dashboard (KPIs, company totals, system-data
  counts, recent activity — all from posted GL entries + repos, with a working
  period range), the shell's tenant name + signed-in user, and the first-run
  wizard's seed + admin-creation steps.
- **Still sample-data** (follow-up sweep): items, customers, suppliers, chart of
  accounts, journals, treasury, purchases, users/roles pages, and the sales
  screens. Their API routes already exist in `@mezan/backend`; only the web
  screens need converting with the steps above.
