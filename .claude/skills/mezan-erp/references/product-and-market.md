# Product, architecture and market context

Full detail lives in `docs/plan.md` (architecture, licensing, phases),
`docs/backlog.md` (phased scope), `docs/catalog/01..10` (the captured spec) and
`docs/STATUS.md` (the single status document — everything else under `docs/` is
durable reference; point-in-time audits live in `docs/archive/` and are kept for
their evidence, not their conclusions).

## What Mezan is

An Arabic-first, RTL, Egypt-focused ERP for SMB trading, retail, restaurant and
light-manufacturing businesses — a ground-up rebuild targeting parity with a captured
catalog of 15 functional domains and ~110 nav-addressable screens (250–330 real views
once list/create/edit/detail/print variants are counted). Never name the source
product in code, docs or UI; call it "the reference product" or "the captured catalog".

Sizing honestly: this is an Odoo-class ERP with a deep engine underneath — weighted
average costing with immutable layers, per-item GL mapping, multi-currency with
auto-reversing FX revaluation, cost centers, three-state fiscal periods, an approval
workflow engine and mandatory government e-invoicing.

Scale from the catalog: 33 reports, ~268 permissions across 19 modules, 25 numbering
sequences (31 built), 10 voucher types, 26 workflow-gateable actions, 39 notification
events × 3 channels, 7 cheque states, 78 seeded GL accounts, EGP + 10 currencies,
5 warehouse types, 8 stock-adjustment reasons (`INITIAL_STOCK` is the opening-balance
mechanism), 3 label sizes.

## Dual deployment — one domain core

The domain never talks to HTTP or to a database; it talks to a repository port and an
entitlements port. Two adapters bind it:

| | Cloud edition | Desktop edition (v1 focus) |
|---|---|---|
| Transport | HTTPS REST `/api/...` | in-process `app.fetch()` over Electron IPC |
| Database | PostgreSQL, multi-tenant | SQLite file, single tenant |
| Identity | JWT + refresh, tenant claims | local user store, OS-keychain-sealed |
| Entitlements | subscription record → claims | Ed25519-signed offline licence file |
| Realtime | WebSocket/SSE | in-process event bus |
| Backups | platform-operated | a first-class product feature |

Entitlements have the same shape in both: `{ plan, activeModules[], features{}, seats,
expiresAt }`. Web reaches the backend at `/api` proxied to `apps/server`; Electron
reaches the identical app through `window.mezan.fetch`. `apps/web/src/data/transport.ts`
is the single platform switch — nothing above it branches on platform.

SQLite concurrency: confirm flows once deadlocked across ~35 separate connections;
everything goes through the shared `openSqliteConnection` / `withSqliteTransaction`.

## Wiring a screen to data

Contract in `@mezan/contracts` → typed hook in `apps/web/src/data/hooks.ts` (TanStack
Query, mutations invalidate their key) → screen driven by the hook with real loading,
error and **empty** states. Filters, sorts and ranges must change the query, not flip
local state over a static array. If the route is not mounted in
`packages/backend/src/create-backend.ts`, mount it first — a route file that exists but
is never supplied its dep returns 404 live while looking finished in the source.

## Current shape (`docs/STATUS.md`, 2026-08-24 — and treat it with suspicion)

110 screens routed, 116 read surfaces answering `pnpm smoke`, 102 list surfaces
non-empty, `pnpm scenarios` at 1,412 assertions passing with 4 failing (the open
defects, deliberately), no mocked data anywhere in `apps/web`. The locale layer,
language switcher and the shell's ar/en catalogs have landed; per-screen extraction of
~3,000 Arabic literals has not. Reports are complete apart from the two POS ones.

Open: payroll statutory rules (income tax, social insurance, Article 47 seniority,
overtime, gratuity — the catalog captured no formula, so unsupported cases are skipped
with a named warning and the payslip says its net is incomplete), leave-policy presets
carrying inferred statutory numbers (casual 7 and paternity 1 under Law 14/2025 want
legal review), POS (deferred by decision), email/WhatsApp channels modelled but
unimplemented, and the six defects in `docs/defects.md`.

**`STATUS.md` has been wrong before** — it claimed two reports were missing that were
in the nav the whole time, blocked three more on false "needs a schema change" claims,
and miscounted emitted events. Verify against the running app before you believe it.

## Licensing and modules

Clients buy modules, not the whole app: gate every surface on `activeModules` and never
license a module that does not exist. One licence must cover multiple devices for a
single client. Capacity axes worth modelling: seats, branches, warehouses, POS
terminals. Persona bundles (wholesale/distribution, retail/F&B, manufacturing) sit on
top of à-la-carte modules.

## Competitive picture (review input, not committed positioning)

The nearest competitor is **Daftra** — cloud-only, tiered SaaS with usage caps
(~490 / 978 / 1,960 EGP per month plus per-unit add-ons), genuinely deep: cheque cycle,
installments, BOM/routings/scrap manufacturing, HR/payroll, multi-branch, mobile apps,
offline-capable POS. Also in the frame: Odoo (assembled, partner-dependent, hidden
TCO), SAP Business One and Dynamics 365 (partner-led, costly, bolted-on localization),
ERPNext (self-host, no Egypt compliance), QuickBooks/Zoho (accounting only, not
Egypt-native), and Excel as the do-nothing baseline.

A comparable Egyptian product prices a Core bundle (Accounting + Sales + Purchases +
Inventory) with priced add-ons — POS +500, Manufacturing +500, HR & Payroll +400,
Installments & Cheques +250, Multi-currency +200, Fixed Assets +200, Loyalty +150, AI
+500 EGP/month — which independently validates the module-entitlement design, and
suggests treating multi-currency and ETA e-invoicing as their own licensable modules.

**Where Mezan actually differentiates:** a true offline-first Arabic *desktop* ERP (the
closest competitor's offline capability is POS-only), module-based licensing instead of
cap-based tiers, and Egypt/ETA-first positioning. **Honesty caveat:** the reference
product's own comparison page overstates Daftra's weaknesses — Daftra does have
manufacturing, cheques, installments and offline POS. Mezan's real edge is deployment
model and execution quality, not "features they lack". Do not reuse those overstated
claims.

Catalog gaps worth verifying before finalizing those modules: BOQ / progress
certificates / retention billing for contracting, FEFO for pharma, cheque
endorsement/replacement states, own-fleet delivery tracking, IAS-21 FX gain/loss depth.

## What Egyptian compliance actually demands (measured 2026-08-25)

Scoped in `docs/scenarios/09-cross-module.md` X40–X51 and partly asserted in
`seams.ts`. These are not polish; they are what a customer is audited on.

- **ETA e-invoicing** — B2B is pre-clearance, B2C an e-receipt within 72 hours with a
  QR on the printed copy. Registration threshold cut to **EGP 250,000** (Resolution
  281/2025), enforcement from 1 Jan 2026, and late-submission penalties escalate on a
  rolling 12-month count. Confirming a sales invoice with `autoSubmitOnConfirm` on now
  queues a submission (F33); the submit/clearance lifecycle beyond the queue is still
  manual.
- **VAT is not 14% of everything** — a 5% reduced rate, zero-rated exports, exempt
  supplies, and the legacy construction treatment of 14% on **36% of value** with no
  input deduction. Per-line rates post correctly; the VAT return cannot report them
  separately (D28) and a partial taxable base cannot be expressed at all.
- **Withholding tax** on local B2B payments — the payment is net, the withheld amount
  is owed to the authority, and the supplier must still read as settled in full. No
  account, no field, no report exists (D27).
- **Statutory payroll** — income tax, social insurance as **two** liabilities
  (employee share and employer cost), Article 47 seniority, end-of-service gratuity.
  None is computed, and the honest requirement is that every payslip *says so* rather
  than presenting a confident net that is wrong.
- **Multi-currency** is presented and unimplemented (D24): documents take a currency
  label, no rate is ever applied, and the revaluation engine behind them is correct but
  unreachable. If multi-currency is to be a licensable module, this is the work.
