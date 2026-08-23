# Mezan (ميزان) — Enhancement Backlog (Beyond Parity)

> **These are ENHANCEMENTS beyond 1:1 parity with the reference app.** They live **only on the `enhancements` branch**, which **tracks `main`** (parity). Nothing here is merged into `main` — `main` remains parity-only.
>
> This is a **phased backlog of candidate issues**, ready to turn into tracker tickets later. Each candidate cites its requirement (`ENH-###`, `requirements.md`) and enabling workflow (`WF-##`, `workflows.md`). Sizes: S ≤1wk · M 1–3wk · L 3–6wk · XL >6wk. Estimates are relative to an already-built parity module and are planning inputs, not commitments.

---

## Sequencing principles

1. **Parity first.** Every candidate depends on its parity module existing on `main`; nothing starts before its dependency lands.
2. **Value-dense before broad.** Phase E1 is the six items every persona notices immediately.
3. **Shared substrate early.** The **Audit Ledger** (ENH-050) and the **event/notification taxonomy** underpin many later items — build them early.
4. **Vertical unlocks together.** Expiry/FEFO + van + reorder ship as the "distribution & pharma" cluster.

---

## Phase E1 — Foundation & daily-driver value (Must)

> Goal: the enhancements an owner, accountant, and auditor feel on day one, plus the shared substrate later phases build on.

| Issue | Title | Req | WF | Size | Depends on (parity) |
|---|---|---|---|---|---|
| ENH-E1-01 | Live Owner Cockpit dashboard | ENH-001 | WF-01 | L | Dashboard, Sales, Treasury, Inventory, Reports |
| ENH-E1-02 | Cash-runway & liquidity forecast | ENH-002 | WF-01 | M | Treasury, cheque register, AR, AP |
| ENH-E1-03 | Smart bank reconciliation | ENH-011 | WF-03 | L | Treasury, Accounting, import |
| ENH-E1-04 | Guided month-end close workspace | ENH-010 | WF-02 | L | Accounting periods, sub-ledgers, Multi-currency |
| ENH-E1-05 | Immutable searchable audit ledger (substrate) | ENH-050 | WF-13, WF-14 | L | Platform audit log, all module events |
| ENH-E1-06 | Verified backup & restore drills | ENH-060 | WF-15 | M | Desktop backup, Licensing |

**Exit criteria:** owner opens the cockpit daily; a period can be closed through the guided workspace; every sensitive change is in the audit ledger; a restore drill passes.

---

## Phase E2 — Per-persona wins (Should)

> Goal: concrete wins for accountant, warehouse, cashier, sales, and compliance built on the E1 substrate.

| Issue | Title | Req | WF | Size | Depends on |
|---|---|---|---|---|---|
| ENH-E2-01 | ETA e-invoice pre-validation & bulk resubmit | ENH-011b | WF-04 | L | Sales, ETA integration |
| ENH-E2-02 | Recurring & template journal automation | ENH-012 | WF-02 | M | Accounting, Fixed Assets, scheduler |
| ENH-E2-03 | Scanner-driven physical stock count | ENH-020 | WF-05 | L | Inventory, barcodes, companion device |
| ENH-E2-04 | Expiry tracking & FEFO engine | ENH-021 | WF-06 | L | Inventory costing/warehouses, dispatch |
| ENH-E2-05 | Keyboard/scanner-first POS fast lane | ENH-030 | WF-09 | M | POS selling screen |
| ENH-E2-06 | In-till discount approval | ENH-031 | WF-09 | M | POS, realtime, Audit ledger (E1-05) |
| ENH-E2-07 | Crash-safe / resumable cart | ENH-032 | WF-09 | S | POS |
| ENH-E2-08 | Price-floor & margin guardrails | ENH-041 | WF-11 | M | Sales pricing, Inventory cost, Workflow |
| ENH-E2-09 | Automated AR dunning / collections | ENH-043 | WF-12 | M | Sales AR, Notifications, CRM |
| ENH-E2-10 | Segregation-of-duties conflict detection | ENH-051 | WF-13 | M | Roles/permissions, Workflow, Audit ledger (E1-05) |
| ENH-E2-11 | Bulk user/role provisioning & onboarding | ENH-061 | WF-16 | S | Users/Roles, Licensing |

**Exit criteria:** ETA rejection rate drops; stock counts run on a device; POS is keyboard-first with approvals and crash recovery; below-floor sales are blocked; maker-checker SoD is enforced.

---

## Phase E3 — Depth, reach & extensibility (Could)

> Goal: broaden reach (mobile, CRM depth, van/distribution), close the audit loop, and open the platform.

| Issue | Title | Req | WF | Size | Depends on |
|---|---|---|---|---|---|
| ENH-E3-01 | Read-only remote/mobile glance | ENH-003 | WF-01 | L | Cockpit (E1-01), sync transport |
| ENH-E3-02 | Owner daily digest & anomaly alerts | ENH-004 | WF-01 | M | Notifications, Reports |
| ENH-E3-03 | Reorder-point & replenishment suggestions | ENH-022 | WF-07 | M | Inventory, Purchases, velocity reports |
| ENH-E3-04 | Van/mobile-warehouse reconciliation | ENH-023 | WF-08 | M | Inventory transfers, Sales rep, Treasury |
| ENH-E3-05 | Digital shift & cash-drawer reconciliation | ENH-033 | WF-10 | M | POS, Treasury, Accounting |
| ENH-E3-06 | CRM opportunity pipeline | ENH-040 | WF-11 | L | CRM, Sales quotes |
| ENH-E3-07 | Quote→order→invoice funnel & rep leaderboard | ENH-042 | WF-11 | M | Sales docs, CRM, Reports |
| ENH-E3-08 | Auditor read-only evidence pack | ENH-052 | WF-14 | M | Reports, Accounting, Audit ledger (E1-05), Roles |
| ENH-E3-09 | Integration API, webhooks & connectors | ENH-062 | WF-17 | L | Hono API, event taxonomy, Auth |
| ENH-E3-10 | System-health & multi-till console | ENH-063 | WF-16 | M | LAN multi-till, Licensing, Backup |

**Exit criteria:** owner has a mobile glance; distribution cluster (reorder+van) live; CRM is a pipeline; evidence pack exports in one click; external systems integrate via API.

---

## Horizon (Won't-yet — parked)

Deliberately deferred; not scheduled. Revisit after E3.

| Idea | Note |
|---|---|
| AI-assisted natural-language reporting | "Ask a question about my data" over the report engine; needs BI substrate (E1) first. |
| WhatsApp order intake / catalog | High local demand; large integration + compliance surface. |
| Loyalty & promotions deepening | Beyond the parity loyalty add-on; retail vertical polish. |
| BOQ / progress-certificate / retention billing | Contracting vertical (named catalog gap); scope its own epic. |
| Multi-currency as a licensable module + IAS-21 FX depth | Packaging + accounting-depth decision, per `plan.md`. |
| Cheque endorsement/replacement states | Extends the 7-state lifecycle; niche but real. |

---

## Roll-up

| Phase | Candidates | Sizes |
|---|---|---|
| E1 (Must) | 6 | 4×L, 2×M |
| E2 (Should) | 11 | 3×L, 6×M, 2×S |
| E3 (Could) | 10 | 3×L, 7×M |
| Horizon | 6 | unsized |
| **Total scheduled** | **27 candidates** (28 requirements; ENH-042 & ENH-040 share WF-11, all mapped) | — |

All candidates trace to a requirement in `requirements.md` and a workflow in `workflows.md`. Beyond-parity; `enhancements` branch only; tracks `main`.
