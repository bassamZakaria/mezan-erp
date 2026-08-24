# Mezan — Status

**Updated 2026-08-23** · Branch `ui-enhancements` @ `1aa6a51` (pushed) · v1 = Electron desktop, SQLite, real data.

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
| Is the UX enhancement signed off? | `enhancements/meeting/2026-08-23-design-review.md` |
| What is the plan for HR / POS / Cloud? | `deferred-plan.md` |
| How do we parallelise the build? | `execution-plan.md` |
| What is done and what is left? | **this file** |
| What is broken right now? | **`defects.md`** — the defect register |
| What did an earlier audit find? | `archive/` |

## Current state

Measured against the running app, not the checklist:

| Signal | Value |
|---|---|
| Screens routed | **110** (from 129 nav entries) |
| «قريباً» markers outside HR | **0** |
| Read surfaces answering `pnpm smoke` | **114** |
| Reference screens still absent | ~22 |
| Typecheck / lint / build / smoke | passing |
| UX enhancement spec (§2–§8) | built; 4 items await a human decision |
| Contrast sweep, 13 screens × 2 themes | 0 failures, 0 horizontal overflow |
| Business-logic test execution | disabled by decision — see `testing-policy.md` |

## Verification

Automated business-logic tests are **off**. Proof is:

1. `pnpm smoke` — boots the real backend, runs the demo seed, hits every read
   surface. Catches an unmounted route, which is the failure mode that has bitten
   this codebase repeatedly.
2. `pnpm typecheck` and `pnpm lint` — the RTL logical-CSS rule, and a colour-token
   rule that fails when a Tailwind colour class names a token that does not exist.
   Such a class emits no CSS at all and the element silently inherits, so it
   passes every other gate; it shipped an unreadable active tab at 1.52:1.
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

- **HR payroll rules.** The module is built and reachable — employees,
  departments, job titles, contracts, holidays, attendance, leave
  requests/balances/accruals/policies, payroll runs, payslips and advances. But
  payroll deliberately does **not** compute Egyptian income tax, social insurance
  (either share), the Article 47 seniority bonus, overtime, hourly/daily pay
  bases, non-monthly frequency, end-of-service gratuity, or multi-currency runs —
  `docs/catalog/06-crm-hr.md` captured no formula for any of them. Each
  unsupported case is skipped with a named warning rather than silently computing
  a wrong net. **A payslip therefore shows a net that is missing statutory
  deductions, and the UI does not yet say so** — surfacing that is the next task
  and is the highest-priority open item in HR.
- **Leave-policy presets carry inferred statutory numbers.** Annual 21 and sick
  180 are solid; **casual 7 and paternity 1 under Law 14/2025 are the least
  certain** and want a legal review before release. Each line cites its article.
- **POS** — absent in every layer. Deferred by decision.
- **i18n and the language switcher** — not started. Every string is an inline
  Arabic literal and `lang` is hardcoded. Held back deliberately while ~30 screens
  were under construction; now unblocked.
- **Reports — complete apart from POS.** 23 operational reports are routed. The
  four that were listed as missing are built: expiring-soon (FEFO), make-vs-buy,
  sales-by-salesperson and promotions. Only the two POS reports remain, waiting
  on POS. (Van sales was never missing — this file was wrong.)

  Three of those four were blocked on claims in this file that turned out to be
  false. Make-vs-buy needed no schema change: `bomCostEstimate` already rolls up
  a BOM and purchase history is already read the same way `purchases-by-item`
  reads it. Only FEFO and the invoice fields needed real schema work.
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

Also outstanding: email and WhatsApp notification channels are modelled but
unimplemented and labelled as such.

**The webhook dispatcher and the purchases/voucher audit sink both exist** — this
file previously said neither did. The dispatcher sits behind transport and
signature ports with a bounded 3-attempt retry, and a failing delivery cannot
roll back the business operation that triggered it (verified: a confirm returned
in 47 ms while its retries were still in flight).

**This build emits 5 of the 39 catalogued events**, not the 9 this file and
`tasks.md` have claimed. The number is derived live from the bridge mappings in
`create-backend.ts`, and `/notification-rules/triggers` and `/webhooks/events`
agree with it exactly. The purchase order/receipt/invoice chain publishes
nothing because it is not a `DocumentService` and so has no
`DocumentEventPublisher` — **that is the decision to make**, and inventing
bridges for it was declined.

## Known defects

**`docs/defects.md`** is the register — six open, six fixed, and a list of
readings that look like defects and are not. It is read before every test run
and updated after.

Making all 102 list surfaces non-empty surfaced four of the six open ones. None
was visible on an empty tenant, which is the argument for the seeding gate in
`testing-plan.md`.

Two of them the demo seed deliberately steers around: its physical counts net to
zero and no work order is completed, both to keep the books exact. **So the demo
data is not evidence those two paths are sound.**

## Decisions waiting on you

1. **`recordPayment` and the allocation sub-ledger are two stores of the same
   fact** — tracked as **D1** in `defects.md`, now with a reproduction. The UI prefers allocations and the aging reports take the larger of
   the two, but the backend can still record one collection twice. Converging
   `recordPayment` onto allocations removes the fallback entirely.
2. ~~**Purchase receipt/invoice cancel routes 404.**~~ **Done** — `create-backend`
   now passes `purchases.layers`, which mounts both. Nothing that already worked
   changed: the routes were fully built (domain guards, the GL reversal port in
   `app.ts`, the sold-item gate) and only the composition root omitted one line.
   Verified end to end — cancelling a confirmed invoice marks the original entry
   `reversed` and posts a linked mirror entry («عكس فاتورة مشتريات»), the trial
   balance drops by exactly the invoice's 300.00 and still balances, and an
   invoice whose goods were already sold is refused with
   `PURCHASE_ITEMS_ALREADY_CONSUMED` rather than silently reversing.
3. **Two reports need schema changes, not report code** — sales-by-salesperson
   needs a rep field on invoices; make-vs-buy needs purchase-cost comparison
   data. (Expiring-soon (FEFO) was the third; stock layers now carry an optional
   batch and expiry, so it is built — and FEFO consumption landed with it,
   because costing is weighted-average and the layer draw never enters
   valuation.)
4. ~~**Promotions are never persisted to documents.**~~ **Done.** The invoice
   stores a value snapshot of the promotion it applied — not a foreign key, so a
   campaign edited or switched off later cannot retroactively change what a
   historical invoice says it granted. It is evaluated server-side at confirm
   against the invoice's real lines, so a browser can name a coupon but never a
   discount. The report counts real usage, and a return reverses pro-rata.

   One decision this surfaced and did **not** take: the promotion discount
   reduces the revenue credit rather than posting to a contra-revenue
   "discounts granted" account. That is a chart-of-accounts call.
5. ~~**`AuditEvent` has no branch field.**~~ **Done** — `branchId` is recorded
   from the scope the shell already sends, filterable in the viewer. Historical
   rows stay null: the table is append-only by trigger, so a back-fill is
   impossible by design and a default would fabricate evidence.

## Partial work parked, not lost

Branch `wip/partial-partner-tabs-hr-notices` holds the **payroll scope notices** —
making visible in the UI that a payslip's net omits income tax and social
insurance. The customer/supplier/branch tabs it also held are now finished and
merged.

## Lost in the merge with main

Two teams built overlapping features in parallel. Where both built the same thing,
main's implementation won — 36 commits already depended on it. Two capabilities
had no main equivalent and were lost. **Both are now restored** and verified:

- **Item specifications registry** — a reusable attribute catalog found by live
  inspection of the reference app and documented nowhere in `docs/catalog/`.
- **Notification trigger catalog** — enumerated all 39 catalogued events and
  flagged which 9 this build actually emits, so a rule could not be configured on
  an event that can never fire.
