# Mezan — Status

**Updated 2026-08-23** · Branch `main` @ `3146461` (pushed to GitHub) · v1 = Electron desktop, SQLite, real data.

> **This is the only status document.** Everything else under `docs/` is durable
> reference that does not go stale. Point-in-time audits live in `docs/archive/`
> and are kept for their evidence, not their conclusions — do not read them for
> current state.

## Where to look

| Question | Document |
|---|---|
| What is the architecture, and why? | `plan.md` |
| What does the reference app actually do? | `catalog/01..10` — the spec, captured from the live product |
| What is left to build, as issues? | `backlog.md` |
| How do I wire a screen to data? | `web-data-wiring.md` |
| How is anything verified now? | `testing-policy.md` |
| What is the plan for HR / POS / Cloud? | `deferred-plan.md` |
| How do we parallelise the build? | `execution-plan.md` |
| What is done and what is left? | **this file** |
| What did an earlier audit find? | `archive/` |

## Current state

Measured against the running app, not the checklist:

| Signal | Value |
|---|---|
| Screens routed | **103** (from 122 nav entries) |
| Read surfaces answering `pnpm smoke` | **100** |
| Reference screens still absent | ~22 |
| Typecheck / lint / build | passing |
| Business-logic test execution | disabled by decision — see `testing-policy.md` |

## Verification

Automated business-logic tests are **off**. Proof is:

1. `pnpm smoke` — boots the real backend, runs the demo seed, hits every read
   surface. Catches an unmounted route, which is the failure mode that has bitten
   this codebase repeatedly.
2. `pnpm typecheck` and `pnpm lint` (including the RTL logical-CSS rule).
3. **Driving the real UI against a seeded backend.** A live click-through found
   five user-facing defects that 2,080 passing unit tests did not.

```bash
MEZAN_SEED_DEMO=1 MEZAN_DB=./dev.db PORT=3187 pnpm exec tsx apps/server/src/index.ts
cd apps/web && MEZAN_API_URL=http://127.0.0.1:3187 pnpm exec vite --port 5183
```

Log in as `محمد الشهابي` / PIN `1234`. **Reload the page to confirm a save
actually persisted** — that check alone has caught several "works until you look
again" bugs.

## Done

- **No mocked data anywhere in `apps/web`.** No `*-sample-data.ts`, no in-browser
  store. Every screen reads and writes the API. The demo tenant lives in
  `packages/backend/src/demo-seed.ts` and runs only on `MEZAN_SEED_DEMO=1`.
- **Platform administration** — approvals inbox, workflow config, notification
  rules, numbering sequences, audit viewer, data migration, barcode config,
  profile, API keys, webhooks.
- **Inventory** — product templates, label printing (Code 128 inline SVG, verified
  scannable), physical-count variance with cost snapshot and blind counting.
- **Shell** — 8 domain hubs, production dashboard, system status, working
  branch/warehouse selectors that narrow scope without ever widening it beyond the
  session grant.
- **Accounting** — the 7 financial statements over the live posted ledger; the
  inventory sub-ledger reconciles to its GL control account exactly.

## Open

- **HR** — the domain, persistence, routes and 36 permissions exist on `main`, but
  only the dashboard is in the nav; ~12 screens are built and unreachable.
  Attendance, leave policies/balances/accruals, payroll and advances are absent.
- **POS** — absent in every layer. Deferred by decision.
- **i18n and the language switcher** — not started. Every string is an inline
  Arabic literal and `lang` is hardcoded. Held back deliberately while ~30 screens
  were under construction; now unblocked.
- **Reports** — 19 of 25. Missing: sales-by-salesperson, van sales, promotions,
  expiring-soon (FEFO), make-vs-buy. The two POS reports wait on POS.
- **WhatsApp settings** — the reference itself only exposes a module-gated stub.

## Known defects and open decisions

Two need a decision before a patch, because each changes a shared contract —
both are written up in full in `tasks.md`:

1. **Workflow `minAmount` is configurable but never enforced.**
   `DocumentWorkflowInput` carries no amount field, so the gate cannot see the
   threshold it is meant to compare against. Until decided, the field should be
   labelled not-yet-enforced rather than shown as active.
2. **The gate expects role codes; two routes pass permission codes.**
   `sales-invoices-routes.ts` and `vouchers-routes.ts` pass the resolved
   permission set as `actorRoles`, so a role-gated step can only be satisfied
   there by the company-admin `"*"` bypass.

Also outstanding: no webhook dispatcher (subscriptions and delivery records exist,
nothing sends); email and WhatsApp notification channels are modelled but
unimplemented and labelled as such; purchases and vouchers do not accept an audit
sink at their route layer.

## Lost in the merge with main

Two teams built overlapping features in parallel. Where both built the same thing,
main's implementation won — 36 commits already depended on it. Two capabilities
had no main equivalent and were lost; both are being restored:

- **Item specifications registry** — a reusable attribute catalog found by live
  inspection of the reference app and documented nowhere in `docs/catalog/`.
- **Notification trigger catalog** — enumerated all 39 catalogued events and
  flagged which 9 this build actually emits, so a rule could not be configured on
  an event that can never fire.
