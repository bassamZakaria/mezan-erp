# Mezan — Status

**Updated 2026-08-26** · Branch `main` · v1 = Electron desktop, SQLite, real data.

> **This is the only status document.** Two other files are live alongside it and
> own their own subject: `defects.md` (what is broken) and `decisions.md` (what is
> waiting on a human). Everything else under `docs/` is durable reference or
> procedure. Point-in-time audit evidence lives in `docs/reference-parity/audit/` and is kept for its
> evidence, not their conclusions — do not read them for current state.

## Where to look

`README.md` in this directory is the map — every document, what it is for, and
whether it goes stale. The three live documents are **this file** (what is done
and what is broken), `defects.md` (the defect register) and `decisions.md`
(what is waiting on a human).

## Reference parity — the current head of work

A three-round live audit against the reference product, 2026-08-26. Round 1 swept
**101 reference routes against 116 Mezan routes** at list level; round 2 opened every
create form, entity detail panel, tab and row menu; round 3 applied the
`site-feature-audit` method by hand — every non-destructive control clicked, every
dropdown enumerated, every row menu opened, the network instrumented, and every
screen captured.

The skill's deterministic crawler was **not** used: the reference serves
`robots.txt: Disallow: /`, and the skill's operating rules put a disallowed path out
of scope. The audit was therefore run manually through the UI, read-only — no write
was ever performed, and only `GET` traffic was observed.

| Document | What it holds |
|---|---|
| `docs/reference-parity/audit/REQUIREMENTS.md` | **The requirements register** — ~90 numbered requirements (R1.1 … R12.2) with priorities, plus 8 reference defects not to reproduce |
| `docs/reference-parity/audit/API-SURFACE.md` | 201 GET endpoints with their query contracts, grouped by domain |
| `docs/reference-parity/audit/ACTIONS.md` | Every control, its effect, and the modal or menu it opens |
| `docs/reference-parity/audit/COVERAGE.md` | What was **not** seen — read this before planning a sprint |
| `docs/reference-parity/audit/screenshots/` | 28 captured screens |
| `docs/reference-parity/gap-inventory.md` | The screen-by-screen diff |
| `docs/tasks.md` §1 | The ordered work list, P0 → P6 |
| `docs/scenarios/10-reference-parity.md` | The scenarios that verify each phase |

**The single most consequential finding:** every list resource on the reference is
served by *three* endpoints — rows, `…/counts`, `…/stats`. Chip counts and KPI money
are computed server-side across the whole filtered set. Mezan derives both from the
page of rows it happens to hold, so both are wrong past page 1. That is a correctness
defect, not a performance one, and it is P0.

Other headlines: the sidebar is two levels where the reference is three; all 22
operational reports are one table component with no KPI strip and no charts; treasury
exposes 4 of 11 voucher types; items have 2 of 6 types; settings has 4 of 10 policy
tabs and none of the toggles that change document behaviour (credit-control mode,
backorders, negative stock, require-PO-before-GRN, negative-cash block); the whole
**account-routing** screen and the **four non-queue ETA tabs** do not exist;
customer/supplier statements, attachments, cost-layer and reserved-stock views, and
the entity action bars are all absent.

Three defects were filed: **D43** (four shipped "(المرحلة الثانية)" placeholders on
surfaces whose data already exists), **D44** (cost-centre columns), **D45** (three
empty list surfaces).

## Current state

Measured against the running app, not the checklist:

| Signal | Value |
|---|---|
| Screens routed | **110** (from 129 nav entries) |
| «قريباً» markers outside HR | **0** |
| Read surfaces answering `pnpm smoke` | **116** |
| Reference screens still absent | ~14 (POS descoped) |
| Reference **features** still absent | see `tasks.md` §1–§2 |
| Typecheck / lint / build / smoke | passing |
| UX enhancement spec (§2–§8) | built; 4 items await a human decision |
| Contrast sweep, 13 screens × 2 themes | 0 failures, 0 horizontal overflow |
| Business-logic test execution | disabled by decision — see `testing-policy.md` |
| `pnpm scenarios` | **1,412 assertions passing, 4 failing** — the 4 are the 4 open defects in `defects.md` |

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

**`docs/defects.md`** is the defect register — six open, six fixed, and a list
of readings that look like defects and are not. It is read before every test run
and updated after. Making all 102 list surfaces non-empty surfaced four of the
six open ones; none was visible on an empty tenant, which is the argument for
the seeding gate in `testing-plan.md`. Two of them the demo seed deliberately
steers around: its physical counts net to zero and no work order is completed,
both to keep the books exact — **so the demo data is not evidence those two
paths are sound.**

**`docs/decisions.md`** is the decision register — seven open, each blocking its
own issue rather than the build. The two that touch a shared contract and so
cannot be patched in one line are the workflow `minAmount` that is configurable
but never read (DEC-1), and the gate that expects role codes while two routes
pass permission codes (DEC-2).

Also outstanding: email and WhatsApp notification channels are modelled but
unimplemented and labelled as such.

**The webhook dispatcher and the purchases/voucher audit sink both exist** — this
file previously said neither did. The dispatcher sits behind transport and
signature ports with a bounded 3-attempt retry, and a failing delivery cannot
roll back the business operation that triggered it (verified: a confirm returned
in 47 ms while its retries were still in flight).

**This build emits 5 of the 39 catalogued events**, not the 9 this file has
claimed. The number is derived live from the bridge mappings in
`create-backend.ts`, and `/notification-rules/triggers` and `/webhooks/events`
agree with it exactly. The purchase order/receipt/invoice chain publishes nothing
because it is not a `DocumentService` and so has no `DocumentEventPublisher` —
that is DEC-5.

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
