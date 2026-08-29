# Mezan (ميزان) — Enhancement Requirements (Beyond Parity)

> **Archived 2026-08-29 — a record, not current state.** Read `../../ROADMAP.md` for what is
> built and open, and `../../TESTING.md` for how it is verified. Paths cited below may name
> documents that have since moved; `../README.md` in the archive root maps them.


> **These are ENHANCEMENTS beyond 1:1 parity with the reference app.** They live **only on the `enhancements` branch**, which **tracks `main`** (parity). `main` stays parity-only; nothing here is merged back into `main`. This document captures a simulated stakeholder requirements meeting and turns each persona's pain points into concrete features/workflows the reference app lacks.
>
> Grounding for competitive framing (offline-first edge, module licensing, Daftra depth, ETA e-invoicing, 39 notification events / 26 workflow action types, weighted-average costing, van warehouses, cheque lifecycle): `docs/plan.md`, `docs/catalog/01..09-*.md`.
>
> **Sizing legend:** S = ≤1 week · M = 1–3 weeks · L = 3–6 weeks · XL = >6 weeks (multi-engineer). Sizes are relative to an already-built parity module.

---

## How to read this document

1. **Section A — Stakeholder meeting notes** — the personas, their pain with a parity-only ERP, and the enhancements each asked for. This is the source of truth.
2. **Section B — Requirements by persona** — every enhancement as a numbered requirement (`ENH-###`) with Problem / Enhancement / Value / Size / Parity dependency.
3. **Section C — Requirements by module** — the same requirements re-indexed by the parity module they extend, for planning.
4. **Section D — Prioritization** — MoSCoW + phase pointer (detail in `../ROADMAP.md` §7).

Requirement IDs are stable. Workflows they enable are in `workflows.md` (`WF-##`).

---

## Section A — Simulated stakeholder meeting notes

**Attendees (personas) for an Egyptian SMB ERP:**

| # | Persona | Arabic | Represents |
|---|---|---|---|
| P1 | Business Owner | صاحب العمل | Cash position, margin, "is the shop healthy today?" |
| P2 | Chief Accountant | المحاسب الرئيسي | GL correctness, month-end close, ETA filing |
| P3 | Warehouse Manager | مدير المخزن | Stock accuracy, expiry, receiving, van stock |
| P4 | Cashier / Retail Lead | الكاشير / مسؤول التجزئة | Speed at the till, cash drawer, offline continuity |
| P5 | Sales Manager | مدير المبيعات | Pipeline, price discipline, rep performance |
| P6 | Auditor / Compliance | المراجِع / الالتزام | Audit trail, segregation of duties, evidence |
| P7 | IT Admin | مسؤول تقنية المعلومات | Deployment, backups, LAN tills, user provisioning |

**Meeting frame:** the parity build (Mezan v1) reproduces the reference app faithfully — good documents, good GL, offline desktop. The reference app, however, is fundamentally a *data-entry system*: it records what already happened but does little to **prevent** mistakes, **surface** insight, or **automate** repetitive work. Every persona's pain below is a variant of that theme.

### P1 — Business Owner
- "I can pull a report, but I can't *glance* and know if today was good." Parity dashboard is static tiles, no trend, no alert.
- "By the time the accountant tells me cash is tight, it's already tight." No forward cash view.
- "I only see the business when I'm at the shop PC." No mobile/remote read-only view — a real gap vs Daftra's mobile apps.
- Wants: a live owner cockpit, cash-runway forecast, and a read-only mobile/remote glance.

### P2 — Chief Accountant
- Month-end close is a manual checklist in her head; nothing tells her what's still unposted or unreconciled.
- Bank reconciliation is fully manual line-matching — hours per account.
- ETA e-invoice rejections are found one-by-one, after the fact.
- Recurring entries (rent, depreciation, salaries) are re-keyed every month.
- Wants: guided close, smart bank reconciliation, ETA pre-validation + bulk resubmit, recurring-journal automation.

### P3 — Warehouse Manager
- Physical count means printing a sheet, counting, then re-keying — error-prone and slow.
- No expiry visibility until stock is dead; pharma/F&B need FEFO (flagged as a catalog gap in `plan.md`).
- Reorder is reactive — he learns he's out when a sale fails.
- Van/rep stock (the 5th warehouse type) is a black box until end-of-day.
- Wants: mobile barcode stock-count, expiry/FEFO engine, reorder suggestions, van reconciliation.

### P4 — Cashier / Retail Lead
- Parity POS selling screen is net-new but still mouse-driven; peak-hour queues need keyboard/scanner-first flow.
- Discount approval means calling a manager over — no in-till request.
- If the PC hiccups mid-sale, the cart is lost.
- Shift handover / cash-drawer count is on paper.
- Wants: keyboard-first till, in-till discount approval, crash-safe cart, digital drawer reconciliation.

### P5 — Sales Manager
- No pipeline — CRM in parity is a contact list, not opportunities/stages.
- Reps quote below floor price and he finds out at invoicing.
- No quote→order→invoice conversion tracking; no rep leaderboard.
- Collections chase is manual — overdue AR isn't pushed to anyone.
- Wants: opportunity pipeline, price-floor guardrails, conversion funnel + leaderboard, automated AR dunning.

### P6 — Auditor / Compliance
- Audit trail exists but isn't queryable as evidence; can't answer "who changed this price and when?"
- Segregation of duties is permission-based only; nothing detects that the same user created AND approved a payment.
- No period-lock enforcement story for external audit.
- Exporting evidence for the external auditor is a manual scrape.
- Wants: immutable searchable audit ledger, SoD conflict detection, auditor read-only export pack.

### P7 — IT Admin
- Backups are a product feature but restore is untested until disaster.
- Onboarding a new till/user is manual and slow.
- No integrations — data is siloed; owner asks "can it talk to our webshop / the bank file?"
- Health of LAN multi-till setup is invisible until a till fails.
- Wants: verified backup+restore drills, bulk user/role provisioning, an integration API + webhooks, a system-health console.

---

## Section B — Requirements by persona

> Each requirement: **Problem → Enhancement → Value → Size → Parity dependency.** "Parity dependency" names the parity module(s) that must exist first (these live on `main`).

### P1 — Business Owner (صاحب العمل)

#### ENH-001 — Live Owner Cockpit dashboard
- **Problem:** Parity dashboard is static KPI tiles with no trend, comparison, or drill-down; the owner cannot tell at a glance whether today/this-week is healthy.
- **Enhancement:** A real-time cockpit: sales vs. same-day-last-week sparklines, gross-margin trend, top movers, cash on hand across all treasuries, overdue AR, low-stock count — each tile drills into the underlying list. Auto-refresh via the in-process event bus (no manual reload).
- **Value:** Turns the app from a ledger into a management instrument; the #1 reason an owner opens the app daily.
- **Size:** L
- **Parity dependency:** Dashboard, Sales, Treasury, Inventory, Reports engine.

#### ENH-002 — Cash-runway & liquidity forecast
- **Problem:** Cash problems are discovered after they bite; no forward view of expected inflows/outflows.
- **Enhancement:** A 30/60/90-day cash forecast built from AR due dates, AP due dates, post-dated cheques (using the cheque lifecycle), and recurring commitments; "runway to zero" line and a configurable low-cash alert.
- **Value:** Prevents the classic SMB liquidity crunch; single most-valued number for an owner.
- **Size:** M
- **Parity dependency:** Treasury (incl. cheque register), Sales AR, Purchases AP.

#### ENH-003 — Read-only remote/mobile glance
- **Problem:** Owner only sees the business at the shop PC; Daftra ships 7 mobile apps — a positioning gap even for the offline edition.
- **Enhancement:** A companion read-only view (responsive web against the optional LAN/cloud sync, or a signed daily snapshot exported to a phone-friendly page) showing cockpit KPIs, today's sales, and cash. No write access — keeps the offline-first security model intact.
- **Value:** Owner confidence away from the shop; a concrete answer to "does it have mobile?"
- **Size:** L
- **Parity dependency:** Dashboard/BI (ENH-001), Licensing/sync transport.

#### ENH-004 — Owner daily digest & anomaly alerts
- **Problem:** Nothing proactively tells the owner what changed; the reference app is pull-only.
- **Enhancement:** An end-of-day digest (in-app + optional email) — sales, cash, margin, exceptions (big discounts, negative-margin lines, voided invoices) — plus threshold anomaly alerts. Rides the existing 39-event notification taxonomy with new owner-scoped rules.
- **Value:** Management by exception; catches leakage the same day.
- **Size:** M
- **Parity dependency:** Notification engine, Reports, Sales/Treasury events.

### P2 — Chief Accountant (المحاسب الرئيسي)

#### ENH-010 — Guided month-end close checklist
- **Problem:** Close is an informal mental checklist; no system view of what's unposted, unreconciled, or unbalanced before locking a period.
- **Enhancement:** A close workspace: per-period checklist (all documents posted, sub-ledgers tie to GL, banks reconciled, FX revaluation run, recurring entries posted), each item auto-evaluated with a red/green status and a jump-to-fix link; period cannot be locked until blockers clear (or are explicitly overridden with reason).
- **Value:** Cuts close time and errors; makes the three-state fiscal period actually safe.
- **Size:** L
- **Parity dependency:** Accounting (periods, GL), Treasury, Multi-currency (FX revaluation), all sub-ledgers.

#### ENH-011 — Smart bank reconciliation
- **Problem:** Reconciliation is manual line-by-line matching — hours per account per month.
- **Enhancement:** Import a bank statement (CSV/OFX/MT940), auto-match on amount+date+reference with a confidence score, suggest matches for the rest, one-click create-missing-entry for bank fees/interest, and a running "unreconciled difference = 0" target.
- **Value:** Reconciliation goes from hours to minutes; the accountant's loudest ask.
- **Size:** L
- **Parity dependency:** Treasury (bank accounts), Accounting (GL), Integrations/import.

#### ENH-011b — ETA e-invoice pre-validation & bulk resubmit
- **Problem:** ETA is a mandatory integration; parity submits and reports rejections one at a time, discovered after the fact.
- **Enhancement:** Client-side pre-validation against ETA rules (tax codes, unit codes, GS1/EGS item codes, totals) *before* submission; a submission queue with status, bulk re-submit of failures, and a rejection-reason report. Works with the offline queue (submit when connectivity returns).
- **Value:** Fewer rejections, faster filing, compliance confidence — Egypt-first differentiation.
- **Size:** L
- **Parity dependency:** Sales invoicing, ETA integration (parity), Compliance.

#### ENH-012 — Recurring & template journal automation
- **Problem:** Rent, depreciation, payroll accruals, prepaid amortization are re-keyed monthly.
- **Enhancement:** Recurring journal templates with schedule (monthly/quarterly), auto-draft on due date for one-click review-and-post, and a straight-line depreciation schedule generator for Fixed Assets.
- **Value:** Eliminates repetitive keying and the errors it causes; faster, more consistent close.
- **Size:** M
- **Parity dependency:** Accounting (journals), Fixed Assets, Scheduler.

### P3 — Warehouse Manager (مدير المخزن)

#### ENH-020 — Mobile/scanner-driven stock count
- **Problem:** Physical count = print sheet → count → re-key; slow and error-prone; freezing stock during count is disruptive.
- **Enhancement:** A count session on a handheld/phone (or LAN tablet): scan barcode → enter qty, blind-count mode, multi-counter zones, live variance vs. system, and post approved variances as stock adjustments using the existing 8 adjustment reasons.
- **Value:** Faster, more accurate counts; less shrink; less downtime.
- **Size:** L
- **Parity dependency:** Inventory (stock, adjustments, barcodes), Mobile/companion.

#### ENH-021 — Expiry tracking & FEFO engine
- **Problem:** No batch/expiry visibility; dead stock discovered too late. FEFO is a named catalog gap (`plan.md`, pharma/F&B).
- **Enhancement:** Batch/lot + expiry date capture at receiving; FEFO picking suggestions on sales/dispatch; expiry aging report and near-expiry alerts; block/quarantine expired stock.
- **Value:** Cuts write-offs, enables pharma/F&B verticals, unlocks a persona bundle.
- **Size:** L
- **Parity dependency:** Inventory (costing layers, warehouses), Sales dispatch.

#### ENH-022 — Reorder-point & replenishment suggestions
- **Problem:** Stock-outs discovered when a sale fails; reordering is reactive.
- **Enhancement:** Per-item/per-warehouse min/max + lead time; a replenishment worklist ranked by urgency (incl. sales-velocity-based suggested qty) that drafts purchase orders in one click.
- **Value:** Fewer stock-outs and less overstock; working-capital efficiency.
- **Size:** M
- **Parity dependency:** Inventory, Purchases (PO), Reports (velocity).

#### ENH-023 — Van/mobile-warehouse reconciliation
- **Problem:** Van stock (the 5th warehouse type) is opaque until end-of-day; rep shortages are disputes.
- **Enhancement:** Van load-out and end-of-day settlement: expected vs. returned stock + cash collected, variance flagged, auto stock transfer and AR posting. Ties to sales-rep records.
- **Value:** Stops van-sales leakage; a real distribution-vertical feature.
- **Size:** M
- **Parity dependency:** Inventory (transfers, van warehouse), Sales (rep invoices), Treasury.

### P4 — Cashier / Retail Lead (الكاشير / مسؤول التجزئة)

#### ENH-030 — Keyboard/scanner-first POS fast lane
- **Problem:** The net-new POS screen is still mouse-driven; peak queues need hands-on-keyboard speed.
- **Enhancement:** Full keyboard map (scan-to-add, quantity multiplier, hotkey tender, F-key functions), scale/scanner integration, and a "no mouse required" checkout path; large-touch fallback for touchscreens.
- **Value:** Seconds per transaction at peak = real throughput; matches dedicated POS tools.
- **Size:** M
- **Parity dependency:** POS selling screen (parity net-new).

#### ENH-031 — In-till discount approval
- **Problem:** Below-floor discount means physically fetching a manager; parity handles this via a separate POS threshold mechanism only.
- **Enhancement:** Request-approval inline at the till: cashier requests, manager approves on the same or a paired device (PIN/badge), decision logged to the audit ledger. Respects the POS threshold-driven mechanism (kept distinct from the general workflow engine, per `plan.md`).
- **Value:** Faster lines, price discipline, and an audit record of every override.
- **Size:** M
- **Parity dependency:** POS, Notification/realtime, Audit ledger (ENH-050).

#### ENH-032 — Crash-safe / resumable cart
- **Problem:** A PC hiccup mid-sale loses the cart; unacceptable at a busy till.
- **Enhancement:** Continuous local persistence of the in-progress cart (autosave every change), automatic recovery on relaunch, plus explicit hold/resume of parked sales.
- **Value:** Zero lost sales from crashes; core reliability for retail.
- **Size:** S
- **Parity dependency:** POS.

#### ENH-033 — Digital shift & cash-drawer reconciliation
- **Problem:** Shift handover and drawer count are on paper; discrepancies are untraceable.
- **Enhancement:** Open/close shift with declared float, blind cash count at close, expected-vs-counted variance by tender type, over/short posted to a variance account, and a per-shift Z-report.
- **Value:** Accountability per cashier; cash leakage visible immediately.
- **Size:** M
- **Parity dependency:** POS, Treasury (cash accounts), Accounting.

### P5 — Sales Manager (مدير المبيعات)

#### ENH-040 — CRM opportunity pipeline
- **Problem:** Parity CRM is a contact list — no opportunities, stages, or forecast.
- **Enhancement:** Leads → opportunities with configurable stages, expected value/close date, weighted pipeline, activities/reminders, and quote linkage; a kanban + forecast view.
- **Value:** Turns CRM into a revenue tool; pipeline visibility the owner also wants.
- **Size:** L
- **Parity dependency:** CRM (contacts), Sales (quotes).

#### ENH-041 — Price-floor & margin guardrails
- **Problem:** Reps quote below cost/floor; discovered only at invoicing.
- **Enhancement:** Per-item/customer-group floor price and minimum-margin rules enforced at quote/order/POS entry; below-floor lines blocked or routed to approval; live margin shown per line.
- **Value:** Protects margin at the point of sale, not after; stops silent leakage.
- **Size:** M
- **Parity dependency:** Sales (pricing, quotes), Inventory (cost), Workflow.

#### ENH-042 — Quote→order→invoice funnel & rep leaderboard
- **Problem:** No conversion tracking; no objective rep performance view.
- **Enhancement:** Conversion funnel (quote→confirmed→invoiced→collected) with aging at each stage; rep leaderboard on revenue, margin, conversion, and collection; commission-basis export.
- **Value:** Data-driven sales management and coaching.
- **Size:** M
- **Parity dependency:** Sales documents, CRM, Reports.

#### ENH-043 — Automated AR dunning / collections
- **Problem:** Overdue AR chasing is manual and inconsistent.
- **Enhancement:** Aging-bucket rules that auto-generate reminders (in-app/email/SMS/WhatsApp-link) at 7/30/60 days, a collections worklist with promise-to-pay tracking, and per-customer statement send.
- **Value:** Faster cash collection; the owner's cash-runway improves.
- **Size:** M
- **Parity dependency:** Sales AR, Notification engine, CRM.

### P6 — Auditor / Compliance (المراجِع / الالتزام)

#### ENH-050 — Immutable, searchable audit ledger
- **Problem:** Audit trail exists but isn't queryable as evidence ("who changed this price, when, from/to what?").
- **Enhancement:** An append-only, hash-chained audit ledger capturing before/after on sensitive fields, with a search UI (by user, entity, field, date) and tamper-evidence verification.
- **Value:** Turns compliance from hope into evidence; supports external audit and disputes.
- **Size:** L
- **Parity dependency:** Platform/Settings (existing audit log), all modules emit events.

#### ENH-051 — Segregation-of-duties (SoD) conflict detection
- **Problem:** Permissions gate *what* a user can do but don't detect that one user both created and approved a payment.
- **Enhancement:** SoD rule set over the ~268 permissions (conflicting pairs, e.g. create-vs-approve payment, post-vs-reconcile) with real-time warning and a periodic SoD violation report; maker-checker enforced on sensitive actions.
- **Value:** Fraud prevention; a control external auditors specifically look for.
- **Size:** M
- **Parity dependency:** Permissions/Roles, Workflow engine, Audit ledger (ENH-050).

#### ENH-052 — Auditor read-only evidence pack
- **Problem:** Preparing for the external auditor is a manual scrape of reports and exports.
- **Enhancement:** A time-boxed, read-only auditor role + one-click evidence pack: trial balance, GL detail, sub-ledger reconciliations, sequence-gap report, and the audit-ledger extract, exported as a signed bundle.
- **Value:** Days of audit prep collapse to one click; clean handoff.
- **Size:** M
- **Parity dependency:** Reports, Accounting, Audit ledger (ENH-050), Roles.

### P7 — IT Admin (مسؤول تقنية المعلومات)

#### ENH-060 — Verified backup & restore drills
- **Problem:** Backup is a product feature but restore is untested until disaster; offline edition has no platform safety net.
- **Enhancement:** Scheduled encrypted backups (local + optional external/USB/cloud target), automatic post-backup integrity verification, and a one-click "test restore into sandbox" drill with a pass/fail report.
- **Value:** Real disaster recovery, not hoped-for; critical for offline single-shop installs.
- **Size:** M
- **Parity dependency:** Platform/desktop backup (parity), Licensing.

#### ENH-061 — Bulk user/role provisioning & onboarding
- **Problem:** Adding tills/users is one-by-one; error-prone permission assignment across 19 modules.
- **Enhancement:** Role templates (Cashier, Accountant, Warehouse, Manager), CSV bulk user import, clone-user, and a device/till enrollment flow for LAN multi-till.
- **Value:** Fast, consistent onboarding; fewer permission mistakes (feeds SoD).
- **Size:** S
- **Parity dependency:** Users/Roles, Licensing (seats/terminals).

#### ENH-062 — Integration API, webhooks & connectors
- **Problem:** Data is siloed; owner wants webshop/bank-file/marketplace connectivity — a parity gap vs cloud competitors.
- **Enhancement:** A stable local/LAN REST API (the Hono app already exists) with API keys, outbound webhooks on domain events, and starter connectors (e-commerce order import, bank-statement import, ETA already covered). Documented via the emitted OpenAPI doc.
- **Value:** Ends the silo; extensibility without waiting on the vendor.
- **Size:** L
- **Parity dependency:** API layer (Hono), Notification/event taxonomy, Auth.

#### ENH-063 — System-health & multi-till console
- **Problem:** LAN multi-till health is invisible until a till fails; no view of sync/queue/license status.
- **Enhancement:** An admin console showing each till's connectivity, offline-queue depth, last-sync, license/seat usage, DB size, and backup status; alerts on degraded state.
- **Value:** Proactive ops; fewer "the till is stuck" support calls.
- **Size:** M
- **Parity dependency:** LAN multi-till transport, Licensing, Backup.

---

## Section C — Requirements by module

> Same requirements, indexed by the parity module they extend.

| Module (parity) | Enhancements |
|---|---|
| **Dashboard / BI** | ENH-001 Owner cockpit · ENH-002 Cash-runway forecast · ENH-003 Remote/mobile glance · ENH-004 Daily digest & anomaly alerts |
| **Sales** | ENH-011b ETA pre-validation · ENH-041 Price-floor guardrails · ENH-042 Conversion funnel & leaderboard · ENH-043 AR dunning |
| **Purchases** | ENH-022 Reorder/replenishment (drafts POs) |
| **Inventory** | ENH-020 Scanner stock-count · ENH-021 Expiry/FEFO · ENH-022 Reorder points · ENH-023 Van reconciliation |
| **Treasury** | ENH-002 Cash-runway · ENH-011 Smart bank reconciliation · ENH-033 Drawer reconciliation |
| **Accounting** | ENH-010 Guided close · ENH-011 Bank rec · ENH-012 Recurring journals · ENH-052 evidence pack |
| **POS** | ENH-030 Keyboard-first · ENH-031 In-till discount approval · ENH-032 Crash-safe cart · ENH-033 Shift/drawer |
| **CRM** | ENH-040 Opportunity pipeline · ENH-042 funnel · ENH-043 dunning |
| **Reports / BI** | ENH-001, ENH-004, ENH-042, ENH-052 (+ AI-assisted reporting, see backlog) |
| **Compliance / ETA** | ENH-011b ETA pre-validation · ENH-050 Audit ledger · ENH-051 SoD · ENH-052 Evidence pack |
| **Platform / Admin** | ENH-060 Backup drills · ENH-061 Bulk provisioning · ENH-063 Health console |
| **Integrations / API** | ENH-062 API/webhooks/connectors · ENH-011 bank import · ENH-062 e-commerce import |
| **Notifications / Workflow** | ENH-004 digest · ENH-031 approval · ENH-043 dunning · ENH-051 maker-checker |
| **Mobile / Companion** | ENH-003 owner glance · ENH-020 scanner count |
| **Multi-currency** | ENH-010 (FX revaluation in close) |

---

## Section D — Prioritization (MoSCoW + phase)

> Full phased breakdown with candidate issues is in `../ROADMAP.md` §7. Phases here are pointers.

| Priority | Requirements | Rationale | Phase |
|---|---|---|---|
| **Must** | ENH-001, ENH-002, ENH-011, ENH-010, ENH-050, ENH-060 | Highest owner/accountant/audit value; each is a daily-driver or a safety net | E1 |
| **Should** | ENH-011b, ENH-012, ENH-020, ENH-021, ENH-030, ENH-031, ENH-032, ENH-041, ENH-043, ENH-061, ENH-051 | Strong per-persona wins; moderate build on existing parity | E2 |
| **Could** | ENH-003, ENH-004, ENH-022, ENH-023, ENH-033, ENH-040, ENH-042, ENH-052, ENH-062, ENH-063 | High value but larger or dependent on Must/Should items | E3 |
| **Won't (yet)** | AI-assisted reporting, WhatsApp order intake, loyalty deepening | Deferred; parked in backlog "Horizon" | — |

**Totals:** 28 enhancement requirements across 7 personas and 15 modules. Enabling workflows: see `workflows.md`.
